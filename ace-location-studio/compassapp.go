package main

// Starting the Compass desktop app. Compass can run its location export as
// it starts up, so "Get fresh data from Compass" starts it (after a polite
// close if it's already open — the same as clicking its X, so it can ask
// about unsaved work; never a forced kill), and the export folder watcher
// picks up the export that follows.
//
// Only a program named Conductor.exe (Compass) can be started, from the
// path set in Settings.

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const compassExeName = "Conductor.exe"

// How long a polite close may take (Compass may ask about saving first).
var compassCloseWait = 45 * time.Second

func defaultCompassExe() string {
	if v := os.Getenv("ACE_COMPASS_EXE"); v != "" {
		return v
	}
	return `C:\Program Files (x86)\Epicor\Analytics\Eagle\Conductor.exe`
}

func checkCompassExe(exe string) error {
	if exe == "" || strings.ContainsRune(exe, 0) || !filepath.IsAbs(exe) {
		return errors.New("the Compass program must be a full path, like " + defaultCompassExe())
	}
	if !strings.EqualFold(filepath.Base(exe), compassExeName) {
		return errors.New("only Compass (" + compassExeName + ") can be started from here")
	}
	info, err := os.Stat(exe)
	if err != nil || !info.Mode().IsRegular() {
		return errors.New("Compass isn't at " + exe + " — check the path in Settings")
	}
	return nil
}

// GET /api/compass/app?exe=… — is Compass there, and is it running?
func handleCompassApp(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	exe := r.URL.Query().Get("exe")
	st := map[string]any{"exe": exe, "found": false, "running": false}
	if err := checkCompassExe(exe); err != nil {
		st["error"] = err.Error()
		writeJSON(w, st)
		return
	}
	st["found"] = true
	running, err := appRunning(exe)
	st["running"] = running
	if err != nil {
		st["error"] = "couldn't tell whether Compass is running: " + err.Error()
	}
	writeJSON(w, st)
}

// POST /api/compass/launch {exe, restart} — start Compass. When it's
// already running: 409 unless restart, which closes it politely first.
func handleCompassLaunch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !requireJSON(w, r) {
		return
	}
	var req struct {
		Exe     string `json:"exe"`
		Restart bool   `json:"restart"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&req); err != nil {
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"error": "bad request"})
		return
	}
	if err := checkCompassExe(req.Exe); err != nil {
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	running, err := appRunning(req.Exe)
	if err != nil {
		writeJSONStatus(w, http.StatusInternalServerError, map[string]any{"error": "couldn't tell whether Compass is running: " + err.Error()})
		return
	}
	if running {
		if !req.Restart {
			writeJSONStatus(w, http.StatusConflict, map[string]any{"running": true, "error": "Compass is already open"})
			return
		}
		if err := appClose(req.Exe); err != nil {
			writeJSONStatus(w, http.StatusInternalServerError, map[string]any{"error": "couldn't ask Compass to close: " + err.Error()})
			return
		}
		deadline := time.Now().Add(compassCloseWait)
		for {
			time.Sleep(500 * time.Millisecond)
			if still, _ := appRunning(req.Exe); !still {
				break
			}
			if time.Now().After(deadline) || r.Context().Err() != nil {
				writeJSONStatus(w, http.StatusConflict, map[string]any{"running": true,
					"error": "Compass is still open — it may be asking whether to save something. Answer it or close Compass, then try again."})
				return
			}
		}
	}
	cmd := exec.Command(req.Exe)
	cmd.Dir = filepath.Dir(req.Exe)
	if err := cmd.Start(); err != nil {
		writeJSONStatus(w, http.StatusInternalServerError, map[string]any{"error": "couldn't start Compass: " + err.Error()})
		return
	}
	go func() { _ = cmd.Wait() }() // reap it whenever it exits; it outlives nothing of ours
	writeJSON(w, map[string]any{"ok": true, "restarted": running, "started": time.Now().UnixMilli(), "os": runtime.GOOS})
}
