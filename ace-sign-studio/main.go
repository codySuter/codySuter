// Ace Sign Studio — unified signage app for Snyder's Ace Hardware.
//
// Single standalone executable: embeds the entire web UI, serves it on
// 127.0.0.1, and opens it in an app-style browser window. Live pricing is
// fetched from acehardware.com (Mozu storefront API) with the store's
// purchase location, exactly like the legacy tools did.
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
	"strings"
	"sync"
	"time"
)

//go:embed web
var webFS embed.FS

// appVersion is overridden at build time via -ldflags "-X main.appVersion=…".
var appVersion = "2.3.0"

var (
	heartbeatMu   sync.Mutex
	lastHeartbeat time.Time
	everPinged    bool
)

const defaultPort = 8347

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
	mux.Handle("/", noCache(http.FileServer(http.FS(sub))))
	mux.HandleFunc("/api/health", handleHealth)
	mux.HandleFunc("/api/lookup", handleLookup)
	mux.HandleFunc("/api/img", handleImageProxy)
	mux.HandleFunc("/api/state", handleState)
	mux.HandleFunc("/api/update/check", handleUpdateCheck)
	mux.HandleFunc("/api/update/apply", handleUpdateApply)
	mux.HandleFunc("/api/support", handleSupport)
	mux.HandleFunc("/__ping", handlePing)

	cleanupOldUpdate() // remove a prior exe left by a self-update

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil && *port != 0 && os.Getenv("ACE_UPDATED") == "1" {
		// Just relaunched by a self-update: wait for the outgoing instance to
		// release the port rather than focusing it.
		for i := 0; i < 20 && err != nil; i++ {
			time.Sleep(300 * time.Millisecond)
			ln, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
		}
	}
	if err != nil && *port != 0 {
		// Port taken — if it's another Ace Sign Studio, just focus it.
		if isRunningInstance(*port) {
			log.Printf("Ace Sign Studio already running on port %d — opening it", *port)
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
	url := fmt.Sprintf("http://%s", ln.Addr().String())
	log.Printf("[pid %d] Ace Sign Studio %s serving at %s", os.Getpid(), appVersion, url)

	if !*noExit {
		go watchdog()
	}
	if !*noBrowser {
		go openAppWindow(url)
	}

	srv := &http.Server{Handler: requireLoopbackHost(blockCrossSite(mux))}
	if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func noCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// blockCrossSite rejects browser requests initiated by another origin.
// The Host check below can't catch a cross-origin fetch/img aimed straight
// at http://127.0.0.1:8347 (the browser sends our own Host), but every
// current browser stamps such requests with Sec-Fetch-Site — anything not
// same-origin/none is an outside page poking the local API (e.g. blind
// SSRF via /api/lookup?q=<url>). Non-browser clients don't send the
// header and pass through.
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

// requireLoopbackHost rejects requests whose Host header isn't loopback.
// The server only listens on 127.0.0.1, but a malicious page could point a
// DNS name at 127.0.0.1 and ride the browser into the local API (DNS
// rebinding) — the Host check shuts that door.
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
	writeJSON(w, map[string]any{"ok": true, "version": appVersion})
}

func handlePing(w http.ResponseWriter, _ *http.Request) {
	heartbeatMu.Lock()
	lastHeartbeat = time.Now()
	everPinged = true
	heartbeatMu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

// watchdog shuts the process down once the UI has been closed: the frontend
// pings every 2s, so 25s of silence after at least one ping means the window
// (and any duplicated tabs) are gone.
func watchdog() {
	for {
		time.Sleep(5 * time.Second)
		heartbeatMu.Lock()
		pinged, last := everPinged, lastHeartbeat
		heartbeatMu.Unlock()
		if pinged && time.Since(last) > 25*time.Second {
			log.Println("UI window closed — exiting")
			shutdownBrowser() // close the headless lookup browser too
			os.Exit(0)
		}
	}
}

// isRunningInstance reports whether an Ace Sign Studio instance already
// answers on the given port.
func isRunningInstance(port int) bool {
	c := &http.Client{Timeout: 900 * time.Millisecond}
	resp, err := c.Get(fmt.Sprintf("http://127.0.0.1:%d/api/health", port))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	var v struct {
		OK      bool   `json:"ok"`
		Version string `json:"version"`
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

// handleImageProxy fetches a product image from acehardware.com (or its CDN)
// and serves it same-origin so the canvas/PDF pipeline can use it. Responses
// are cached on disk for the session.
func handleImageProxy(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(r.URL.Query().Get("u"))
	if raw == "" {
		http.Error(w, "missing u", http.StatusBadRequest)
		return
	}
	data, ctype, err := fetchImageCached(raw)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Cache-Control", "max-age=86400")
	_, _ = w.Write(data)
}

// handleState persists queue/settings/overrides as a JSON document in the
// user's config directory, so state survives restarts and port changes.
func handleState(w http.ResponseWriter, r *http.Request) {
	path, err := statePath()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	switch r.Method {
	case http.MethodGet:
		data, err := os.ReadFile(path)
		if err != nil {
			writeJSON(w, map[string]any{})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(data)
	case http.MethodPost:
		// JSON only — blocks cross-site form posts from overwriting the queue
		if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
			http.Error(w, "Content-Type must be application/json", http.StatusUnsupportedMediaType)
			return
		}
		data, err := io.ReadAll(io.LimitReader(r.Body, 32<<20))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if !json.Valid(data) {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		tmp := path + ".tmp"
		if err := os.WriteFile(tmp, data, 0o644); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if err := os.Rename(tmp, path); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]any{"ok": true})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// configDir is where state.json and the lookup cache live. ACE_CONFIG_DIR
// overrides the platform default (used by the e2e suite for isolation).
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
	appDir := filepath.Join(dir, "AceSignStudio")
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

func handleLookup(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	refresh := r.URL.Query().Get("refresh") == "1"
	store := strings.TrimSpace(r.URL.Query().Get("store"))
	if store == "" {
		store = defaultStoreCode
	}
	if q == "" {
		http.Error(w, "missing q", http.StatusBadRequest)
		return
	}
	res := lookupProduct(q, store, refresh)
	writeJSON(w, res)
}
