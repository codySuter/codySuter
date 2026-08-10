// Ace Sign Studio — unified signage app for Snyder's Ace Hardware.
//
// Single standalone executable: embeds the entire web UI, serves it on
// 127.0.0.1, and opens it in an app-style browser window. Live pricing is
// fetched from acehardware.com (Mozu storefront API) with the store's
// purchase location, exactly like the legacy tools did.
package main

import (
	"embed"
	"encoding/base64"
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
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

//go:embed web
var webFS embed.FS

// appVersion is overridden at build time via -ldflags "-X main.appVersion=…".
var appVersion = "3.9.0"

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
	mux.Handle("/", staticCache(http.FileServer(http.FS(sub))))
	mux.HandleFunc("/api/health", handleHealth)
	mux.HandleFunc("/api/lookup", handleLookup)
	mux.HandleFunc("/api/img", handleImageProxy)
	mux.HandleFunc("/api/state", handleState)
	mux.HandleFunc("/api/sync/github", handleSyncGithub)
	mux.HandleFunc("/api/update/check", handleUpdateCheck)
	mux.HandleFunc("/api/update/apply", handleUpdateApply)
	mux.HandleFunc("/__ping", handlePing)

	cleanupOldUpdate() // remove a prior exe left by a self-update

	updated := os.Getenv("ACE_UPDATED") == "1"
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil && *port != 0 && updated {
		// Just relaunched by a self-update: wait for the outgoing instance to
		// release the port rather than focusing it. Its exit is bounded (the
		// browser teardown is capped at 3s), but give it a generous margin —
		// a premature give-up here is how an update ends with no app running.
		for i := 0; i < 100 && err != nil; i++ {
			time.Sleep(300 * time.Millisecond)
			ln, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
		}
	}
	if err != nil && *port != 0 {
		// Port taken — if it's another Ace Sign Studio, just focus it. Never
		// take this branch right after a self-update: the instance still on
		// the port is the dying one, and "focusing" it would leave the user
		// with no app once it exits. Fall through to a random port instead.
		if !updated && isRunningInstance(*port) {
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
	boundPortMu.Lock()
	boundPort = ln.Addr().(*net.TCPAddr).Port
	boundPortMu.Unlock()
	url := fmt.Sprintf("http://%s", ln.Addr().String())
	log.Printf("[pid %d] Ace Sign Studio %s serving at %s", os.Getpid(), appVersion, url)

	if !*noExit {
		go watchdog()
	}
	if !*noBrowser {
		go openAppWindow(url)
	}

	// touchHeartbeat sits inside the security wrappers so only requests that
	// pass the loopback/cross-site checks count as signs of life.
	srv := &http.Server{Handler: requireLoopbackHost(blockCrossSite(touchHeartbeat(mux)))}
	if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

// touchHeartbeat counts every request — not just /__ping — as proof the UI
// is alive, so a burst of real work (lookups, state saves, image fetches)
// keeps the watchdog satisfied even if ping timers are being throttled.
func touchHeartbeat(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		heartbeatMu.Lock()
		lastHeartbeat = time.Now()
		heartbeatMu.Unlock()
		next.ServeHTTP(w, r)
	})
}

// staticCache lets the browser reuse the bulky parts of the UI — fonts,
// vendor libraries, images, CSS and JS — across window opens, while
// index.html itself is never cached.
//
// Everything used to be no-store, which also disables Chrome's compiled-code
// cache, so ~590 KB of minified JS was re-parsed and the TTFs re-decoded on
// every launch. These assets are revalidated rather than given a freshness
// window: the ETag is scoped to appVersion, so a matching request costs one
// 304 over loopback and the browser reuses both the bytes and the compiled
// code, while a self-update invalidates every asset at once.
//
// Deliberately not max-age: a self-update finishes with location.reload(),
// and Chrome does not revalidate subresources on a normal reload. Any
// freshness window could therefore pair a newly updated backend with the
// previous build's cached JS.
func staticCache(next http.Handler) http.Handler {
	cacheable := func(p string) bool {
		for _, prefix := range []string{"/fonts/", "/vendor/", "/img/", "/css/", "/js/"} {
			if strings.HasPrefix(p, prefix) {
				return true
			}
		}
		return false
	}
	etag := `"v` + appVersion + `"`
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	host, _ := os.Hostname()
	writeJSON(w, map[string]any{"ok": true, "version": appVersion, "host": host, "builtinSync": embeddedSyncToken() != ""})
}

// embeddedSyncTokenB64 is injected at release-build time (base64 of the
// store's sync token, from the ACE_SYNC_TOKEN repo secret via build.sh).
// Base64 keeps the raw token string out of the public binary's strings
// and out of secret scanners that would auto-revoke it. This is
// deliberately NOT strong protection — anyone determined can decode it —
// an accepted trade-off (owner's call): the token can only read/write the
// sync repo's batch data, and rotating it is just updating the repo
// secret before the next release. Dev builds have no token; sync then
// needs one pasted in Settings.
var embeddedSyncTokenB64 = ""

func embeddedSyncToken() string {
	b, err := base64.StdEncoding.DecodeString(strings.TrimSpace(embeddedSyncTokenB64))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

// ---------------- multi-PC sync via a private GitHub repo ----------------
//
// The sync store is a single JSON file in a private repo the store owns
// (e.g. codysuter/ace-sign-sync). Each PC pastes a fine-grained token
// (Contents read/write on that one repo) into Settings; the frontend owns
// the merge logic and this endpoint just proxies the GitHub Contents API,
// keeping the token out of third-party requests made by the page.
//
// GitHub's sha-guarded PUT gives compare-and-swap: when two PCs write at
// once, the loser gets {conflict:true}, re-pulls, re-merges, and retries —
// no torn writes, unlike a plain shared file.
//
// The token stays in this PC's local state.json and is sent only to
// api.github.com; it is never part of the synced document itself.

var githubAPIBase = "https://api.github.com" // overridden in tests

const syncRepoFile = "acesignstudio-sync.json"

var syncHTTP = &http.Client{Timeout: 20 * time.Second}

type syncGithubReq struct {
	Op    string          `json:"op"` // "get" | "put"
	Repo  string          `json:"repo"`
	Token string          `json:"token"`
	Sha   string          `json:"sha,omitempty"`
	Doc   json.RawMessage `json:"doc,omitempty"`
	By    string          `json:"by,omitempty"` // computer name for the commit message
}

var syncRepoRe = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)

func handleSyncGithub(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
		http.Error(w, "Content-Type must be application/json", http.StatusUnsupportedMediaType)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 32<<20))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var req syncGithubReq
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	req.Repo = strings.TrimSpace(req.Repo)
	req.Token = strings.TrimSpace(req.Token)
	// The regex alone still matches "." and ".." segments, which GitHub's API
	// would path-normalize — letting a crafted request aim the embedded token
	// at other api.github.com paths. Real owners/repos are never dot-only.
	owner, repoName, _ := strings.Cut(req.Repo, "/")
	if !syncRepoRe.MatchString(req.Repo) ||
		owner == "." || owner == ".." || repoName == "." || repoName == ".." {
		writeJSON(w, map[string]any{"ok": false, "error": "sync repo must look like owner/repo (e.g. codysuter/ace-sign-sync)"})
		return
	}
	if req.Token == "" {
		req.Token = embeddedSyncToken() // release builds carry the store token
	}
	if req.Token == "" {
		writeJSON(w, map[string]any{"ok": false, "error": "this build has no built-in store token — paste one under Settings → Sync → advanced"})
		return
	}
	url := fmt.Sprintf("%s/repos/%s/contents/%s", githubAPIBase, req.Repo, syncRepoFile)

	ghDo := func(method string, payload any) (*http.Response, []byte, error) {
		var rd io.Reader
		if payload != nil {
			b, _ := json.Marshal(payload)
			rd = strings.NewReader(string(b))
		}
		greq, err := http.NewRequest(method, url, rd)
		if err != nil {
			return nil, nil, err
		}
		greq.Header.Set("Authorization", "Bearer "+req.Token)
		greq.Header.Set("Accept", "application/vnd.github+json")
		greq.Header.Set("X-GitHub-Api-Version", "2022-11-28")
		resp, err := syncHTTP.Do(greq)
		if err != nil {
			return nil, nil, err
		}
		defer resp.Body.Close()
		rb, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
		return resp, rb, err
	}

	authError := func(code int) string {
		switch code {
		case http.StatusUnauthorized:
			return "GitHub rejected the token — paste it again (it may have expired)"
		case http.StatusForbidden:
			return "the token doesn't have access — it needs Contents read & write on the sync repo"
		}
		return ""
	}

	switch req.Op {
	case "get":
		resp, rb, err := ghDo(http.MethodGet, nil)
		if err != nil {
			writeJSON(w, map[string]any{"ok": false, "error": "can't reach GitHub — check the internet connection"})
			return
		}
		if resp.StatusCode == http.StatusNotFound {
			// an unreachable repo and a missing file both 404 — check the repo
			// itself so a typo'd name doesn't silently "sync" into nothing
			if greq, err := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/repos/%s", githubAPIBase, req.Repo), nil); err == nil {
				greq.Header.Set("Authorization", "Bearer "+req.Token)
				greq.Header.Set("Accept", "application/vnd.github+json")
				if repoResp, err := syncHTTP.Do(greq); err == nil {
					_, _ = io.Copy(io.Discard, repoResp.Body)
					repoResp.Body.Close()
					if repoResp.StatusCode != http.StatusOK {
						writeJSON(w, map[string]any{"ok": false, "error": "GitHub can't find that repo with this token — check the owner/repo name and the token's repository access"})
						return
					}
				}
			}
			writeJSON(w, map[string]any{"ok": true, "missing": true})
			return
		}
		// the Contents API refuses files over 1MB with a "too_large" error —
		// distinct from an auth 403, and actionable (3.4+ keeps the doc small)
		if resp.StatusCode == http.StatusForbidden && strings.Contains(string(rb), "too_large") {
			writeJSON(w, map[string]any{"ok": false, "error": "the sync data has outgrown GitHub's file limit — update every computer to the latest version, which keeps it small"})
			return
		}
		if msg := authError(resp.StatusCode); msg != "" {
			writeJSON(w, map[string]any{"ok": false, "error": msg})
			return
		}
		if resp.StatusCode != http.StatusOK {
			writeJSON(w, map[string]any{"ok": false, "error": fmt.Sprintf("GitHub error (%d)", resp.StatusCode)})
			return
		}
		var got struct {
			Content string `json:"content"`
			Sha     string `json:"sha"`
		}
		if err := json.Unmarshal(rb, &got); err != nil {
			writeJSON(w, map[string]any{"ok": false, "error": "unexpected GitHub response"})
			return
		}
		raw, err := base64.StdEncoding.DecodeString(strings.Join(strings.Fields(got.Content), ""))
		if err != nil || !json.Valid(raw) {
			// unreadable sync file — treat as missing so the next write repairs it
			writeJSON(w, map[string]any{"ok": true, "missing": true, "sha": got.Sha})
			return
		}
		writeJSON(w, map[string]any{"ok": true, "sha": got.Sha, "doc": json.RawMessage(raw)})
	case "put":
		if !json.Valid(req.Doc) {
			http.Error(w, "invalid doc", http.StatusBadRequest)
			return
		}
		by := strings.TrimSpace(req.By)
		if by == "" {
			by, _ = os.Hostname()
		}
		payload := map[string]any{
			"message": "sync from " + by,
			"content": base64.StdEncoding.EncodeToString(req.Doc),
		}
		if req.Sha != "" {
			payload["sha"] = req.Sha
		}
		resp, rb, err := ghDo(http.MethodPut, payload)
		if err != nil {
			writeJSON(w, map[string]any{"ok": false, "error": "can't reach GitHub — check the internet connection"})
			return
		}
		switch {
		case resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated:
			var got struct {
				Content struct {
					Sha string `json:"sha"`
				} `json:"content"`
			}
			_ = json.Unmarshal(rb, &got)
			writeJSON(w, map[string]any{"ok": true, "sha": got.Content.Sha})
		case resp.StatusCode == http.StatusConflict || resp.StatusCode == http.StatusUnprocessableEntity:
			// sha raced another PC's write — the frontend re-pulls & re-merges
			writeJSON(w, map[string]any{"ok": true, "conflict": true})
		default:
			if msg := authError(resp.StatusCode); msg != "" {
				writeJSON(w, map[string]any{"ok": false, "error": msg})
				return
			}
			writeJSON(w, map[string]any{"ok": false, "error": fmt.Sprintf("GitHub error (%d)", resp.StatusCode)})
		}
	default:
		http.Error(w, "unknown op", http.StatusBadRequest)
	}
}

func handlePing(w http.ResponseWriter, _ *http.Request) {
	heartbeatMu.Lock()
	lastHeartbeat = time.Now()
	everPinged = true
	heartbeatMu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

// watchdog shuts the process down once the UI has been closed. The frontend
// pings every 20s (from a worker) and every other request also refreshes the
// heartbeat — but Chrome throttles timers in minimized/hidden windows to as
// little as one tick per minute, so the silence threshold must sit well
// above 60s or the app kills itself while its window is merely minimized
// (every button then fails with "Failed to fetch"). 90s of total silence
// after at least one ping means the window really is gone.
func watchdog() {
	for {
		time.Sleep(5 * time.Second)
		heartbeatMu.Lock()
		pinged, last := everPinged, lastHeartbeat
		heartbeatMu.Unlock()
		if pinged && time.Since(last) > 90*time.Second {
			log.Println("UI window closed — exiting")
			flushDiskCache()  // persist any lookups still pending a write
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
		// Serialized: concurrent saves (two windows on one server, or an
		// autosave overlapping a beacon flush) would otherwise interleave on
		// the shared tmp file and could rename a half-written state.json —
		// the file holding the entire queue and settings — into place.
		stateWriteMu.Lock()
		defer stateWriteMu.Unlock()
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
