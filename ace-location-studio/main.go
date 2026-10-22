// Ace Location Studio — Epicor Eagle location tools for Snyder's Ace
// Hardware. The first tool, Clear Locations, reads an Eagle location export
// (.xls), lets you type the location codes being cleared for a reset, and
// writes the Eagle import file (SKU + all 6 locations, cleared ones as "?")
// straight into C:\3apps\Temp.
//
// Single standalone executable, built the same way as Ace Change Studio: it
// embeds the entire web UI, serves it on 127.0.0.1, and opens it in an
// app-style browser window. Settings and the export log are saved to one
// state.json in the user's config folder, with daily backups beside it.
package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

//go:embed web
var webFS embed.FS

// appVersion is overridden at build time via -ldflags "-X main.appVersion=…".
var appVersion = "1.5.0"

const userAgent = "AceLocationStudio (+https://github.com/codysuter/codysuter)"

var (
	heartbeatMu   sync.Mutex
	lastHeartbeat time.Time
	everPinged    bool
)

// boundPort is the port the server actually bound (which differs from -port
// after a fallback to a random port). The self-update relaunch passes it to
// the child so the new instance comes back on the same origin the UI knows.
var (
	boundPortMu sync.Mutex
	boundPort   int
)

func currentBoundPort() int {
	boundPortMu.Lock()
	defer boundPortMu.Unlock()
	return boundPort
}

// stateWriteMu serializes writes of state.json (see handleState).
var stateWriteMu sync.Mutex

// Different from Ace Sign Studio's 8347 and Ace Change Studio's 8352 so the
// apps can run side by side.
const defaultPort = 8357

// keepBackups is how many daily state backups are kept.
const keepBackups = 30

func main() {
	port := flag.Int("port", defaultPort, "port to listen on (0 = auto)")
	noBrowser := flag.Bool("no-browser", false, "do not open a browser window")
	noExit := flag.Bool("no-exit", false, "keep running even when the window closes")
	flag.Parse()

	// Optional file logging (field debugging + test observability).
	if lp := os.Getenv("ACE_DEBUG_LOG"); lp != "" {
		if f, err := os.OpenFile(lp, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644); err == nil {
			log.SetOutput(f)
		}
	}
	log.Printf("[pid %d] starting v%s (updated=%q) args=%v", os.Getpid(), appVersion, os.Getenv("ACE_UPDATED"), os.Args[1:])

	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.Handle("/", staticCache(http.FileServer(http.FS(sub))))
	mux.HandleFunc("/api/health", handleHealth)
	mux.HandleFunc("/api/state", handleState)
	mux.HandleFunc("/api/parse", handleParse)
	mux.HandleFunc("/api/export", handleExport)
	mux.HandleFunc("/api/reveal", handleReveal)
	mux.HandleFunc("/api/watch", handleWatch)
	mux.HandleFunc("/api/watch/load", handleWatchLoad)
	mux.HandleFunc("/api/compass/app", handleCompassApp)
	mux.HandleFunc("/api/compass/launch", handleCompassLaunch)
	mux.HandleFunc("/api/compass/settings", handleCompassSettings)
	mux.HandleFunc("/api/compass/test", handleCompassTest)
	mux.HandleFunc("/api/compass/explore", handleCompassExplore)
	mux.HandleFunc("/api/update/check", handleUpdateCheck)
	mux.HandleFunc("/api/update/apply", handleUpdateApply)
	mux.HandleFunc("/__ping", handlePing)

	cleanupOldUpdate() // remove a prior exe left by a self-update

	updated := os.Getenv("ACE_UPDATED") == "1"
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil && *port != 0 && updated {
		// Just relaunched by a self-update: wait for the outgoing instance to
		// release the port rather than focusing it.
		for i := 0; i < 100 && err != nil; i++ {
			time.Sleep(300 * time.Millisecond)
			ln, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
		}
	}
	if err != nil && *port != 0 {
		// Port taken — if it's another Ace Location Studio, just focus it.
		// Never take this branch right after a self-update: the instance
		// still on the port is the dying one.
		if !updated && isRunningInstance(*port) {
			log.Printf("Ace Location Studio already running on port %d — opening it", *port)
			if !*noBrowser {
				openAppWindow(fmt.Sprintf("http://127.0.0.1:%d", *port))
				time.Sleep(1500 * time.Millisecond)
			}
			return
		}
		ln, err = net.Listen("tcp", "127.0.0.1:0")
	}
	if err != nil {
		log.Fatalf("listen: %v", err)
	}
	boundPortMu.Lock()
	boundPort = ln.Addr().(*net.TCPAddr).Port
	boundPortMu.Unlock()
	url := fmt.Sprintf("http://%s", ln.Addr().String())
	log.Printf("[pid %d] Ace Location Studio %s serving at %s", os.Getpid(), appVersion, url)
	// Tests read this line from stdout to find a -port=0 server.
	fmt.Printf("ACE_LOCATION_STUDIO_URL %s\n", url)

	if !*noExit {
		go watchdog()
	}
	if !*noBrowser {
		go openAppWindow(url)
	}

	srv := &http.Server{Handler: requireLoopbackHost(blockCrossSite(touchHeartbeat(mux)))}
	if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

// touchHeartbeat counts every request — not just /__ping — as proof the UI
// is alive.
func touchHeartbeat(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		heartbeatMu.Lock()
		lastHeartbeat = time.Now()
		heartbeatMu.Unlock()
		next.ServeHTTP(w, r)
	})
}

// staticCache lets the browser reuse fonts, images, CSS and JS across window
// opens while index.html itself is never cached. The ETag is scoped to
// appVersion, so a self-update invalidates every asset at once (and no
// max-age: a reload after an update must never pair new code with old).
func staticCache(next http.Handler) http.Handler {
	cacheable := func(p string) bool {
		for _, prefix := range []string{"/fonts/", "/img/", "/css/", "/js/", "/vendor/"} {
			if strings.HasPrefix(p, prefix) {
				return true
			}
		}
		return false
	}
	etag := `"v` + appVersion + `"`
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Module scripts (pdf.js) only run with a JavaScript type, and on
		// Windows the registry can map .js/.mjs to something else.
		if strings.HasSuffix(r.URL.Path, ".mjs") || strings.HasSuffix(r.URL.Path, ".js") {
			w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		}
		if !cacheable(r.URL.Path) {
			w.Header().Set("Cache-Control", "no-store")
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("ETag", etag)
		w.Header().Set("Cache-Control", "no-cache")
		for _, candidate := range strings.Split(r.Header.Get("If-None-Match"), ",") {
			if strings.TrimSpace(candidate) == etag {
				w.WriteHeader(http.StatusNotModified)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// blockCrossSite rejects browser requests initiated by another origin, so an
// outside web page can't drive the app (e.g. write files into the export
// folder).
func blockCrossSite(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Header.Get("Sec-Fetch-Site") {
		case "", "same-origin", "none":
			next.ServeHTTP(w, r)
		default:
			http.Error(w, "cross-site request blocked", http.StatusForbidden)
		}
	})
}

// requireLoopbackHost rejects requests whose Host header isn't loopback
// (DNS-rebinding protection).
func requireLoopbackHost(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		switch strings.ToLower(host) {
		case "127.0.0.1", "localhost", "::1", "[::1]":
			next.ServeHTTP(w, r)
		default:
			http.Error(w, "forbidden host", http.StatusForbidden)
		}
	})
}

func handleHealth(w http.ResponseWriter, _ *http.Request) {
	host, _ := os.Hostname()
	dir, _ := configDir()
	writeJSON(w, map[string]any{
		"ok": true, "version": appVersion, "host": host, "dataDir": dir,
		"defaultExportDir": defaultExportDir(), "defaultWatchDir": defaultWatchDir(), "defaultCompassExe": defaultCompassExe(), "os": runtime.GOOS,
	})
}

func handlePing(w http.ResponseWriter, _ *http.Request) {
	heartbeatMu.Lock()
	lastHeartbeat = time.Now()
	everPinged = true
	heartbeatMu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

// watchdog shuts the process down once the UI has been closed. The frontend
// pings every 20s from a worker; 90s of total silence after at least one
// ping means the window really is gone (Chrome throttles minimized windows
// to about one timer tick a minute, so the threshold sits well above 60s).
func watchdog() {
	for {
		time.Sleep(5 * time.Second)
		heartbeatMu.Lock()
		pinged, last := everPinged, lastHeartbeat
		heartbeatMu.Unlock()
		if pinged && time.Since(last) > 90*time.Second {
			log.Println("UI window closed — exiting")
			os.Exit(0)
		}
	}
}

// isRunningInstance reports whether an Ace Location Studio instance already
// answers on the given port.
func isRunningInstance(port int) bool {
	c := &http.Client{Timeout: 900 * time.Millisecond}
	resp, err := c.Get(fmt.Sprintf("http://127.0.0.1:%d/api/health", port))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	var v struct {
		OK bool `json:"ok"`
	}
	if json.NewDecoder(resp.Body).Decode(&v) != nil {
		return false
	}
	return v.OK
}

// openAppWindow opens the UI in a chromeless "app window" when Edge or Chrome
// is available (standard on Windows), falling back to the default browser.
func openAppWindow(url string) {
	time.Sleep(150 * time.Millisecond)
	switch runtime.GOOS {
	case "windows":
		for _, exe := range []string{"msedge.exe", "chrome.exe"} {
			if p := findWindowsBrowser(exe); p != "" {
				if exec.Command(p, "--app="+url, "--edge-kiosk-type=normal").Start() == nil {
					return
				}
			}
		}
		_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		_ = exec.Command("open", url).Start()
	default:
		_ = exec.Command("xdg-open", url).Start()
	}
}

func findWindowsBrowser(exe string) string {
	candidates := []string{
		filepath.Join(os.Getenv("ProgramFiles"), "Microsoft", "Edge", "Application", exe),
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft", "Edge", "Application", exe),
		filepath.Join(os.Getenv("ProgramFiles"), "Google", "Chrome", "Application", exe),
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Google", "Chrome", "Application", exe),
		filepath.Join(os.Getenv("LocalAppData"), "Google", "Chrome", "Application", exe),
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	if p, err := exec.LookPath(exe); err == nil {
		return p
	}
	return ""
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// writeJSONStatus is writeJSON with an explicit HTTP status.
func writeJSONStatus(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// requireJSON enforces a JSON body — blocks cross-site form posts.
func requireJSON(w http.ResponseWriter, r *http.Request) bool {
	if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
		http.Error(w, "Content-Type must be application/json", http.StatusUnsupportedMediaType)
		return false
	}
	return true
}

// handleState persists settings and the export log as one JSON document in
// the user's config directory.
func handleState(w http.ResponseWriter, r *http.Request) {
	path, err := statePath()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	switch r.Method {
	case http.MethodGet:
		data, err := os.ReadFile(path)
		if err != nil || !json.Valid(data) {
			writeJSON(w, map[string]any{})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(data)
	case http.MethodPost:
		if !requireJSON(w, r) {
			return
		}
		data, err := io.ReadAll(io.LimitReader(r.Body, 16<<20))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if !json.Valid(data) {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		stateWriteMu.Lock()
		defer stateWriteMu.Unlock()
		backupState(path, time.Now())
		if err := writeFileAtomic(path, data); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]any{"ok": true})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// writeFileSync writes and fsyncs, so a power cut can't commit a rename
// over the target while the new bytes are still unflushed.
func writeFileSync(path string, data []byte) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	if err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	return err
}

// writeFileAtomic writes beside the target and renames over it, so a reader
// (or Eagle's import) never sees a half-written file.
func writeFileAtomic(path string, data []byte) error {
	tmp := path + ".tmp"
	if err := writeFileSync(tmp, data); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

// backupState copies the current state.json to backups/state-YYYY-MM-DD.json
// the first time it is overwritten each day, and prunes to keepBackups
// files. Caller holds stateWriteMu.
func backupState(path string, now time.Time) {
	data, err := os.ReadFile(path)
	if err != nil || !json.Valid(data) {
		return // nothing (valid) to back up yet
	}
	dir := filepath.Join(filepath.Dir(path), "backups")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return
	}
	dest := filepath.Join(dir, "state-"+now.Format("2006-01-02")+".json")
	if _, err := os.Stat(dest); err == nil {
		return // today's backup already taken
	}
	if err := writeFileSync(dest, data); err != nil {
		log.Printf("backup failed: %v", err)
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), "state-") && strings.HasSuffix(e.Name(), ".json") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names) // ISO dates sort chronologically
	for len(names) > keepBackups {
		os.Remove(filepath.Join(dir, names[0]))
		names = names[1:]
	}
}

// configDir is where state.json and its backups live. ACE_CONFIG_DIR
// overrides the platform default (used by the tests for isolation).
func configDir() (string, error) {
	if v := os.Getenv("ACE_CONFIG_DIR"); v != "" {
		if err := os.MkdirAll(v, 0o755); err != nil {
			return "", err
		}
		return v, nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = os.TempDir()
	}
	appDir := filepath.Join(dir, "AceLocationStudio")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		return "", err
	}
	return appDir, nil
}

func statePath() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "state.json"), nil
}
