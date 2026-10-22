//go:build !windows

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

// fakeCompass writes a stand-in Conductor.exe: a shell script that runs
// until it's asked to close (SIGTERM), like Compass's window.
func fakeCompass(t *testing.T) string {
	t.Helper()
	exe := filepath.Join(t.TempDir(), "Conductor.exe")
	script := "#!/bin/sh\ntrap 'kill $! 2>/dev/null; exit 0' TERM\nsleep 300 &\nwait\n"
	if err := os.WriteFile(exe, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = appClose(exe) })
	return exe
}

func launch(t *testing.T, exe string, restart bool) (int, map[string]any) {
	t.Helper()
	b, _ := json.Marshal(map[string]any{"exe": exe, "restart": restart})
	req := httptest.NewRequest("POST", "/api/compass/launch", strings.NewReader(string(b)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handleCompassLaunch(rec, req)
	var m map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &m)
	return rec.Code, m
}

func waitRunning(t *testing.T, exe string, want bool) {
	t.Helper()
	for i := 0; i < 50; i++ {
		if got, _ := appRunning(exe); got == want {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("running never became %v", want)
}

func TestCompassLaunch(t *testing.T) {
	exe := fakeCompass(t)

	rec := httptest.NewRecorder()
	handleCompassApp(rec, httptest.NewRequest("GET", "/api/compass/app?exe="+exe, nil))
	if !strings.Contains(rec.Body.String(), `"found":true`) || !strings.Contains(rec.Body.String(), `"running":false`) {
		t.Fatalf("status before: %s", rec.Body)
	}

	if code, m := launch(t, exe, false); code != 200 || m["restarted"] != false {
		t.Fatalf("start: %d %v", code, m)
	}
	waitRunning(t, exe, true)
	pids1, _ := appPIDs(exe)

	// Already open: refused unless restart.
	if code, m := launch(t, exe, false); code != 409 || m["running"] != true {
		t.Fatalf("second start: %d %v", code, m)
	}

	// Restart: closes it politely and starts a new one.
	if code, m := launch(t, exe, true); code != 200 || m["restarted"] != true {
		t.Fatalf("restart: %d %v", code, m)
	}
	waitRunning(t, exe, true)
	pids2, _ := appPIDs(exe)
	if len(pids2) != 1 || len(pids1) != 1 || pids1[0] == pids2[0] {
		t.Fatalf("not a fresh Compass: %v → %v", pids1, pids2)
	}
}

func TestCompassLaunchStillOpen(t *testing.T) {
	// A Compass that won't close (it's asking about saving): say so, don't force it.
	exe := filepath.Join(t.TempDir(), "Conductor.exe")
	if err := os.WriteFile(exe, []byte("#!/bin/sh\ntrap '' TERM\nsleep 300 &\nwait\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if code, _ := launch(t, exe, false); code != 200 {
		t.Fatal("start")
	}
	t.Cleanup(func() {
		pids, _ := appPIDs(exe)
		for _, p := range pids {
			if pr, err := os.FindProcess(p); err == nil {
				_ = pr.Kill()
			}
		}
	})
	waitRunning(t, exe, true)
	old := compassCloseWait
	compassCloseWait = time.Second
	defer func() { compassCloseWait = old }()
	if code, m := launch(t, exe, true); code != 409 || !strings.Contains(m["error"].(string), "asking whether to save") {
		t.Fatalf("%d %v", code, m)
	}
	if still, _ := appRunning(exe); !still {
		t.Fatal("it was forced closed")
	}
}

func TestCompassLaunchOnlyCompass(t *testing.T) {
	dir := t.TempDir()
	other := filepath.Join(dir, "calc.exe")
	_ = os.WriteFile(other, []byte("#!/bin/sh\n"), 0o755)
	for _, exe := range []string{other, "Conductor.exe", filepath.Join(dir, "Conductor.exe"), ""} {
		if code, m := launch(t, exe, false); code != 400 {
			t.Errorf("%q: %d %v", exe, code, m)
		}
	}
	req := httptest.NewRequest("POST", "/api/compass/launch", strings.NewReader("exe=x"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	handleCompassLaunch(rec, req)
	if rec.Code != 415 {
		t.Errorf("form post: %d", rec.Code)
	}
	t.Setenv("ACE_COMPASS_EXE", "/x/Conductor.exe")
	if defaultCompassExe() != "/x/Conductor.exe" {
		t.Error("ACE_COMPASS_EXE ignored")
	}
}
