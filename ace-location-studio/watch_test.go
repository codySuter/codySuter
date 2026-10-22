package main

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestParseCompassExport(t *testing.T) {
	data, err := os.ReadFile("testdata/compass-export.xlsx")
	if err != nil {
		t.Fatal(err)
	}
	sheet, grid, err := readSheet("compass-export.xlsx", data)
	if err != nil {
		t.Fatal(err)
	}
	ef, err := parseEagle("compass-export.xlsx", sheet, grid)
	if err != nil {
		t.Fatal(err)
	}
	if ef.Layout != "compass" || len(ef.Rows) != 9 {
		t.Fatalf("layout %q, %d rows", ef.Layout, len(ef.Rows))
	}
	r := ef.Rows[1]
	if r.SKU != "70018" || r.Desc != "ACE SHOVEL RND PT" || r.Locs != [6]string{"12R02", "", "5", "USTOR", "", ""} {
		t.Fatalf("row %+v", r)
	}
	// The same columns as Eagle's export, so clearing works the same.
	want := []string{"Item Number", "Item Description", "Location", "Location 2", "Location 3", "Location 4", "Location 5", "Location 6"}
	if strings.Join(ef.Columns, "|") != strings.Join(want, "|") {
		t.Fatalf("columns %q", ef.Columns)
	}
}

func touch(t *testing.T, p string, data []byte, mod time.Time) {
	t.Helper()
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(p, mod, mod); err != nil {
		t.Fatal(err)
	}
}

func TestNewestExport(t *testing.T) {
	dir := t.TempDir()
	if st := newestExport(filepath.Join(dir, "missing")); st.Exists || st.File != nil || st.Error != "" {
		t.Fatalf("missing folder: %+v", st)
	}
	if st := newestExport("relative\\path"); st.Error == "" {
		t.Fatal("relative path accepted")
	}
	if st := newestExport(dir); !st.Exists || st.File != nil || st.Count != 0 {
		t.Fatalf("empty folder: %+v", st)
	}
	now := time.Now()
	sample, _ := os.ReadFile("testdata/compass-export.xlsx")
	touch(t, filepath.Join(dir, "older.xlsx"), sample, now.Add(-2*time.Hour))
	touch(t, filepath.Join(dir, "ALS Locations.xlsx"), sample, now.Add(-10*time.Minute))
	touch(t, filepath.Join(dir, "~$ALS Locations.xlsx"), []byte("lock"), now) // Excel's lock file
	touch(t, filepath.Join(dir, "notes.txt"), []byte("x"), now)
	if err := os.Mkdir(filepath.Join(dir, "sub.csv"), 0o755); err != nil {
		t.Fatal(err)
	}
	st := newestExport(dir)
	if st.File == nil || st.File.Name != "ALS Locations.xlsx" || st.Count != 2 || st.File.Writing {
		t.Fatalf("%+v %+v", st, st.File)
	}
	// One being written right now is newest but flagged.
	touch(t, filepath.Join(dir, "fresh.csv"), []byte("Item Number,Location\n"), now)
	if st := newestExport(dir); st.File.Name != "fresh.csv" || !st.File.Writing {
		t.Fatalf("%+v", st.File)
	}
}

func watchLoad(t *testing.T, body string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	req := httptest.NewRequest("POST", "/api/watch/load", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handleWatchLoad(rec, req)
	var m map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &m)
	return rec, m
}

func TestWatchLoad(t *testing.T) {
	dir := t.TempDir()
	sample, _ := os.ReadFile("testdata/compass-export.xlsx")
	mod := time.Now().Add(-5 * time.Minute).Truncate(time.Second)
	touch(t, filepath.Join(dir, "ALS Locations.xlsx"), sample, mod)
	js := func(d, n string) string {
		b, _ := json.Marshal(map[string]string{"dir": d, "name": n})
		return string(b)
	}

	rec, m := watchLoad(t, js(dir, "ALS Locations.xlsx"))
	if rec.Code != 200 || m["layout"] != "compass" || len(m["rows"].([]any)) != 9 || int64(m["modified"].(float64)) != mod.UnixMilli() {
		t.Fatalf("%d %v", rec.Code, rec.Body.String()[:200])
	}

	// Only a plain file name of an export in that folder.
	secret := filepath.Join(t.TempDir(), "secret.csv")
	touch(t, secret, []byte("SKU,Location 1\n"), mod)
	for _, bad := range []string{js(dir, "../secret.csv"), js(dir, secret), js(dir, "notes.txt"), js(dir, "~$x.xlsx"), js("relative", "a.csv"), js(dir, "")} {
		if rec, _ := watchLoad(t, bad); rec.Code != 400 {
			t.Errorf("%s: %d", bad, rec.Code)
		}
	}
	if rec, _ := watchLoad(t, js(dir, "gone.xlsx")); rec.Code != 404 {
		t.Errorf("missing file: %d", rec.Code)
	}

	// A half-written export says so instead of a confusing parse error.
	touch(t, filepath.Join(dir, "half.xlsx"), sample[:len(sample)/2], time.Now())
	if rec, m := watchLoad(t, js(dir, "half.xlsx")); rec.Code != 422 || !strings.Contains(m["error"].(string), "still being saved") {
		t.Errorf("half-written: %d %v", rec.Code, m)
	}

	// Form posts are refused like every other write-ish endpoint.
	req := httptest.NewRequest("POST", "/api/watch/load", strings.NewReader("dir=x"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec = httptest.NewRecorder()
	handleWatchLoad(rec, req)
	if rec.Code != 415 {
		t.Errorf("form post: %d", rec.Code)
	}
}

func TestWatchStatusEndpoint(t *testing.T) {
	dir := t.TempDir()
	rec := httptest.NewRecorder()
	handleWatch(rec, httptest.NewRequest("GET", "/api/watch?dir="+strings.ReplaceAll(dir, " ", "%20"), nil))
	var st watchStatus
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil || !st.Exists || st.File != nil {
		t.Fatalf("%s %v", rec.Body, err)
	}
	t.Setenv("ACE_WATCH_DIR", dir)
	if defaultWatchDir() != dir {
		t.Fatal("ACE_WATCH_DIR ignored")
	}
}
