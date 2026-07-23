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
