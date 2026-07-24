package main

// Self-update.
//
// On launch the UI asks /api/update/check, which fetches a small version
// manifest published next to the exe on GitHub. If a newer build exists the UI
// shows an "Update & Restart" banner; clicking it calls /api/update/apply,
// which downloads the new exe, verifies its SHA-256, swaps it into place, and
// relaunches — the classic Windows "rename the running exe, drop the new one
// in, restart" dance (os.Rename works on a running exe on Windows).

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// updateManifestURL points at the manifest published beside the exe on the
// stable GitHub Release (CI uploads both on every green build — the exe is
// no longer committed to git). Overridable via ACE_UPDATE_MANIFEST for
// testing.
func updateManifestURL() string {
	if v := os.Getenv("ACE_UPDATE_MANIFEST"); v != "" {
		return v
	}
	return "https://github.com/codysuter/codysuter/releases/download/ace-sign-studio-windows/version.json"
}

type updateManifest struct {
	Version string `json:"version"`
	URL     string `json:"url"`
	SHA256  string `json:"sha256"`
	Notes   string `json:"notes"`
}

type updateStatus struct {
	Current   string `json:"current"`
	Latest    string `json:"latest"`
	Available bool   `json:"available"`
	Notes     string `json:"notes,omitempty"`
	Error     string `json:"error,omitempty"`
	CanApply  bool   `json:"canApply"`
}

func fetchManifest() (*updateManifest, error) {
	c := &http.Client{Timeout: 12 * time.Second}
	req, _ := http.NewRequest("GET", updateManifestURL(), nil)
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Cache-Control", "no-cache")
	resp, err := c.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("manifest HTTP %d", resp.StatusCode)
	}
	var m updateManifest
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&m); err != nil {
		return nil, err
	}
	if m.Version == "" {
		return nil, fmt.Errorf("manifest missing version")
	}
	return &m, nil
}

// compareVersions returns -1, 0, or 1 for a<b, a==b, a>b using dotted numeric
// components (extra trailing components count as greater).
func compareVersions(a, b string) int {
	pa := strings.Split(strings.TrimPrefix(strings.TrimSpace(a), "v"), ".")
	pb := strings.Split(strings.TrimPrefix(strings.TrimSpace(b), "v"), ".")
	n := len(pa)
	if len(pb) > n {
		n = len(pb)
	}
	for i := 0; i < n; i++ {
		var x, y int
		if i < len(pa) {
			x, _ = strconv.Atoi(numPrefix(pa[i]))
		}
		if i < len(pb) {
			y, _ = strconv.Atoi(numPrefix(pb[i]))
		}
		if x != y {
			if x < y {
				return -1
			}
			return 1
		}
	}
	return 0
}

func numPrefix(s string) string {
	i := 0
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	if i == 0 {
		return "0"
	}
	return s[:i]
}

func handleUpdateCheck(w http.ResponseWriter, _ *http.Request) {
	st := updateStatus{Current: appVersion, Latest: appVersion, CanApply: canSelfReplace()}
	m, err := fetchManifest()
	if err != nil {
		st.Error = err.Error()
		writeJSON(w, st)
		return
	}
	st.Latest = m.Version
	st.Notes = m.Notes
	st.Available = compareVersions(m.Version, appVersion) > 0 && m.URL != ""
	writeJSON(w, st)
}

func handleUpdateApply(w http.ResponseWriter, _ *http.Request) {
	m, err := fetchManifest()
	if err != nil {
		writeJSON(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	if compareVersions(m.Version, appVersion) <= 0 {
		writeJSON(w, map[string]any{"ok": false, "error": "already up to date"})
		return
	}
	if err := applyUpdate(m); err != nil {
		writeJSON(w, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, map[string]any{"ok": true, "version": m.Version})
	// Relaunch shortly so the HTTP response flushes first.
	go func() {
		time.Sleep(600 * time.Millisecond)
		relaunchAndExit()
	}()
}

func canSelfReplace() bool {
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	// Writable if we can open the containing directory for writing a temp file.
	dir := filepath.Dir(exe)
	tmp := filepath.Join(dir, ".ace-update-write-test")
	f, err := os.Create(tmp)
	if err != nil {
		return false
	}
	f.Close()
	os.Remove(tmp)
	return true
}

var pendingExe string // set by applyUpdate so relaunch starts the right binary

// applyUpdate downloads the new exe, verifies its checksum, and swaps it into
// place. The running exe is renamed aside (allowed on Windows) and cleaned up
// on the next launch.
func applyUpdate(m *updateManifest) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	newPath := exe + ".new"
	if err := downloadFile(m.URL, newPath); err != nil {
		return fmt.Errorf("download failed: %w", err)
	}
	if m.SHA256 != "" {
		sum, err := fileSHA256(newPath)
		if err != nil {
			os.Remove(newPath)
			return err
		}
		if !strings.EqualFold(sum, m.SHA256) {
			os.Remove(newPath)
			return fmt.Errorf("checksum mismatch — download may be corrupt")
		}
	}
	_ = os.Chmod(newPath, 0o755)

	oldPath := exe + ".old"
	_ = os.Remove(oldPath)
	if err := os.Rename(exe, oldPath); err != nil {
		os.Remove(newPath)
		return fmt.Errorf("could not move the running app aside: %w", err)
	}
	if err := os.Rename(newPath, exe); err != nil {
		// Roll back so the app still launches next time.
		_ = os.Rename(oldPath, exe)
		os.Remove(newPath)
		return fmt.Errorf("could not install the new app: %w", err)
	}
	pendingExe = exe
	return nil
}

func relaunchAndExit() {
	exe := pendingExe
	if exe == "" {
		exe, _ = os.Executable()
	}
	if exe != "" {
		// Relaunch with the same CLI args, and mark it so it waits for this
		// process to release the port instead of treating us as a running
		// instance to focus.
		cmd := exec.Command(exe, os.Args[1:]...)
		cmd.Dir = filepath.Dir(exe)
		cmd.Env = append(os.Environ(), "ACE_UPDATED=1")
		_ = cmd.Start()
	}
	flushDiskCache()
	shutdownBrowser()
	os.Exit(0)
}

// cleanupOldUpdate removes the previous exe left behind by a self-update.
func cleanupOldUpdate() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	// Retry briefly: the just-exited old process may still hold a lock.
	go func() {
		for i := 0; i < 10; i++ {
			if os.Remove(exe+".old") == nil {
				return
			}
			time.Sleep(500 * time.Millisecond)
		}
	}()
}

func downloadFile(url, dest string) error {
	c := &http.Client{Timeout: 5 * time.Minute}
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", userAgent)
	resp, err := c.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	_, err = io.Copy(f, resp.Body)
	closeErr := f.Close()
	if err != nil {
		os.Remove(dest)
		return err
	}
	return closeErr
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
