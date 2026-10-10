package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math/rand"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
)

func TestCompassSettingsNeverExposePassword(t *testing.T) {
	t.Setenv("ACE_CONFIG_DIR", t.TempDir())
	post := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("POST", "/api/compass/settings", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handleCompassSettings(rec, req)
		return rec
	}
	rec := post(`{"server":" 192.168.1.20 ","port":3306,"database":"compass","username":"mm","password":"hunter2","tls":"preferred"}`)
	if rec.Code != 200 {
		t.Fatalf("save: %d %s", rec.Code, rec.Body)
	}
	if strings.Contains(rec.Body.String(), "hunter2") || !strings.Contains(rec.Body.String(), `"hasPassword":true`) {
		t.Fatalf("response leaks or loses the password: %s", rec.Body)
	}
	get := httptest.NewRecorder()
	handleCompassSettings(get, httptest.NewRequest("GET", "/api/compass/settings", nil))
	if strings.Contains(get.Body.String(), "hunter2") || strings.Contains(get.Body.String(), `"password"`) {
		t.Fatalf("GET leaks the password: %s", get.Body)
	}
	var pub map[string]any
	_ = json.Unmarshal(get.Body.Bytes(), &pub)
	if pub["server"] != "192.168.1.20" || pub["database"] != "compass" {
		t.Fatalf("settings: %v", pub)
	}
	// Not in plain text on disk either (off Windows the stand-in marks it; on
	// Windows it's DPAPI-encrypted).
	p, _ := compassPath()
	raw, _ := os.ReadFile(p)
	if bytes.Contains(raw, []byte("hunter2")) {
		t.Fatal("password stored in plain text")
	}
	s, _ := loadCompass()
	if pw, err := s.password(); err != nil || pw != "hunter2" {
		t.Fatalf("password round trip: %q %v", pw, err)
	}

	// Saving without a password keeps it; clearPassword removes it.
	post(`{"server":"192.168.1.21","port":3306,"database":"compass","username":"mm"}`)
	s, _ = loadCompass()
	if pw, _ := s.password(); pw != "hunter2" || s.Server != "192.168.1.21" {
		t.Fatalf("keep password: %q %q", pw, s.Server)
	}
	post(`{"server":"192.168.1.21","port":3306,"database":"compass","username":"mm","clearPassword":true}`)
	s, _ = loadCompass()
	if s.Password != "" {
		t.Fatal("password not cleared")
	}
	// Not state.json: the UI reads that one back whole.
	if sp, _ := statePath(); sp == p {
		t.Fatal("compass settings must not live in state.json")
	}
}

func TestCompassSettingsValidation(t *testing.T) {
	base := compassSettings{Port: 3306, TLS: "preferred"}
	bad := []compassUpdate{
		{Server: "192.168.1.20; drop", Database: "x", Username: "y"},
		{Server: "host", Port: 70000, Database: "x", Username: "y"},
		{Server: "host", Database: "a`b", Username: "y"},
		{Server: "host", Database: "x", Username: "y", TLS: "maybe"},
	}
	for _, u := range bad {
		if _, err := applyCompassUpdate(base, u); err == nil {
			t.Errorf("%+v accepted", u)
		}
	}
	s, err := applyCompassUpdate(base, compassUpdate{Server: "EAGLESRV", Database: "eagle", Username: "u"})
	if err != nil || s.Port != 3306 || s.TLS != "preferred" {
		t.Fatalf("defaults: %+v %v", s, err)
	}
}

func TestCompassTestReportsMissingSettings(t *testing.T) {
	res := runCompassTest(context.Background(), compassSettings{Port: 3306})
	if res.OK || res.Checks[0].Status != "fail" || !strings.Contains(res.Checks[0].Detail, "Server, Database, Username") {
		t.Fatalf("%+v", res.Checks[0])
	}
	for _, c := range res.Checks[1:] {
		if c.Status != "skip" {
			t.Fatalf("later checks should be skipped: %+v", c)
		}
	}
}

func TestCompassTestClosedPort(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close() // now nothing listens there
	res := runCompassTest(context.Background(), compassSettings{Server: "127.0.0.1", Port: port, Database: "d", Username: "u"})
	byName := map[string]compassCheck{}
	for _, c := range res.Checks {
		byName[c.Name] = c
	}
	if res.OK || byName["Server address"].Status != "pass" || byName["Network path"].Status != "pass" || byName["MySQL port"].Status != "fail" || byName["MySQL login"].Status != "skip" {
		t.Fatalf("%+v", res.Checks)
	}
}

func TestExplainMySQLError(t *testing.T) {
	d, fix := explainMySQLError(&mysql.MySQLError{Number: 1130, Message: "Host '10.0.0.5' is not allowed to connect"})
	if !strings.Contains(d, "doesn't allow this computer") || !strings.Contains(fix, "allow this PC") {
		t.Fatalf("%q %q", d, fix)
	}
	d, _ = explainMySQLError(&mysql.MySQLError{Number: 1045, Message: "Access denied"})
	if !strings.Contains(d, "username or password") {
		t.Fatal(d)
	}
	if d, _ := explainMySQLError(context.DeadlineExceeded); !strings.Contains(d, "didn't answer") {
		t.Fatal(d)
	}
}

func TestCompassEndpointsRejectCrossSiteAndForms(t *testing.T) {
	t.Setenv("ACE_CONFIG_DIR", t.TempDir())
	for _, h := range []http.HandlerFunc{handleCompassTest, handleCompassExplore, handleCompassSettings} {
		req := httptest.NewRequest("POST", "/api/compass/x", strings.NewReader("a=b"))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		rec := httptest.NewRecorder()
		h(rec, req)
		if rec.Code != http.StatusUnsupportedMediaType {
			t.Fatalf("form post accepted: %d", rec.Code)
		}
	}
	req := httptest.NewRequest("POST", "/api/compass/test", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	rec := httptest.NewRecorder()
	blockCrossSite(http.HandlerFunc(handleCompassTest)).ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("cross-site allowed: %d", rec.Code)
	}
}

/* ---------------- against a real MySQL / MariaDB ----------------
   Set ACE_TEST_MYSQL=user:password@host:port to an account that may create
   databases and users (CI starts the runner's MySQL; locally any MariaDB).
   The test builds a small Compass-like database and a read-only login. */

type testMySQL struct {
	host                 string
	port                 int
	adminUser, adminPass string
}

func mysqlFromEnv(t *testing.T) testMySQL {
	v := os.Getenv("ACE_TEST_MYSQL")
	if v == "" {
		t.Skip("ACE_TEST_MYSQL not set")
	}
	at := strings.LastIndex(v, "@")
	cred, hp := v[:at], v[at+1:]
	user, pass, _ := strings.Cut(cred, ":")
	host, ps, _ := net.SplitHostPort(hp)
	port, _ := strconv.Atoi(ps)
	return testMySQL{host, port, user, pass}
}

func (m testMySQL) admin(t *testing.T) *sql.DB {
	cfg := mysql.NewConfig()
	cfg.User, cfg.Passwd, cfg.Net, cfg.Addr = m.adminUser, m.adminPass, "tcp", net.JoinHostPort(m.host, strconv.Itoa(m.port))
	cfg.MultiStatements = true
	cfg.AllowNativePasswords = true
	cfg.TLSConfig = "preferred"
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Ping(); err != nil {
		t.Fatalf("admin connect: %v", err)
	}
	return db
}

// seedCompass makes a database shaped like what we expect of Compass: an IN
// inventory table whose location columns have cryptic names, a few other
// tables, and a read-only login (like the one Margin Master is given).
func seedCompass(t *testing.T, m testMySQL) (compassSettings, string) {
	db := m.admin(t)
	t.Cleanup(func() { db.Close() }) // runs after the drops below (LIFO)
	suffix := fmt.Sprintf("%d", rand.New(rand.NewSource(time.Now().UnixNano())).Intn(1e6))
	name := "compass_t" + suffix
	user := "mm_t" + suffix
	pass := "Pw-" + suffix + "-x!"
	stmts := []string{
		"CREATE DATABASE " + name,
		"CREATE TABLE " + name + ".`IN` (ITEMNO CHAR(14), DESCR VARCHAR(30), LCD1 CHAR(5), LCD2 CHAR(5), LCD3 CHAR(5), LCD4 CHAR(5), LCD5 CHAR(5), LCD6 CHAR(5), RCOST DECIMAL(9,3), STR CHAR(1))",
		"INSERT INTO " + name + ".`IN` VALUES ('70013','ACE SHVL SQRPT','12R02','','6','','','',12.5,'1'), ('70018','ACE SHVL RNDPT','12R02','','5','USTOR','','',11,'1'), ('3008391','TEST HOSE','14L05','','4','12R01','','',20,'1')",
		"CREATE TABLE " + name + ".BINS (BINLOC VARCHAR(8), NOTE VARCHAR(20))",
		"INSERT INTO " + name + ".BINS VALUES ('USTOR','upstairs'), ('107','back room')",
		"CREATE TABLE " + name + ".STORES (STR CHAR(1), STORENAME VARCHAR(30))",
		"INSERT INTO " + name + ".STORES VALUES ('1','Snyder''s Ace')",
		fmt.Sprintf("CREATE USER '%s'@'%%' IDENTIFIED BY '%s'", user, pass),
		fmt.Sprintf("GRANT SELECT ON %s.* TO '%s'@'%%'", name, user),
	}
	t.Cleanup(func() {
		db.Exec("DROP DATABASE IF EXISTS " + name)
		db.Exec(fmt.Sprintf("DROP USER IF EXISTS '%s'@'%%'", user))
	})
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			t.Fatalf("%s: %v", s, err)
		}
	}
	s := compassSettings{Server: m.host, Port: m.port, Database: name, Username: user, TLS: "preferred"}
	if err := s.setPassword(pass); err != nil {
		t.Fatal(err)
	}
	return s, pass
}

func TestCompassAgainstMySQL(t *testing.T) {
	m := mysqlFromEnv(t)
	s, _ := seedCompass(t, m)
	ctx := context.Background()

	res := runCompassTest(ctx, s)
	if !res.OK {
		t.Fatalf("test failed: %+v", res.Checks)
	}
	if res.InTable != "IN" || res.InRows != 3 || res.Version == "" {
		t.Fatalf("result %+v", res)
	}

	// The session refuses writes even if something tried one.
	cc, err := openCompass(ctx, s, mustPw(t, s))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := cc.conn.ExecContext(ctx, "INSERT INTO STORES VALUES ('9','x')"); err == nil {
		t.Fatal("write succeeded on the Compass connection")
	}
	cc.Close()

	rep, err := runCompassExplore(ctx, s, "70013", "12r02")
	if err != nil {
		t.Fatal(err)
	}
	if len(rep.Tables) != 3 || rep.Tables[0].Name != "IN" {
		t.Fatalf("tables %+v", rep.Tables)
	}
	if len(rep.InColumns) != 10 || len(rep.InSample) != 3 {
		t.Fatalf("IN columns %d sample %d", len(rep.InColumns), len(rep.InSample))
	}
	found := map[string]bool{}
	for _, mt := range rep.Matches {
		found[mt.What+":"+mt.Table+"."+mt.Column] = true
	}
	if !found["sku:IN.ITEMNO"] || !found["location:IN.LCD1"] {
		t.Fatalf("matches %+v", rep.Matches)
	}
	var binloc *exploreLoc
	for i := range rep.LocCols {
		if rep.LocCols[i].Table == "BINS" && rep.LocCols[i].Name == "BINLOC" {
			binloc = &rep.LocCols[i]
		}
	}
	if binloc == nil || strings.Join(binloc.Examples, ",") != "USTOR,107" {
		t.Fatalf("location-like columns %+v", rep.LocCols)
	}
	for _, want := range []string{"SKU found in IN.ITEMNO", "Location found in IN.LCD1", "ITEMNO=70013", "== Inventory table IN (10 columns)", "BINS.BINLOC"} {
		if !strings.Contains(rep.Text, want) {
			t.Fatalf("report missing %q:\n%s", want, rep.Text)
		}
	}
}

func mustPw(t *testing.T, s compassSettings) string {
	pw, err := s.password()
	if err != nil {
		t.Fatal(err)
	}
	return pw
}

func TestCompassLoginProblems(t *testing.T) {
	m := mysqlFromEnv(t)
	s, _ := seedCompass(t, m)
	ctx := context.Background()

	wrong := s
	_ = wrong.setPassword("not-it")
	res := runCompassTest(ctx, wrong)
	var login compassCheck
	for _, c := range res.Checks {
		if c.Name == "MySQL login" {
			login = c
		}
	}
	if res.OK || login.Status != "fail" || !strings.Contains(login.Detail, "username or password") {
		t.Fatalf("wrong password: %+v", res.Checks)
	}

	nodb := s
	nodb.Database = "no_such_compass"
	res = runCompassTest(ctx, nodb)
	var dbc compassCheck
	for _, c := range res.Checks {
		if c.Name == "Database" {
			dbc = c
		}
	}
	if res.OK || dbc.Status != "fail" {
		t.Fatalf("missing database: %+v", res.Checks)
	}

	if _, err := runCompassExplore(ctx, wrong, "", ""); err == nil || !strings.Contains(err.Error(), "username or password") {
		t.Fatalf("explore with a wrong password: %v", err)
	}
}
