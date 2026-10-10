package main

// The Compass export folder. Compass can run a saved query on a schedule
// and save it as a file (every 30 minutes, say); the app watches that
// folder and loads the newest export by itself, so nobody has to export
// from Eagle by hand. Read-only: the app never writes, moves or deletes
// anything in this folder.

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// A file modified this recently may still be being written.
const watchSettle = 5 * time.Second

var watchExts = map[string]bool{".xlsx": true, ".xls": true, ".csv": true}

func defaultWatchDir() string {
	if v := os.Getenv("ACE_WATCH_DIR"); v != "" {
		return v
	}
	home, _ := os.UserHomeDir()
	if runtime.GOOS == "windows" {
		if p := os.Getenv("USERPROFILE"); p != "" {
			home = p
		}
	}
	return filepath.Join(home, "Cody's Apps", "Epicor Exports")
}

type watchFile struct {
	Name     string `json:"name"`
	Modified int64  `json:"modified"` // Unix milliseconds
	Size     int64  `json:"size"`
	Writing  bool   `json:"writing,omitempty"` // changed in the last few seconds
}

type watchStatus struct {
	Dir    string     `json:"dir"`
	Exists bool       `json:"exists"`
	File   *watchFile `json:"file"`  // the newest export, or null
	Count  int        `json:"count"` // exports in the folder
	Error  string     `json:"error,omitempty"`
}

func checkWatchDir(dir string) error {
	if dir == "" || strings.ContainsRune(dir, 0) || !filepath.IsAbs(dir) {
		return errors.New("the folder must be a full path, like C:\\Users\\you\\Exports")
	}
	return nil
}

// isExport says whether a file in the folder looks like an export: a
// spreadsheet or CSV, not Excel's "~$" lock file or a hidden file.
func isExport(name string) bool {
	if strings.HasPrefix(name, "~$") || strings.HasPrefix(name, ".") {
		return false
	}
	return watchExts[strings.ToLower(filepath.Ext(name))]
}

func newestExport(dir string) watchStatus {
	st := watchStatus{Dir: dir}
	if err := checkWatchDir(dir); err != nil {
		st.Error = err.Error()
		return st
	}
	entries, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return st
	}
	if err != nil {
		st.Error = err.Error()
		return st
	}
	st.Exists = true
	var best fs.FileInfo
	for _, e := range entries {
		if !e.Type().IsRegular() || !isExport(e.Name()) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		st.Count++
		if best == nil || info.ModTime().After(best.ModTime()) {
			best = info
		}
	}
	if best != nil {
		st.File = &watchFile{
			Name:     best.Name(),
			Modified: best.ModTime().UnixMilli(),
			Size:     best.Size(),
			Writing:  time.Since(best.ModTime()) < watchSettle,
		}
	}
	return st
}

// GET /api/watch?dir=… — the newest export in the folder.
func handleWatch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, newestExport(r.URL.Query().Get("dir")))
}

type watchLoaded struct {
	*EagleFile
	Modified int64 `json:"modified"`
}

// POST /api/watch/load {dir, name} — read and parse one export from the
// folder (the one /api/watch named).
func handleWatchLoad(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !requireJSON(w, r) {
		return
	}
	var req struct {
		Dir  string `json:"dir"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<14)).Decode(&req); err != nil {
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"error": "bad request"})
		return
	}
	if err := checkWatchDir(req.Dir); err != nil {
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	if req.Name == "" || filepath.Base(req.Name) != req.Name || strings.ContainsAny(req.Name, `/\:`) || !isExport(req.Name) {
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"error": "that isn't an export file name"})
		return
	}
	p := filepath.Join(req.Dir, req.Name)
	info, err := os.Stat(p)
	if err != nil || !info.Mode().IsRegular() {
		writeJSONStatus(w, http.StatusNotFound, map[string]any{"error": "the export isn't in the folder any more"})
		return
	}
	if info.Size() > maxUpload {
		writeJSONStatus(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "that file is too big to be a location export"})
		return
	}
	data, err := os.ReadFile(p)
	if err != nil {
		writeJSONStatus(w, http.StatusInternalServerError, map[string]any{"error": "couldn't read it: " + err.Error()})
		return
	}
	busy := func(err error) string {
		if time.Since(info.ModTime()) < 2*time.Minute {
			return "it's probably still being saved — the app tries again in a minute (" + err.Error() + ")"
		}
		return err.Error()
	}
	sheet, grid, err := readSheet(req.Name, data)
	if err != nil {
		writeJSONStatus(w, http.StatusUnprocessableEntity, map[string]any{"error": busy(err)})
		return
	}
	ef, err := parseEagle(req.Name, sheet, grid)
	if err != nil {
		writeJSONStatus(w, http.StatusUnprocessableEntity, map[string]any{"error": busy(err)})
		return
	}
	writeJSON(w, watchLoaded{EagleFile: ef, Modified: info.ModTime().UnixMilli()})
}
