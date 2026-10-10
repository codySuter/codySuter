package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

// The fixtures are synthetic Eagle exports (see testdata/make_fixtures.py).
var sampleRows = []EagleRow{
	{"70013", `ACE SHOVEL SQ PT 27"`, [6]string{"12R02", "", "6", "", "", ""}},
	{"70018", "ACE SHOVEL RND PT", [6]string{"12R02", "", "5", "USTOR", "", ""}},
	{"779600", "TEST RAKE 16 TINE", [6]string{"12R07", "", "100", "12R06", "", ""}},
	{"3008391", "TEST HOSE 50FT", [6]string{"14L05", "", "4", "12R01", "", ""}},
	{"6209563", "TEST FLAG ONLY", [6]string{"", "12R06", "", "", "", ""}},
	{"6707640", "TEST MARKDOWN ITEM", [6]string{"12R08", "MDONE", "", "", "", ""}},
	{"7000137D", "TEST PRUNER — BYPASS™", [6]string{"12R05", "", "3", "", "", ""}},
	{"9087035", "TEST OVERSTOCK ONLY", [6]string{"", "", "", "12R04", "", ""}},
	{"5555555", "OTHER AISLE ITEM", [6]string{"14L02", "", "12", "107", "", ""}},
}

func loadFixture(t *testing.T, name string) *EagleFile {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	sheet, grid, err := readSheet(name, data)
	if err != nil {
		t.Fatalf("readSheet(%s): %v", name, err)
	}
	ef, err := parseEagle(name, sheet, grid)
	if err != nil {
		t.Fatalf("parseEagle(%s): %v", name, err)
	}
	return ef
}

func TestReadEagleXLS(t *testing.T) {
	ef := loadFixture(t, "eagle-sample.xls")
	if ef.Sheet != "Sheet1" || ef.Layout != "export" || ef.HeaderRow != 1 {
		t.Fatalf("sheet=%q layout=%q headerRow=%d", ef.Sheet, ef.Layout, ef.HeaderRow)
	}
	// The "Current …" columns are used, not the blank "Location N" ones.
	want := []string{"SKU", "Description", "Current\nLocation\nCodes", "Current\nLocation\n2", "Current\nLocation\n3", "Current\nLocation\n4", "Current\nLocation\n5", "Current\nLocation\n6"}
	if !reflect.DeepEqual(ef.Columns, want) {
		t.Fatalf("columns = %q", ef.Columns)
	}
	if !reflect.DeepEqual(ef.Rows, sampleRows) {
		t.Fatalf("rows differ:\n got %+v\nwant %+v", ef.Rows, sampleRows)
	}
	if len(ef.Warnings) != 0 {
		t.Fatalf("warnings: %v", ef.Warnings)
	}
}

// The big fixture's string table spans many CONTINUE records, with wide
// (non-Latin-1) strings scattered through it.
func TestReadEagleXLSLargeStringTable(t *testing.T) {
	ef := loadFixture(t, "eagle-big.xls")
	if got := len(ef.Rows); got != len(sampleRows)+1200 {
		t.Fatalf("rows = %d", got)
	}
	re := regexp.MustCompile(`^SYNTH ITEM (\d{5}) ([—-]) \d+PK$`)
	for i, r := range ef.Rows[len(sampleRows):] {
		m := re.FindStringSubmatch(r.Desc)
		if m == nil {
			t.Fatalf("row %d desc %q", i, r.Desc)
		}
		if m[1] != fmt.Sprintf("%05d", i) || r.SKU != fmt.Sprint(8000000+i) {
			t.Fatalf("row %d out of order: sku %s desc %q", i, r.SKU, r.Desc)
		}
		if wantDash := map[bool]string{true: "—", false: "-"}[i%7 == 0]; m[2] != wantDash {
			t.Fatalf("row %d dash %q", i, m[2])
		}
		if r.Locs[0] == "" || r.Locs[2] == "" {
			t.Fatalf("row %d locs %q", i, r.Locs)
		}
	}
	last := ef.Rows[len(ef.Rows)-1]
	if last.SKU != "8001199" || last.Locs != [6]string{"17R03", "", "16", "USTOR", "", ""} {
		t.Fatalf("last row %+v", last)
	}
}

func TestReadEagleXLSX(t *testing.T) {
	ef := loadFixture(t, "eagle-sample.xlsx")
	if ef.Sheet != "Locations" || ef.Layout != "export" {
		t.Fatalf("sheet=%q layout=%q", ef.Sheet, ef.Layout)
	}
	if !reflect.DeepEqual(ef.Rows, sampleRows) {
		t.Fatalf("rows differ:\n got %+v\nwant %+v", ef.Rows, sampleRows)
	}
}

// A file in the import layout (SKU, Location 1 … 6) loads too.
func TestReadImportLayoutCSV(t *testing.T) {
	ef := loadFixture(t, "eagle-import.csv")
	if ef.Layout != "import" {
		t.Fatalf("layout=%q", ef.Layout)
	}
	if len(ef.Rows) != len(sampleRows) {
		t.Fatalf("rows = %d", len(ef.Rows))
	}
	for i, r := range ef.Rows {
		if r.SKU != sampleRows[i].SKU || r.Locs != sampleRows[i].Locs || r.Desc != "" {
			t.Fatalf("row %d = %+v", i, r)
		}
	}
}

func TestReadCSVWindows1252(t *testing.T) {
	data := []byte("SKU,Description,Location 1,Location 2,Location 3,Location 4,Location 5,Location 6\r\n1,PRUNER \x96 BYPASS,12R01,,3,,,\r\n")
	sheet, grid, err := readSheet("x.csv", data)
	if err != nil {
		t.Fatal(err)
	}
	ef, err := parseEagle("x.csv", sheet, grid)
	if err != nil {
		t.Fatal(err)
	}
	if ef.Rows[0].Desc != "PRUNER – BYPASS" {
		t.Fatalf("desc %q", ef.Rows[0].Desc)
	}
}

func TestParseEagleProblems(t *testing.T) {
	cases := []struct {
		name string
		grid [][]string
		want string
	}{
		{"no sku", [][]string{{"Item", "Location 1"}, {"1", "12R01"}}, `"SKU"`},
		{"missing locs", [][]string{{"SKU", "Current Location Codes", "Current Location 2"}, {"1", "12R01", ""}}, "Current Location 3"},
		{"no rows", [][]string{{"SKU", "Location 1", "Location 2", "Location 3", "Location 4", "Location 5", "Location 6"}, {"", "", ""}}, "no SKUs"},
	}
	for _, c := range cases {
		_, err := parseEagle("f", "", c.grid)
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: err = %v, want it to mention %s", c.name, err, c.want)
		}
	}
}

func TestParseEagleFindsHeaderLowerDown(t *testing.T) {
	grid := [][]string{
		{"Snyder's Ace — location report"},
		nil,
		{"", " sku ", "DESCRIPTION", "Location 1", "Location 2", "Location 3", "Location 4", "Location 5", "Location 6"},
		{"", "100", "A", " 12R01 ", "", "4", "", "", ""},
		{"", "100", "A again", "12R02", "", "", "", "", ""},
		{"", "", "blank sku row is skipped"},
		{"", "101"},
	}
	ef, err := parseEagle("f", "", grid)
	if err != nil {
		t.Fatal(err)
	}
	if ef.HeaderRow != 3 || len(ef.Rows) != 3 {
		t.Fatalf("headerRow=%d rows=%d", ef.HeaderRow, len(ef.Rows))
	}
	if ef.Rows[0].Locs[0] != "12R01" || ef.Rows[2].Locs != [6]string{} {
		t.Fatalf("rows %+v", ef.Rows)
	}
	if len(ef.Warnings) != 1 || !strings.Contains(ef.Warnings[0], "100") {
		t.Fatalf("warnings %v", ef.Warnings)
	}
}

func TestReadSheetRejectsNonSpreadsheets(t *testing.T) {
	for name, data := range map[string][]byte{
		"html":  []byte("<html><table><tr><td>SKU</td></tr></table></html>"),
		"empty": []byte("   \r\n"),
	} {
		if _, _, err := readSheet(name, data); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

// A damaged or truncated .xls must give an error, never crash the app.
func TestReadXLSDamagedNeverPanics(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("testdata", "eagle-big.xls"))
	if err != nil {
		t.Fatal(err)
	}
	for n := 0; n < len(data); n += 509 {
		func() {
			defer func() {
				if r := recover(); r != nil {
					t.Fatalf("panic at length %d: %v", n, r)
				}
			}()
			_, _, _ = readSheet("x.xls", data[:n])
		}()
	}
	// Flip bytes through the middle of the file too.
	for off := 512; off < len(data); off += 1531 {
		bad := append([]byte(nil), data...)
		bad[off] ^= 0xFF
		bad[off+1] ^= 0x5A
		func() {
			defer func() {
				if r := recover(); r != nil {
					t.Fatalf("panic with byte %d flipped: %v", off, r)
				}
			}()
			_, _, _ = readSheet("x.xls", bad)
		}()
	}
}

func TestRKValueAndNumbers(t *testing.T) {
	enc := func(i int32, div100 bool) uint32 {
		v := uint32(i)<<2 | 0x02
		if div100 {
			v |= 0x01
		}
		return v
	}
	if got := rkValue(enc(107, false)); got != 107 {
		t.Fatalf("int rk = %v", got)
	}
	if got := rkValue(enc(-5, false)); got != -5 {
		t.Fatalf("neg rk = %v", got)
	}
	if got := rkValue(enc(1234, true)); got != 12.34 {
		t.Fatalf("div100 rk = %v", got)
	}
	var b [8]byte
	binary.LittleEndian.PutUint64(b[:], 0x4059000000000000) // 100.0
	if got := rkValue(binary.LittleEndian.Uint32(b[4:])); got != 100 {
		t.Fatalf("float rk = %v", got)
	}
	for v, want := range map[float64]string{6: "6", 7000137: "7000137", 2.5: "2.5", 0: "0"} {
		if got := formatNumber(v); got != want {
			t.Errorf("formatNumber(%v) = %q", v, got)
		}
	}
}

/* ---------------- HTTP ---------------- */

func TestParseHandler(t *testing.T) {
	data, _ := os.ReadFile(filepath.Join("testdata", "eagle-sample.xls"))
	req := httptest.NewRequest("POST", "/api/parse", bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("X-File-Name", "12LOCCLEAR%20test.xls")
	rec := httptest.NewRecorder()
	handleParse(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var ef EagleFile
	if err := json.Unmarshal(rec.Body.Bytes(), &ef); err != nil {
		t.Fatal(err)
	}
	if ef.Name != "12LOCCLEAR test.xls" || len(ef.Rows) != len(sampleRows) {
		t.Fatalf("name %q rows %d", ef.Name, len(ef.Rows))
	}

	req = httptest.NewRequest("POST", "/api/parse", strings.NewReader("hello"))
	req.Header.Set("Content-Type", "text/plain")
	rec = httptest.NewRecorder()
	handleParse(rec, req)
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("text/plain accepted: %d", rec.Code)
	}

	req = httptest.NewRequest("POST", "/api/parse", strings.NewReader("Item,Bin\n1,2\n"))
	req.Header.Set("Content-Type", "application/octet-stream")
	rec = httptest.NewRecorder()
	handleParse(rec, req)
	if rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "SKU") {
		t.Fatalf("bad file: %d %s", rec.Code, rec.Body)
	}
}

func postExport(t *testing.T, body any) *httptest.ResponseRecorder {
	t.Helper()
	b, _ := json.Marshal(body)
	req := httptest.NewRequest("POST", "/api/export", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handleExport(rec, req)
	return rec
}

const testCSV = "SKU,Location 1,Location 2,Location 3,Location 4,Location 5,Location 6\r\n70013,?,,6,,,"

func TestExportWritesIntoFolder(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "3apps", "Temp") // doesn't exist yet
	name := "12R LOCCLEAR - Eagle Import.csv"
	rec := postExport(t, exportRequest{Dir: dir, Name: name, CSV: testCSV})
	if rec.Code != 200 {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	got, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil || string(got) != testCSV {
		t.Fatalf("file = %q, %v", got, err)
	}
	var res map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if res["path"] != filepath.Join(dir, name) {
		t.Fatalf("path %v", res["path"])
	}
	if _, err := os.Stat(filepath.Join(dir, name+".tmp")); !os.IsNotExist(err) {
		t.Fatal("temp file left behind")
	}

	// Same name again: refused until the user says to replace it.
	newer := testCSV + "\r\n70018,?,,5,USTOR,,"
	rec = postExport(t, exportRequest{Dir: dir, Name: name, CSV: newer})
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), `"exists":true`) {
		t.Fatalf("conflict: %d %s", rec.Code, rec.Body)
	}
	if got, _ := os.ReadFile(filepath.Join(dir, name)); string(got) != testCSV {
		t.Fatal("file replaced without asking")
	}
	rec = postExport(t, exportRequest{Dir: dir, Name: name, CSV: newer, Overwrite: true})
	if rec.Code != 200 {
		t.Fatalf("overwrite: %d %s", rec.Code, rec.Body)
	}
	if got, _ := os.ReadFile(filepath.Join(dir, name)); string(got) != newer {
		t.Fatal("overwrite didn't replace the file")
	}
}

func TestExportDefaultsToEnvFolder(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("ACE_EXPORT_DIR", dir)
	rec := postExport(t, exportRequest{Name: "A.csv", CSV: testCSV})
	if rec.Code != 200 {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if _, err := os.Stat(filepath.Join(dir, "A.csv")); err != nil {
		t.Fatal(err)
	}
}

func TestExportRejectsBadRequests(t *testing.T) {
	dir := t.TempDir()
	bad := []exportRequest{
		{Dir: dir, Name: "../escape.csv", CSV: testCSV},
		{Dir: dir, Name: "sub/dir.csv", CSV: testCSV},
		{Dir: dir, Name: `sub\dir.csv`, CSV: testCSV},
		{Dir: dir, Name: "notes.txt", CSV: testCSV},
		{Dir: dir, Name: ".csv", CSV: testCSV},
		{Dir: dir, Name: "a..csv", CSV: testCSV},
		{Dir: "relative/folder", Name: "a.csv", CSV: testCSV},
		{Dir: dir, Name: "a.csv", CSV: "not an import"},
	}
	for _, r := range bad {
		if rec := postExport(t, r); rec.Code != http.StatusBadRequest {
			t.Errorf("%+v accepted: %d", r, rec.Code)
		}
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Fatalf("files written: %v", entries)
	}

	req := httptest.NewRequest("POST", "/api/export", strings.NewReader("name=a.csv"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	handleExport(rec, req)
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("form post accepted: %d", rec.Code)
	}
}

func TestDefaultExportDir(t *testing.T) {
	t.Setenv("ACE_EXPORT_DIR", "")
	if d := defaultExportDir(); d == "" || !filepath.IsAbs(d) && d != `C:\3apps\Temp` {
		t.Fatalf("default %q", d)
	}
}
