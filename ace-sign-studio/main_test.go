package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStateHandler(t *testing.T) {
	t.Setenv("ACE_CONFIG_DIR", t.TempDir())

	get := httptest.NewRequest(http.MethodGet, "/api/state", nil)
	rec := httptest.NewRecorder()
	handleState(rec, get)
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != "{}" {
		t.Errorf("empty GET = %d %q", rec.Code, rec.Body.String())
	}

	post := httptest.NewRequest(http.MethodPost, "/api/state", strings.NewReader(`{"queue":[]}`))
	post.Header.Set("Content-Type", "application/json; charset=utf-8")
	rec = httptest.NewRecorder()
	handleState(rec, post)
	if rec.Code != http.StatusOK {
		t.Fatalf("valid POST = %d %q", rec.Code, rec.Body.String())
	}
	p, _ := statePath()
	if data, err := os.ReadFile(p); err != nil || !strings.Contains(string(data), "queue") {
		t.Errorf("state.json not written: %v", err)
	}

	get = httptest.NewRequest(http.MethodGet, "/api/state", nil)
	rec = httptest.NewRecorder()
	handleState(rec, get)
	if !strings.Contains(rec.Body.String(), "queue") {
		t.Errorf("round trip failed: %q", rec.Body.String())
	}
}

func TestStateHandlerRejectsWrongContentType(t *testing.T) {
	t.Setenv("ACE_CONFIG_DIR", t.TempDir())
	post := httptest.NewRequest(http.MethodPost, "/api/state", strings.NewReader(`{"queue":[]}`))
	post.Header.Set("Content-Type", "text/plain")
	rec := httptest.NewRecorder()
	handleState(rec, post)
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Errorf("text/plain POST = %d, want 415", rec.Code)
	}
	if p, _ := statePath(); fileExists(p) {
		t.Error("state.json written despite rejected content type")
	}
}

func TestStateHandlerRejectsInvalidJSON(t *testing.T) {
	t.Setenv("ACE_CONFIG_DIR", t.TempDir())
	post := httptest.NewRequest(http.MethodPost, "/api/state", strings.NewReader(`{not json`))
	post.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handleState(rec, post)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("invalid JSON POST = %d, want 400", rec.Code)
	}
}

func TestRequireLoopbackHost(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	h := requireLoopbackHost(inner)

	allowed := []string{"127.0.0.1", "127.0.0.1:8347", "localhost", "localhost:9999", "[::1]:8347", "LOCALHOST:80"}
	for _, host := range allowed {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Host = host
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Errorf("host %q = %d, want pass-through", host, rec.Code)
		}
	}

	blocked := []string{"evil.example.com", "evil.example.com:8347", "192.168.1.20:8347", "acesignstudio.attacker.io"}
	for _, host := range blocked {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Host = host
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Errorf("host %q = %d, want 403", host, rec.Code)
		}
	}
}

func TestBlockCrossSite(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	h := blockCrossSite(inner)

	for _, sfs := range []string{"", "same-origin", "none"} {
		req := httptest.NewRequest(http.MethodGet, "/api/lookup?q=1", nil)
		if sfs != "" {
			req.Header.Set("Sec-Fetch-Site", sfs)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Errorf("Sec-Fetch-Site %q = %d, want pass-through", sfs, rec.Code)
		}
	}
	for _, sfs := range []string{"cross-site", "same-site"} {
		req := httptest.NewRequest(http.MethodGet, "/api/lookup?q=http://evil", nil)
		req.Header.Set("Sec-Fetch-Site", sfs)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Errorf("Sec-Fetch-Site %q = %d, want 403", sfs, rec.Code)
		}
	}
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func TestStatePathUsesConfigDir(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("ACE_CONFIG_DIR", dir)
	p, err := statePath()
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(p) != dir {
		t.Errorf("statePath dir = %q, want %q", filepath.Dir(p), dir)
	}
}

// Static assets (fonts, vendor JS, images, CSS, JS) may be cached across
// window opens; index.html and the API never may. Blanket no-store also
// defeated Chrome's compiled-code cache, so every launch re-parsed the
// vendor bundles and re-decoded the TTFs.
func TestStaticCachePolicy(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	h := staticCache(inner)

	for _, p := range []string{"/fonts/Roboto-Bold.ttf", "/vendor/jspdf.umd.min.js", "/img/ace_logo_transparent.png", "/css/app.css", "/js/app.js"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if cc := rec.Header().Get("Cache-Control"); cc == "no-store" || cc == "" {
			t.Errorf("%s Cache-Control = %q, want a cacheable policy", p, cc)
		}
		if rec.Header().Get("ETag") == "" {
			t.Errorf("%s has no ETag to revalidate against", p)
		}
	}

	for _, p := range []string{"/", "/index.html"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if rec.Header().Get("Cache-Control") != "no-store" {
			t.Errorf("%s Cache-Control = %q, want no-store", p, rec.Header().Get("Cache-Control"))
		}
	}
}

// A matching ETag short-circuits to 304 so a reload re-uses the decoded
// asset instead of re-fetching ~2 MB of fonts and vendor code.
func TestStaticCacheRevalidates(t *testing.T) {
	served := 0
	h := staticCache(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		served++
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/fonts/Roboto-Bold.ttf", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	etag := rec.Header().Get("ETag")

	req2 := httptest.NewRequest(http.MethodGet, "/fonts/Roboto-Bold.ttf", nil)
	req2.Header.Set("If-None-Match", etag)
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusNotModified {
		t.Errorf("revalidation = %d, want 304", rec2.Code)
	}
	if served != 1 {
		t.Errorf("handler ran %d times, want 1 (second was a 304)", served)
	}

	// A new app version must invalidate everything at once.
	req3 := httptest.NewRequest(http.MethodGet, "/fonts/Roboto-Bold.ttf", nil)
	req3.Header.Set("If-None-Match", `"v0.0.0-old"`)
	rec3 := httptest.NewRecorder()
	h.ServeHTTP(rec3, req3)
	if rec3.Code != http.StatusOK {
		t.Errorf("stale ETag = %d, want a fresh 200", rec3.Code)
	}
}
