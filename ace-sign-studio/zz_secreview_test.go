package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Mirrors main()'s mux + middleware stack so routing precedence can be
// verified without starting the real server.
func reviewMux() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/", staticCache(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Handler", "static")
		w.WriteHeader(http.StatusOK)
	})))
	for _, p := range []string{"/api/health", "/api/lookup", "/api/img", "/api/state", "/api/update/check", "/api/update/apply", "/api/support", "/__ping"} {
		mux.HandleFunc(p, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Handler", "api")
			w.WriteHeader(http.StatusOK)
		})
	}
	return requireLoopbackHost(blockCrossSite(touchHeartbeat(mux)))
}

func TestReviewRoutingPrecedence(t *testing.T) {
	h := reviewMux()
	for _, p := range []string{"/api/img?u=x", "/api/lookup?q=1", "/api/state", "/api/health", "/__ping", "/api/support"} {
		req := httptest.NewRequest(http.MethodGet, p, nil)
		req.Host = "127.0.0.1:8347"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		t.Logf("%-22s code=%d handler=%q cache-control=%q etag=%q",
			p, rec.Code, rec.Header().Get("X-Handler"), rec.Header().Get("Cache-Control"), rec.Header().Get("ETag"))
	}
}

// Can a request carrying only If-None-Match get a 304 for an /api path?
func TestReviewApiNotCached(t *testing.T) {
	h := reviewMux()
	for _, p := range []string{"/api/img?u=x", "/api/state", "/js/app.js", "/index.html", "/", "/api/nonexistent"} {
		req := httptest.NewRequest(http.MethodGet, p, nil)
		req.Host = "127.0.0.1:8347"
		req.Header.Set("If-None-Match", `"v`+appVersion+`"`)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		t.Logf("INM %-22s code=%d handler=%q cc=%q", p, rec.Code, rec.Header().Get("X-Handler"), rec.Header().Get("Cache-Control"))
	}
}

// Does the /api/img allowlist survive an HTTP redirect off the allowed host?
func TestReviewImageRedirectFollow(t *testing.T) {
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("INTERNAL-SECRET-BODY"))
	}))
	defer internal.Close()

	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, internal.URL+"/secret", http.StatusFound)
	}))
	defer cdn.Close()

	old := baseSite
	baseSite = cdn.URL // makes cdn.URL an "allowed" host via the ACE_BASE_URL override branch
	defer func() { baseSite = old }()
	t.Setenv("ACE_CONFIG_DIR", t.TempDir())

	data, ctype, err := fetchImageCached(cdn.URL + "/photo.png")
	t.Logf("err=%v ctype=%q body=%q", err, ctype, strings.TrimSpace(string(data)))
	if err == nil && strings.Contains(string(data), "INTERNAL-SECRET-BODY") {
		t.Logf("REDIRECT FOLLOWED OFF ALLOWLISTED HOST -> content from %s returned", internal.URL)
	}
}

// storefrontFetchJS: confirm %q-escaped hostile input cannot break the JS
// string literal. We check the generated source for balanced quoting.
func TestReviewStorefrontFetchJSEscaping(t *testing.T) {
	hostile := []string{
		`"});alert(1);({"`,
		"a +alert(1)//",
		"a +alert(1)//",
		"a\nb",
		"a\\\"b",
		"`+alert(1)+`",
		"${alert(1)}",
		"</script>",
	}
	for _, h := range hostile {
		js := storefrontFetchJS(h, h)
		// count unescaped double quotes on the fetch line
		line := ""
		for _, l := range strings.Split(js, "\n") {
			if strings.Contains(l, "const r = await fetch") {
				line = l
			}
		}
		t.Logf("input=%q\n  line=%s", h, line)
		if strings.ContainsAny(js, "  ") {
			t.Errorf("raw U+2028/U+2029 survived into generated JS for %q", h)
		}
	}
}
