package main

// Live data from Epicor Compass.
//
// Compass keeps a MySQL copy ("data warehouse") of the store's Eagle data,
// on the store network or, for Epicor-hosted Eagle, on Epicor's server over
// the store's VPN. Margin Master reads its inventory from it directly,
// read-only (its handbook: "MySQL Compass does not use a file. Margin
// Master connects directly, read-only, to the Compass database on your
// local network"), and this app connects the same way, with the same five
// settings: server, port, database, username, password.
//
// The app only ever reads: every query is a SELECT (or a read of
// information_schema), the session is put in READ ONLY mode where the
// server supports it (MySQL 5.6 and later), and changes still go into
// Eagle through its import files.
//
// Settings live in compass.json beside state.json — not in state.json,
// which the UI reads back whole, so the password never reaches the page.
// On Windows the password is encrypted with DPAPI for the signed-in user.

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-sql-driver/mysql"
)

const defaultCompassPort = 3306

type compassSettings struct {
	Server   string `json:"server"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	Username string `json:"username"`
	TLS      string `json:"tls"`                // "preferred" (default), "off", "on"
	Password string `json:"password,omitempty"` // protected + base64; never sent to the UI
	// Mode is the way in that last worked ("ssl", "nossl" or "oldpw"), tried
	// first next time. Old servers count every failed attempt against this
	// PC and lock it out after a handful (MySQL 5.1's max_connect_errors is
	// 10 by default), so the app shouldn't fail its way in on every connect.
	Mode string `json:"mode,omitempty"`
}

var compassMu sync.Mutex

func compassPath() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "compass.json"), nil
}

func loadCompass() (compassSettings, error) {
	s := compassSettings{Port: defaultCompassPort, TLS: "preferred"}
	p, err := compassPath()
	if err != nil {
		return s, err
	}
	data, err := os.ReadFile(p)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	if err := json.Unmarshal(data, &s); err != nil {
		return compassSettings{Port: defaultCompassPort, TLS: "preferred"}, nil
	}
	if s.Port == 0 {
		s.Port = defaultCompassPort
	}
	if s.TLS == "" {
		s.TLS = "preferred"
	}
	return s, nil
}

func saveCompass(s compassSettings) error {
	p, err := compassPath()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(p, data)
}

func (s compassSettings) password() (string, error) {
	if s.Password == "" {
		return "", nil
	}
	raw, err := base64.StdEncoding.DecodeString(s.Password)
	if err != nil {
		return "", errors.New("the saved password is damaged — type it again")
	}
	plain, err := unprotectSecret(raw)
	if err != nil {
		return "", errors.New("the saved password can't be read on this computer or Windows account — type it again")
	}
	return string(plain), nil
}

func (s *compassSettings) setPassword(pw string) error {
	if pw == "" {
		s.Password = ""
		return nil
	}
	enc, err := protectSecret([]byte(pw))
	if err != nil {
		return fmt.Errorf("couldn't protect the password: %w", err)
	}
	s.Password = base64.StdEncoding.EncodeToString(enc)
	return nil
}

// compassPublic is what the UI may see: everything but the password.
func compassPublic(s compassSettings) map[string]any {
	return map[string]any{
		"server": s.Server, "port": s.Port, "database": s.Database, "username": s.Username,
		"tls": s.TLS, "hasPassword": s.Password != "",
	}
}

var hostRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.\-]{0,252}$`)

// compassUpdate is a settings save from the UI. A missing or empty password
// keeps the saved one; clearPassword removes it.
type compassUpdate struct {
	Server        string  `json:"server"`
	Port          int     `json:"port"`
	Database      string  `json:"database"`
	Username      string  `json:"username"`
	TLS           string  `json:"tls"`
	Password      *string `json:"password"`
	ClearPassword bool    `json:"clearPassword"`
}

func applyCompassUpdate(s compassSettings, u compassUpdate) (compassSettings, error) {
	server := strings.TrimSpace(u.Server)
	if server != "" && net.ParseIP(server) == nil && !hostRe.MatchString(server) {
		return s, errors.New("the server should be an IP address (like 192.168.1.20) or a computer name")
	}
	port := u.Port
	if port == 0 {
		port = defaultCompassPort
	}
	if port < 1 || port > 65535 {
		return s, errors.New("the port should be a number from 1 to 65535 (MySQL's usual port is 3306)")
	}
	db := strings.TrimSpace(u.Database)
	user := strings.TrimSpace(u.Username)
	if len(db) > 64 || len(user) > 80 || strings.ContainsAny(db, "/\\`") {
		return s, errors.New("the database or username isn't valid")
	}
	tls := u.TLS
	switch tls {
	case "preferred", "off", "on":
	case "":
		tls = "preferred"
	default:
		return s, errors.New("unknown SSL setting")
	}
	if server != s.Server || port != s.Port || db != s.Database || user != s.Username || tls != s.TLS {
		s.Mode = ""
	}
	s.Server, s.Port, s.Database, s.Username, s.TLS = server, port, db, user, tls
	if u.ClearPassword {
		s.Password = ""
		s.Mode = ""
	} else if u.Password != nil && *u.Password != "" {
		if err := s.setPassword(*u.Password); err != nil {
			return s, err
		}
		s.Mode = ""
	}
	return s, nil
}

func handleCompassSettings(w http.ResponseWriter, r *http.Request) {
	compassMu.Lock()
	defer compassMu.Unlock()
	s, err := loadCompass()
	if err != nil {
		writeJSONStatus(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, compassPublic(s))
	case http.MethodPost:
		if !requireJSON(w, r) {
			return
		}
		var u compassUpdate
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&u); err != nil {
			writeJSONStatus(w, http.StatusBadRequest, map[string]any{"error": "bad request: " + err.Error()})
			return
		}
		s, err = applyCompassUpdate(s, u)
		if err != nil {
			writeJSONStatus(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
			return
		}
		if err := saveCompass(s); err != nil {
			writeJSONStatus(w, http.StatusInternalServerError, map[string]any{"error": "couldn't save: " + err.Error()})
			return
		}
		writeJSON(w, compassPublic(s))
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

/* ---------------- connecting ---------------- */

func quoteIdent(s string) string { return "`" + strings.ReplaceAll(s, "`", "``") + "`" }

// compassConn is one read-only connection to Compass.
type compassConn struct {
	db       *sql.DB
	conn     *sql.Conn
	key      string    // the way in: "ssl", "nossl" or "oldpw"
	mode     string    // how it got in, for people, e.g. "SSL off"
	hello    helloInfo // what the server said first
	readOnly bool      // the server put the session in READ ONLY mode
}

func (c *compassConn) Close() {
	if c.conn != nil {
		c.conn.Close()
	}
	if c.db != nil {
		c.db.Close()
	}
}

// serverHello records what the server sent first. MySQL speaks first, with
// a greeting that names its version (or with an error when it won't let
// this PC in at all); an SSH server speaks first too, with its banner. Only
// what the app's own connection reads is recorded — no extra connections.
type serverHello struct {
	dialErr error
	raw     []byte
}

// helloInfo is what a serverHello says, for people.
type helloInfo struct {
	Kind    string // "mysql", "mysql-error", "ssh", "other", or "" (nothing arrived)
	Version string // MySQL's version, e.g. 5.1.73-log
	Code    int    // MySQL error number, when it refused straight away
	Message string // MySQL's refusal, or the SSH banner
}

var errSSHPort = errors.New("this port answers with SSH (remote login), not MySQL")

type tapConn struct {
	net.Conn
	h *serverHello
}

func (c *tapConn) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	if room := 256 - len(c.h.raw); room > 0 && n > 0 {
		c.h.raw = append(c.h.raw, p[:min(n, room)]...)
	}
	if len(c.h.raw) >= 4 && string(c.h.raw[:4]) == "SSH-" {
		// Don't wait for a MySQL greeting that will never come.
		return 0, errSSHPort
	}
	return n, err
}

func (h *serverHello) info() helloInfo {
	r := h.raw
	printable := func(b []byte) string {
		var out []rune
		for _, c := range b {
			if c == '\r' || c == '\n' || c == 0 {
				break
			}
			if c >= 32 && c < 127 {
				out = append(out, rune(c))
			}
		}
		return string(out)
	}
	switch {
	case len(r) == 0:
		return helloInfo{}
	case len(r) >= 4 && string(r[:4]) == "SSH-":
		return helloInfo{Kind: "ssh", Message: printable(r)}
	case len(r) < 5:
		return helloInfo{Kind: "other"}
	}
	payload := r[4:]
	if n := int(r[0]) | int(r[1])<<8 | int(r[2])<<16; n < len(payload) {
		payload = payload[:n]
	}
	switch payload[0] {
	case 10: // protocol 10 greeting: version, NUL-terminated
		if i := bytes.IndexByte(payload[1:], 0); i > 0 {
			v := printable(payload[1 : 1+i])
			if strings.HasPrefix(v, "5.5.5-") && strings.Contains(v, "MariaDB") {
				v = strings.TrimPrefix(v, "5.5.5-") // MariaDB's prefix for old clients
			}
			return helloInfo{Kind: "mysql", Version: v}
		}
	case 0xff: // error: number, then (with a '#' and SQL state) the message
		if len(payload) >= 3 {
			msg := payload[3:]
			if len(msg) > 6 && msg[0] == '#' {
				msg = msg[6:]
			}
			return helloInfo{Kind: "mysql-error", Code: int(payload[1]) | int(payload[2])<<8, Message: printable(msg)}
		}
	}
	return helloInfo{Kind: "other"}
}

func compassConfig(s compassSettings, pw, tls string, oldPasswords bool, h *serverHello) *mysql.Config {
	cfg := mysql.NewConfig()
	cfg.User = s.Username
	cfg.Passwd = pw
	cfg.Net = "tcp"
	cfg.Addr = net.JoinHostPort(s.Server, strconv.Itoa(s.Port))
	cfg.DBName = s.Database
	cfg.Timeout = 6 * time.Second
	cfg.ReadTimeout = 60 * time.Second
	cfg.WriteTimeout = 30 * time.Second
	cfg.AllowNativePasswords = true
	cfg.AllowOldPasswords = oldPasswords
	cfg.TLSConfig = tls
	cfg.DialFunc = func(ctx context.Context, network, addr string) (net.Conn, error) {
		c, err := (&net.Dialer{}).DialContext(ctx, network, addr)
		if err != nil {
			h.dialErr = err
			return nil, err
		}
		return &tapConn{Conn: c, h: h}, nil
	}
	return cfg
}

// compassOpenError is a failed connect: the most telling of the errors from
// each way the app tried, plus what the server said first.
type compassOpenError struct {
	err     error
	hello   helloInfo
	dialErr error // the port couldn't be reached at all
}

func (e *compassOpenError) Error() string { return e.err.Error() }
func (e *compassOpenError) Unwrap() error { return e.err }

type compassAttempt struct {
	key, tls string
	old      bool
	mode     string
}

// compassAttempts lists the ways in for the SSL setting, the one that
// worked last time first. "Use if the server has it" falls back to SSL off
// when the server's SSL can't be used (MySQL 5.1's is too old for modern
// encryption); "Required" never sends anything without SSL.
func compassAttempts(s compassSettings) []compassAttempt {
	var tries []compassAttempt
	switch s.TLS {
	case "on":
		tries = []compassAttempt{
			{"ssl", "skip-verify", false, "SSL on"},
			{"oldpw", "skip-verify", true, "SSL on, old-style password"},
		}
	case "off":
		tries = []compassAttempt{
			{"nossl", "false", false, "SSL off"},
			{"oldpw", "false", true, "SSL off, old-style password"},
		}
	default:
		tries = []compassAttempt{
			{"ssl", "preferred", false, "SSL if available"},
			{"nossl", "false", false, "SSL off — the server's SSL can't be used"},
			{"oldpw", "false", true, "SSL off, old-style password"},
		}
	}
	for i, a := range tries {
		if a.key == s.Mode && i > 0 {
			tries = append([]compassAttempt{a}, append(tries[:i:i], tries[i+1:]...)...)
			break
		}
	}
	return tries
}

// openCompass connects with the saved settings, falling back the way
// Margin Master's troubleshooter does: SSL off if the server's SSL can't be
// used, and old-style passwords if the account still uses them.
func openCompass(ctx context.Context, s compassSettings, pw string) (*compassConn, error) {
	var (
		best      error
		bestIsSQL bool
		first     *serverHello
	)
	tries := compassAttempts(s)
	for i, a := range tries {
		h := &serverHello{}
		if first == nil {
			first = h
		}
		connector, err := mysql.NewConnector(compassConfig(s, pw, a.tls, a.old, h))
		if err != nil {
			return nil, err
		}
		db := sql.OpenDB(connector)
		db.SetMaxOpenConns(1)
		conn, err := db.Conn(ctx)
		if err == nil {
			err = conn.PingContext(ctx)
		}
		if err == nil {
			// Belt and braces: the app only runs SELECTs, but ask the server
			// to refuse anything else too. MySQL before 5.6 can't.
			_, roErr := conn.ExecContext(ctx, "SET SESSION TRANSACTION READ ONLY")
			return &compassConn{db: db, conn: conn, key: a.key, mode: a.mode, hello: h.info(), readOnly: roErr == nil}, nil
		}
		if conn != nil {
			conn.Close()
		}
		db.Close()
		// Keep the server's own words over a network or SSL error.
		var me *mysql.MySQLError
		if errors.As(err, &me) {
			best, bestIsSQL = err, true
		} else if !bestIsSQL {
			best = err
		}
		if h.dialErr != nil || h.info().Kind == "ssh" {
			break
		}
		// Only retry for problems a different SSL/password mode can fix.
		if i+1 < len(tries) && !retryableLogin(err) {
			break
		}
	}
	hello := first.info()
	if hello.Kind == "ssh" {
		best = errSSHPort // the driver only says "invalid connection"
	}
	return nil, &compassOpenError{err: best, hello: hello, dialErr: first.dialErr}
}

func retryableLogin(err error) bool {
	if errors.Is(err, mysql.ErrOldPassword) || errors.Is(err, mysql.ErrNoTLS) {
		return true
	}
	m := strings.ToLower(err.Error())
	return strings.Contains(m, "tls") || strings.Contains(m, "ssl") || strings.Contains(m, "old password") ||
		strings.Contains(m, "handshake") || strings.Contains(m, "authentication plugin")
}

// rememberCompassMode saves the way in that worked, so the next connect
// doesn't have to fail its way there (see compassSettings.Mode).
func rememberCompassMode(s compassSettings, key string) {
	if key == s.Mode {
		return
	}
	compassMu.Lock()
	defer compassMu.Unlock()
	cur, err := loadCompass()
	if err != nil || cur.Server != s.Server || cur.Port != s.Port || cur.Database != s.Database ||
		cur.Username != s.Username || cur.TLS != s.TLS || cur.Password != s.Password {
		return // the settings changed meanwhile
	}
	cur.Mode = key
	_ = saveCompass(cur)
}

// explainMySQLError turns a driver error into what to do about it.
func explainMySQLError(err error) (detail, fix string) {
	var me *mysql.MySQLError
	if errors.As(err, &me) {
		switch me.Number {
		case 1045:
			return "The server refused the username or password (" + me.Message + ").",
				"Check the username and password match Margin Master's Epicor tab. If they do, this login may not be allowed from this computer — the Eagle server only lets approved computers in."
		case 1129:
			return "The server has blocked this computer after too many failed connection attempts (" + me.Message + ").",
				"Don't keep retrying — every try counts against it. Ask Epicor to run FLUSH HOSTS on the Compass MySQL server to unblock it."
		case 1130:
			return "The server doesn't allow this computer to connect (" + me.Message + ").",
				"The Eagle server only lets approved computers in. Ask whoever enabled Margin Master's access (Margin Master support or Epicor) to allow this PC too."
		case 1044, 1049:
			return "The database isn't there or this login can't open it (" + me.Message + ").",
				"Copy the Database name exactly as it appears in Margin Master's Epicor tab."
		}
		return me.Message, ""
	}
	m := err.Error()
	switch {
	case errors.Is(err, errSSHPort):
		return "That port answers with SSH (remote login), not MySQL.", "Use MySQL's port — usually 3306."
	case errors.Is(err, context.DeadlineExceeded) || strings.Contains(m, "i/o timeout"):
		return "The server didn't answer in time.", "Check the server address and port. An Epicor-hosted server is reached through the store's VPN — check this PC can reach it."
	case strings.Contains(m, "connection refused"):
		return "Nothing is listening on that port.", "Check the port number — MySQL usually uses 3306."
	case strings.Contains(m, "tls:") || errors.Is(err, mysql.ErrNoTLS):
		return "SSL (encryption) couldn't be set up with this server (" + m + ").", "Older Compass servers have SSL too old to use. Set SSL to \"Use if the server has it\" or Off."
	}
	return m, ""
}

/* ---------------- the connection test ---------------- */

type compassCheck struct {
	Name   string `json:"name"`
	Status string `json:"status"` // pass, warn, fail, skip
	Detail string `json:"detail"`
	Fix    string `json:"fix,omitempty"`
}

type compassTestResult struct {
	OK      bool           `json:"ok"`
	Checks  []compassCheck `json:"checks"`
	Version string         `json:"version,omitempty"`
	Mode    string         `json:"mode,omitempty"`
	InTable string         `json:"inTable,omitempty"`
	InRows  int64          `json:"inRows"`
}

func ipInLocalNetwork(ip net.IP) bool {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return false
	}
	for _, a := range addrs {
		if n, ok := a.(*net.IPNet); ok && n.Contains(ip) {
			return true
		}
	}
	return false
}

// runCompassTest runs every check (like Margin Master's troubleshooter)
// rather than stopping at the first problem.
func runCompassTest(ctx context.Context, s compassSettings) compassTestResult {
	var res compassTestResult
	add := func(name, status, detail, fix string) {
		res.Checks = append(res.Checks, compassCheck{name, status, detail, fix})
	}
	skipRest := func(names ...string) {
		for _, n := range names {
			add(n, "skip", "Skipped — fix the problem above first.", "")
		}
	}

	var missing []string
	if s.Server == "" {
		missing = append(missing, "Server")
	}
	if s.Database == "" {
		missing = append(missing, "Database")
	}
	if s.Username == "" {
		missing = append(missing, "Username")
	}
	if len(missing) > 0 {
		add("Connection settings", "fail", "Missing: "+strings.Join(missing, ", ")+".", "Copy them from Margin Master: Options → POS / Connections → Epicor tab (Connect via MySQL / Compass).")
		skipRest("Server address", "Network path", "MySQL port", "MySQL login", "Database", "Inventory (IN) table", "Link speed")
		return res
	}
	pw, err := s.password()
	if err != nil {
		add("Connection settings", "fail", err.Error(), "")
		skipRest("Server address", "Network path", "MySQL port", "MySQL login", "Database", "Inventory (IN) table", "Link speed")
		return res
	}
	pwNote := ""
	if pw == "" {
		pwNote = " No password is saved."
	}
	add("Connection settings", "pass", fmt.Sprintf("%s:%d, database %s, user %s.%s", s.Server, s.Port, s.Database, s.Username, pwNote), "")

	// Server address
	var ip net.IP
	if ip = net.ParseIP(s.Server); ip == nil {
		lctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		ips, err := net.DefaultResolver.LookupIPAddr(lctx, s.Server)
		cancel()
		if err != nil || len(ips) == 0 {
			add("Server address", "fail", "\""+s.Server+"\" doesn't resolve to an address.", "Use the server's IP address from Margin Master's Epicor tab.")
			skipRest("Network path", "MySQL port", "MySQL login", "Database", "Inventory (IN) table", "Link speed")
			return res
		}
		ip = ips[0].IP
		add("Server address", "pass", s.Server+" is "+ip.String()+".", "")
	} else {
		add("Server address", "pass", "IP address "+ip.String()+".", "")
	}

	// Network path
	switch {
	case ip.IsLoopback():
		add("Network path", "pass", "The server is this computer.", "")
	case ipInLocalNetwork(ip):
		add("Network path", "pass", "On the same network as this PC.", "")
	case ip.IsPrivate():
		add("Network path", "pass", "On another network, reached through a router or VPN — normal for an Epicor-hosted Eagle server.", "")
	default:
		add("Network path", "warn", "A public (internet) address.", "Compass is normally reached on a private address over the store network or VPN; use the exact host and port Epicor gave you.")
	}

	// MySQL port and login. The login's own connection doubles as the port
	// check: old MySQL servers count every abandoned connection against this
	// PC (and lock it out after a handful), so the test opens no extra ones.
	cctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	cc, err := openCompass(cctx, s, pw)
	cancel()
	if err != nil {
		var oe *compassOpenError
		if !errors.As(err, &oe) {
			add("MySQL login", "fail", err.Error(), "")
			skipRest("Database", "Inventory (IN) table", "Link speed")
			return res
		}
		portFail := func(detail, fix string) compassTestResult {
			add("MySQL port", "fail", detail, fix)
			skipRest("MySQL login", "Database", "Inventory (IN) table", "Link speed")
			return res
		}
		switch oe.hello.Kind {
		case "mysql", "mysql-error":
			add("MySQL port", "pass", portDetail(s.Port, oe.hello), "")
		case "ssh":
			return portFail(fmt.Sprintf("Port %d answers with SSH (%s), the server's remote login — not MySQL.", s.Port, oe.hello.Message), "Use MySQL's port instead — usually 3306.")
		case "other":
			return portFail(fmt.Sprintf("Port %d is open, but what answers isn't MySQL.", s.Port), "Check the port number — MySQL usually uses 3306.")
		default:
			if oe.dialErr == nil {
				return portFail(fmt.Sprintf("Port %d is open, but nothing answered.", s.Port), "Check the port number (MySQL usually uses 3306) and, for an Epicor-hosted server, that the store's VPN is up.")
			}
			fix := "Check the port, and that a firewall isn't blocking this PC."
			for _, p := range []int{3306, 3307, 3308, 3309, 3310, 13306} {
				if p == s.Port {
					continue
				}
				alt, err := (&net.Dialer{Timeout: 1500 * time.Millisecond}).DialContext(ctx, "tcp", net.JoinHostPort(ip.String(), strconv.Itoa(p)))
				if err == nil {
					alt.Close()
					fix = fmt.Sprintf("Something answers on port %d instead — try that port.", p)
					break
				}
			}
			return portFail(fmt.Sprintf("Port %d isn't reachable (%v).", s.Port, shortNetErr(oe.dialErr)), fix)
		}
		detail, fix := explainMySQLError(err)
		var me *mysql.MySQLError
		if errors.As(err, &me) && (me.Number == 1044 || me.Number == 1049) {
			add("MySQL login", "pass", "Logged in.", "")
			add("Database", "fail", detail, fix)
			skipRest("Inventory (IN) table", "Link speed")
			return res
		}
		add("MySQL login", "fail", detail, fix)
		skipRest("Database", "Inventory (IN) table", "Link speed")
		return res
	}
	defer cc.Close()
	rememberCompassMode(s, cc.key)
	res.Mode = cc.mode
	add("MySQL port", "pass", portDetail(s.Port, cc.hello), "")
	loginStatus, loginDetail := "pass", "Logged in as "+s.Username+" ("+cc.mode+")."
	if cc.key == "oldpw" {
		loginStatus = "warn"
		loginDetail += " This login still uses MySQL's old, weak password scheme."
	}
	if !cc.readOnly {
		loginDetail += " This MySQL version can't lock the session to read-only, but the app only ever reads."
	}
	add("MySQL login", loginStatus, loginDetail, "")

	qctx, qcancel := context.WithTimeout(ctx, 15*time.Second)
	defer qcancel()
	var dbName, version string
	if err := cc.conn.QueryRowContext(qctx, "SELECT DATABASE(), VERSION()").Scan(&dbName, &version); err != nil {
		detail, fix := explainMySQLError(err)
		add("Database", "fail", detail, fix)
		skipRest("Inventory (IN) table", "Link speed")
		return res
	}
	res.Version = version
	add("Database", "pass", "Opened "+dbName+" on MySQL "+version+".", "")

	// Inventory table
	var tbl string
	var rows sql.NullInt64
	err = cc.conn.QueryRowContext(qctx, "SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND UPPER(TABLE_NAME) = 'IN' LIMIT 1").Scan(&tbl, &rows)
	switch {
	case err == nil:
		res.InTable = tbl
		res.InRows = rows.Int64
		// TABLE_ROWS is an estimate; count exactly when it's small or zero.
		about := "about "
		if rows.Int64 < 200000 {
			var n int64
			if cc.conn.QueryRowContext(qctx, "SELECT COUNT(*) FROM "+quoteIdent(tbl)).Scan(&n) == nil {
				res.InRows = n
				about = ""
			}
		}
		if res.InRows == 0 {
			add("Inventory (IN) table", "warn", "The "+tbl+" table is there but empty.", "Check with your Epicor administrator that Compass is running and up to date.")
		} else {
			add("Inventory (IN) table", "pass", fmt.Sprintf("%s table has %s%d rows.", tbl, about, res.InRows), "")
		}
	case errors.Is(err, sql.ErrNoRows):
		var n int
		_ = cc.conn.QueryRowContext(qctx, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()").Scan(&n)
		add("Inventory (IN) table", "warn", fmt.Sprintf("No table named IN in %s (it has %d tables).", dbName, n), "Run Explore — it lists every table so we can find where inventory lives.")
	default:
		detail, _ := explainMySQLError(err)
		add("Inventory (IN) table", "warn", "Couldn't list tables: "+detail, "")
	}

	// Link speed
	var total, worst time.Duration
	const pings = 5
	ok := true
	for i := 0; i < pings; i++ {
		t0 := time.Now()
		var one int
		if err := cc.conn.QueryRowContext(qctx, "SELECT 1").Scan(&one); err != nil {
			ok = false
			break
		}
		el := time.Since(t0)
		total += el
		if el > worst {
			worst = el
		}
	}
	if ok {
		avg := total / pings
		detail := fmt.Sprintf("Average %d ms, worst %d ms.", avg.Milliseconds(), worst.Milliseconds())
		if avg > 150*time.Millisecond {
			add("Link speed", "warn", detail+" That's a slow link.", "Reading the whole inventory will take longer; if it times out, check the store's connection to the server.")
		} else {
			add("Link speed", "pass", detail, "")
		}
	}

	res.OK = true
	for _, c := range res.Checks {
		if c.Status == "fail" {
			res.OK = false
		}
	}
	return res
}

func portDetail(port int, h helloInfo) string {
	if h.Version != "" {
		return fmt.Sprintf("Port %d is open — MySQL %s answered.", port, h.Version)
	}
	return fmt.Sprintf("Port %d is open — MySQL answered.", port)
}

func shortNetErr(err error) string {
	m := err.Error()
	switch {
	case strings.Contains(m, "refused"):
		return "connection refused"
	case strings.Contains(m, "timeout"):
		return "no answer"
	case strings.Contains(m, "unreachable"):
		return "network unreachable"
	}
	return m
}

func handleCompassTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !requireJSON(w, r) {
		return
	}
	compassMu.Lock()
	s, err := loadCompass()
	compassMu.Unlock()
	if err != nil {
		writeJSONStatus(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	writeJSON(w, runCompassTest(ctx, s))
}

/* ---------------- explore ---------------- */

type exploreTable struct {
	Name    string `json:"name"`
	Rows    int64  `json:"rows"`
	Columns int    `json:"columns"`
}

type exploreColumn struct {
	Table string `json:"table"`
	Name  string `json:"name"`
	Type  string `json:"type"`
}

type exploreLoc struct {
	exploreColumn
	Examples []string `json:"examples"`
}

type exploreMatch struct {
	Table  string     `json:"table"`
	Column string     `json:"column"`
	What   string     `json:"what"` // "sku" or "location"
	Rows   [][]string `json:"rows"` // "column=value" pairs, non-empty values only
}

type exploreReport struct {
	Generated string          `json:"generated"`
	Server    string          `json:"server"`
	Database  string          `json:"database"`
	Version   string          `json:"version"`
	Mode      string          `json:"mode"`
	Tables    []exploreTable  `json:"tables"`
	InColumns []exploreColumn `json:"inColumns"`
	InSample  [][]string      `json:"inSample"`
	LocCols   []exploreLoc    `json:"locationColumns"`
	Matches   []exploreMatch  `json:"matches"`
	Notes     []string        `json:"notes"`
	Text      string          `json:"text"`
}

var (
	locNameRe = regexp.MustCompile(`(?i)loc|bin|shelf|aisle|slot`)
	keyNameRe = regexp.MustCompile(`(?i)sku|item|prod|upc|^num|number|code|key|part`)
	textType  = regexp.MustCompile(`(?i)char|text|enum`)
	numType   = regexp.MustCompile(`(?i)int|dec|num|float|double`)
)

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if len([]rune(s)) <= n {
		return s
	}
	return string([]rune(s)[:n]) + "…"
}

func scanStrings(rows *sql.Rows) ([]string, [][]string, error) {
	cols, err := rows.Columns()
	if err != nil {
		return nil, nil, err
	}
	var out [][]string
	for rows.Next() {
		raw := make([]sql.RawBytes, len(cols))
		ptrs := make([]any, len(cols))
		for i := range raw {
			ptrs[i] = &raw[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return cols, out, err
		}
		row := make([]string, len(cols))
		for i, b := range raw {
			if b == nil {
				row[i] = "NULL"
			} else {
				row[i] = string(b)
			}
		}
		out = append(out, row)
	}
	return cols, out, rows.Err()
}

// runCompassExplore maps out what's in the Compass database so the SKU,
// description and six location columns can be found: every table, the IN
// table's columns and a few rows, columns whose names look like locations
// (with example values), and — when given a SKU and/or a location the
// user knows — exactly which columns hold those values.
func runCompassExplore(ctx context.Context, s compassSettings, sku, loc string) (*exploreReport, error) {
	pw, err := s.password()
	if err != nil {
		return nil, err
	}
	octx, cancel := context.WithTimeout(ctx, 25*time.Second)
	cc, err := openCompass(octx, s, pw)
	cancel()
	if err != nil {
		detail, fix := explainMySQLError(err)
		return nil, errors.New(strings.TrimSpace(detail + " " + fix))
	}
	defer cc.Close()
	rememberCompassMode(s, cc.key)
	rep := &exploreReport{Generated: time.Now().Format("2006-01-02 15:04"), Server: fmt.Sprintf("%s:%d", s.Server, s.Port), Database: s.Database, Mode: cc.mode}
	note := func(f string, a ...any) { rep.Notes = append(rep.Notes, fmt.Sprintf(f, a...)) }
	q := func(timeout time.Duration, query string, args ...any) ([]string, [][]string, error) {
		qctx, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()
		rows, err := cc.conn.QueryContext(qctx, query, args...)
		if err != nil {
			return nil, nil, err
		}
		defer rows.Close()
		return scanStrings(rows)
	}

	if _, r, err := q(10*time.Second, "SELECT VERSION()"); err == nil && len(r) > 0 {
		rep.Version = r[0][0]
	}

	// Tables and columns.
	_, trows, err := q(30*time.Second, "SELECT TABLE_NAME, COALESCE(TABLE_ROWS, 0) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME LIMIT 3000")
	if err != nil {
		return nil, fmt.Errorf("couldn't list the tables: %v", err)
	}
	_, crows, err := q(60*time.Second, "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION")
	if err != nil {
		return nil, fmt.Errorf("couldn't list the columns: %v", err)
	}
	colsBy := map[string][]exploreColumn{}
	for _, r := range crows {
		colsBy[r[0]] = append(colsBy[r[0]], exploreColumn{Table: r[0], Name: r[1], Type: r[2]})
	}
	rowsBy := map[string]int64{}
	inTable := ""
	for _, r := range trows {
		n, _ := strconv.ParseInt(r[1], 10, 64)
		rowsBy[r[0]] = n
		rep.Tables = append(rep.Tables, exploreTable{Name: r[0], Rows: n, Columns: len(colsBy[r[0]])})
		if strings.EqualFold(r[0], "IN") {
			inTable = r[0]
		}
	}
	sort.SliceStable(rep.Tables, func(i, j int) bool { return rep.Tables[i].Rows > rep.Tables[j].Rows })

	// The inventory (IN) table.
	if inTable != "" {
		rep.InColumns = colsBy[inTable]
		cols, sample, err := q(30*time.Second, "SELECT * FROM "+quoteIdent(inTable)+" LIMIT 3")
		if err != nil {
			note("Couldn't read sample rows from %s: %v", inTable, err)
		} else {
			for _, row := range sample {
				var pairs []string
				for i, v := range row {
					if strings.TrimSpace(v) != "" && v != "NULL" {
						pairs = append(pairs, cols[i]+"="+clip(v, 40))
					}
				}
				rep.InSample = append(rep.InSample, pairs)
			}
		}
	} else {
		note("No table named IN — see the table list for where inventory lives.")
	}

	// Columns whose names look like locations, with example values.
	var locCols []exploreColumn
	for _, t := range rep.Tables {
		for _, c := range colsBy[t.Name] {
			if locNameRe.MatchString(c.Name) && textType.MatchString(c.Type) {
				locCols = append(locCols, c)
			}
		}
	}
	if len(locCols) > 60 {
		note("%d location-like columns; examples shown for the first 60.", len(locCols))
		locCols = locCols[:60]
	}
	for _, c := range locCols {
		_, vals, err := q(10*time.Second, fmt.Sprintf("SELECT %s FROM %s WHERE %s IS NOT NULL AND %s <> '' LIMIT 40", quoteIdent(c.Name), quoteIdent(c.Table), quoteIdent(c.Name), quoteIdent(c.Name)))
		lc := exploreLoc{exploreColumn: c}
		if err != nil {
			note("Couldn't sample %s.%s: %v", c.Table, c.Name, err)
		}
		seen := map[string]bool{}
		for _, v := range vals {
			x := strings.TrimSpace(v[0])
			if !seen[x] && len(lc.Examples) < 10 {
				seen[x] = true
				lc.Examples = append(lc.Examples, clip(x, 20))
			}
		}
		rep.LocCols = append(rep.LocCols, lc)
	}

	// Where do a known SKU / location live?
	search := func(value, what string, pick func(exploreColumn) bool, tables []string, maxQueries int) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		isNum := regexp.MustCompile(`^\d+$`).MatchString(value)
		queries := 0
		for _, t := range tables {
			for _, c := range colsBy[t] {
				if !pick(c) || (numType.MatchString(c.Type) && !isNum) {
					continue
				}
				if queries >= maxQueries {
					note("Stopped the %s search after %d columns.", what, maxQueries)
					return
				}
				queries++
				cols, found, err := q(10*time.Second, fmt.Sprintf("SELECT * FROM %s WHERE %s = ? LIMIT 2", quoteIdent(t), quoteIdent(c.Name)), value)
				if err != nil || len(found) == 0 {
					continue
				}
				m := exploreMatch{Table: t, Column: c.Name, What: what}
				for _, row := range found {
					var pairs []string
					for i, v := range row {
						if strings.TrimSpace(v) != "" && v != "NULL" {
							pairs = append(pairs, cols[i]+"="+clip(v, 40))
						}
					}
					m.Rows = append(m.Rows, pairs)
				}
				rep.Matches = append(rep.Matches, m)
			}
		}
	}
	ordered := func(filter func(string) bool) []string {
		var out []string
		if inTable != "" && filter(inTable) {
			out = append(out, inTable)
		}
		for _, t := range rep.Tables {
			if t.Name != inTable && t.Rows > 0 && filter(t.Name) {
				out = append(out, t.Name)
			}
		}
		return out
	}
	hasKeyCol := func(t string) bool {
		for _, c := range colsBy[t] {
			if keyNameRe.MatchString(c.Name) {
				return true
			}
		}
		return false
	}
	search(sku, "sku", func(c exploreColumn) bool { return keyNameRe.MatchString(c.Name) }, ordered(hasKeyCol), 80)
	// A known location: every text column of IN, plus location-like columns elsewhere.
	locTables := ordered(func(t string) bool {
		if strings.EqualFold(t, inTable) {
			return true
		}
		for _, c := range colsBy[t] {
			if locNameRe.MatchString(c.Name) {
				return true
			}
		}
		return false
	})
	search(strings.ToUpper(loc), "location", func(c exploreColumn) bool {
		return textType.MatchString(c.Type) && (strings.EqualFold(c.Table, inTable) || locNameRe.MatchString(c.Name))
	}, locTables, 200)

	rep.Text = exploreText(rep, sku, loc)
	return rep, nil
}

func exploreText(r *exploreReport, sku, loc string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Ace Location Studio %s — Compass explore report\n", appVersion)
	fmt.Fprintf(&b, "Made %s · %s · database %s · MySQL %s · %s\n\n", r.Generated, r.Server, r.Database, r.Version, r.Mode)
	if sku != "" || loc != "" {
		fmt.Fprintf(&b, "== Searched for: SKU %q, location %q\n", sku, strings.ToUpper(loc))
		if len(r.Matches) == 0 {
			b.WriteString("   (no column holds those values exactly)\n")
		}
		for _, m := range r.Matches {
			fmt.Fprintf(&b, "   %s found in %s.%s\n", map[string]string{"sku": "SKU", "location": "Location"}[m.What], m.Table, m.Column)
			for _, row := range m.Rows {
				fmt.Fprintf(&b, "      %s\n", strings.Join(row, " | "))
			}
		}
		b.WriteString("\n")
	}
	if len(r.InColumns) > 0 {
		fmt.Fprintf(&b, "== Inventory table %s (%d columns)\n", r.InColumns[0].Table, len(r.InColumns))
		for _, c := range r.InColumns {
			fmt.Fprintf(&b, "   %-32s %s\n", c.Name, c.Type)
		}
		for i, row := range r.InSample {
			fmt.Fprintf(&b, "   sample row %d: %s\n", i+1, strings.Join(row, " | "))
		}
		b.WriteString("\n")
	}
	fmt.Fprintf(&b, "== Location-like columns (%d)\n", len(r.LocCols))
	for _, c := range r.LocCols {
		fmt.Fprintf(&b, "   %s.%s  %s  e.g. %s\n", c.Table, c.Name, c.Type, strings.Join(c.Examples, ", "))
	}
	fmt.Fprintf(&b, "\n== Tables (%d, largest first)\n", len(r.Tables))
	for _, t := range r.Tables {
		fmt.Fprintf(&b, "   %-36s ~%d rows, %d columns\n", t.Name, t.Rows, t.Columns)
	}
	if len(r.Notes) > 0 {
		b.WriteString("\n== Notes\n")
		for _, n := range r.Notes {
			fmt.Fprintf(&b, "   %s\n", n)
		}
	}
	return b.String()
}

func handleCompassExplore(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !requireJSON(w, r) {
		return
	}
	var req struct {
		SKU      string `json:"sku"`
		Location string `json:"location"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&req); err != nil {
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"error": "bad request"})
		return
	}
	if len(req.SKU) > 20 || len(req.Location) > 10 {
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"error": "that SKU or location is too long"})
		return
	}
	compassMu.Lock()
	s, err := loadCompass()
	compassMu.Unlock()
	if err != nil {
		writeJSONStatus(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if s.Server == "" || s.Database == "" || s.Username == "" {
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"error": "save the connection settings first"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Minute)
	defer cancel()
	rep, err := runCompassExplore(ctx, s, req.SKU, req.Location)
	if err != nil {
		writeJSONStatus(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, rep)
}
