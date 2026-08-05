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
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// updateMu serializes the download-verify-swap sequence (and the launch-time
// cleanup of leftover update files). Without it, two concurrent applies stage
// into the same .new file and one can rename a half-written download into
// place after the other verified it.
var updateMu sync.Mutex

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

// updateURLAllowed reports whether an exe URL is one we are willing to
// download and then execute.
//
// The manifest names the binary to run, so without this the app would fetch
// and launch whatever it was pointed at. The SHA-256 is no defence: it lives
// in the same manifest, so anything able to rewrite the URL rewrites the hash
// with it — the checksum catches a corrupt download, not a substituted one.
//
// The rule is that the exe must sit in the same directory as the manifest
// that advertised it. In production that pins downloads to this repo's own
// release (a bare github.com host check would not: any GitHub user can host a
// release there). It also keeps the ACE_UPDATE_MANIFEST test seam working,
// since a mock serves both files from one place.
//
// Redirects are deliberately still followed: a GitHub release download
// redirects to whichever asset CDN hostname GitHub currently uses, and
// pinning that list would break updates the day they change it. Only GitHub
// can issue that redirect, because the URL it starts from is pinned here.
func updateURLAllowed(exeURL, manifestURL string) bool {
	eu, err := url.Parse(exeURL)
	if err != nil {
		return false
	}
	mu, err := url.Parse(manifestURL)
	if err != nil {
		return false
	}
	if eu.Scheme != mu.Scheme || !strings.EqualFold(eu.Host, mu.Host) {
		return false
	}
	if eu.Scheme != "https" && !isLoopbackHost(eu.Hostname()) {
		return false // plain HTTP only for a local test manifest
	}
	// path.Clean resolves any "…/../" that would otherwise escape the prefix.
	dir := path.Dir(path.Clean(mu.Path))
	if !strings.HasSuffix(dir, "/") {
		dir += "/"
	}
	return strings.HasPrefix(path.Clean(eu.Path), dir)
}

func isLoopbackHost(host string) bool {
	switch strings.ToLower(host) {
	case "127.0.0.1", "localhost", "::1":
		return true
	}
	return false
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
	newer := compareVersions(m.Version, appVersion) > 0
	// Don't advertise an update we would refuse to install (or send the user
	// to download by hand) — an unexpected URL means the manifest is not
	// describing our own release.
	if newer && m.URL != "" && !updateURLAllowed(m.URL, updateManifestURL()) {
		st.Error = "update manifest points somewhere unexpected — ignoring it"
		writeJSON(w, st)
		return
	}
	st.Available = newer && m.URL != ""
	writeJSON(w, st)
}

func handleUpdateApply(w http.ResponseWriter, _ *http.Request) {
	if !updateMu.TryLock() {
		writeJSON(w, map[string]any{"ok": false, "error": "an update is already in progress"})
		return
	}
	defer updateMu.Unlock()
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
	if err := applyUpdateTo(m, exe); err != nil {
		return err
	}
	pendingExe = exe
	return nil
}

// applyUpdateTo is applyUpdate against an explicit exe path, so the download,
// verification and swap can be tested without replacing the test binary.
func applyUpdateTo(m *updateManifest, exe string) error {
	if !updateURLAllowed(m.URL, updateManifestURL()) {
		return fmt.Errorf("update download URL is not from the expected release location")
	}
	if m.SHA256 == "" {
		// build.sh always stamps the checksum; a manifest without one is not
		// something we should execute.
		return fmt.Errorf("update manifest has no checksum — refusing to install")
	}
	newPath := exe + ".new"
	if err := downloadFile(m.URL, newPath); err != nil {
		return fmt.Errorf("download failed: %w", err)
	}
	sum, err := fileSHA256(newPath)
	if err != nil {
		os.Remove(newPath)
		return err
	}
	if !strings.EqualFold(sum, m.SHA256) {
		os.Remove(newPath)
		return fmt.Errorf("checksum mismatch — download may be corrupt")
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
		// instance to focus. The actually-bound port is passed explicitly:
		// if this instance fell back to a random port, replaying the
		// original flags would have the child waiting on a port that will
		// never free (flag parsing takes the last -port, so the append wins).
		args := os.Args[1:]
		if p := currentBoundPort(); p > 0 {
			args = append(append([]string{}, args...), fmt.Sprintf("-port=%d", p))
		}
		cmd := exec.Command(exe, args...)
		cmd.Dir = filepath.Dir(exe)
		cmd.Env = append(os.Environ(), "ACE_UPDATED=1")
		_ = cmd.Start()
	}
	flushDiskCache()
	// Shut the lookup browser down, but never let a wedged browser (or an
	// in-flight lookup holding browserMu for tens of seconds) delay the
	// exit: the relaunched instance is waiting for this process to release
	// the port, and gives up long before a slow teardown would finish.
	done := make(chan struct{})
	go func() { shutdownBrowser(); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
	}
	os.Exit(0)
}

// cleanupOldUpdate removes leftovers from a prior self-update: the renamed
// previous exe (.old) and any download orphaned by a crash mid-update (.new).
func cleanupOldUpdate() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	os.Remove(exe + ".new")
	// Retry briefly: the just-exited old process may still hold a lock. A
	// missing file is done, not a reason to keep retrying, and each attempt
	// holds updateMu so the loop can never delete the .old backup out from
	// under an in-progress swap (which would leave no exe if the second
	// rename then failed).
	go func() {
		for i := 0; i < 10; i++ {
			updateMu.Lock()
			err := os.Remove(exe + ".old")
			updateMu.Unlock()
			if err == nil || os.IsNotExist(err) {
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
	if err == nil {
		// The file is about to be renamed over the running exe; without a
		// sync, a power cut can commit the rename while the data blocks are
		// still unflushed, leaving a truncated binary as the app.
		err = f.Sync()
	}
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
