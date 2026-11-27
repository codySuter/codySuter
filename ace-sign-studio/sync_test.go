package main

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// mockGithub simulates the two Contents-API endpoints the sync proxy uses,
// including sha-guarded writes (compare-and-swap).
type mockGithub struct {
	content []byte
	sha     int // 0 = no file
	token   string
}

func (m *mockGithub) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+m.token {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch {
		case r.URL.Path == "/repos/store/sync":
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"name":"sync"}`))
		case r.URL.Path == "/repos/store/sync/contents/acesignstudio-sync.json" && r.Method == http.MethodGet:
			if m.sha == 0 {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{
				"content": base64.StdEncoding.EncodeToString(m.content),
				"sha":     shaStr(m.sha),
			})
		case r.URL.Path == "/repos/store/sync/contents/acesignstudio-sync.json" && r.Method == http.MethodPut:
			var body struct {
				Content string `json:"content"`
				Sha     string `json:"sha"`
			}
			json.NewDecoder(r.Body).Decode(&body)
			if (m.sha == 0) != (body.Sha == "") || (m.sha != 0 && body.Sha != shaStr(m.sha)) {
				w.WriteHeader(http.StatusConflict)
				w.Write([]byte(`{}`))
				return
			}
			m.content, _ = base64.StdEncoding.DecodeString(body.Content)
			m.sha++
			json.NewEncoder(w).Encode(map[string]any{"content": map[string]any{"sha": shaStr(m.sha)}})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})
}

func shaStr(n int) string { return "sha-" + strings.Repeat("a", n) }

func syncCall(t *testing.T, body string) map[string]any {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/api/sync/github", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handleSyncGithub(w, r)
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("non-JSON response (%d): %s", w.Code, w.Body.String())
	}
	return out
}

// withSyncServer points the proxy at a mock GitHub and bakes in `embedded`
// as the exe's token (the only token sync ever uses).
func withSyncServer(t *testing.T, gh *mockGithub, embedded string) {
	t.Helper()
	srv := httptest.NewServer(gh.handler())
	oldBase, oldTok, oldRepo := githubAPIBase, embeddedSyncTokenB64, syncRepo
	githubAPIBase, syncRepo = srv.URL, "store/sync"
	embeddedSyncTokenB64 = ""
	if embedded != "" {
		embeddedSyncTokenB64 = base64.StdEncoding.EncodeToString([]byte(embedded))
	}
	t.Cleanup(func() {
		srv.Close()
		githubAPIBase, embeddedSyncTokenB64, syncRepo = oldBase, oldTok, oldRepo
	})
}

func TestSyncGithubRoundtrip(t *testing.T) {
	gh := &mockGithub{token: "tok123"}
	withSyncServer(t, gh, "tok123")

	// no file yet → missing
	out := syncCall(t, `{"op":"get"}`)
	if out["missing"] != true {
		t.Fatalf("expected missing, got %v", out)
	}

	// first put (no sha), then get returns the doc + sha
	out = syncCall(t, `{"op":"put","doc":{"batches":{}},"by":"Front Desk"}`)
	if out["ok"] != true || out["conflict"] == true {
		t.Fatalf("create failed: %v", out)
	}
	out = syncCall(t, `{"op":"get"}`)
	if out["sha"] != shaStr(1) || out["doc"] == nil {
		t.Fatalf("get after put: %v", out)
	}

	// stale sha → conflict (compare-and-swap)
	out = syncCall(t, `{"op":"put","sha":"sha-stale","doc":{}}`)
	if out["conflict"] != true {
		t.Fatalf("expected conflict on stale sha, got %v", out)
	}
	// correct sha → accepted
	out = syncCall(t, `{"op":"put","sha":"`+shaStr(1)+`","doc":{"batches":{"a":1}}}`)
	if out["ok"] != true || out["conflict"] == true {
		t.Fatalf("guarded put failed: %v", out)
	}
}

// The built-in token is the only one: a token sent by the page (e.g. an
// old pasted one) must never be used, whether it would work or not.
func TestSyncGithubIgnoresPageToken(t *testing.T) {
	gh := &mockGithub{token: "tok123"}

	withSyncServer(t, gh, "tok123")
	out := syncCall(t, `{"op":"get","token":"stale-pasted"}`)
	if out["ok"] != true {
		t.Fatalf("a page-sent token must not override the built-in one: %v", out)
	}

	withSyncServer(t, gh, "expired-builtin")
	out = syncCall(t, `{"op":"get","token":"tok123"}`)
	if out["ok"] != false {
		t.Fatalf("a page-sent token must not be used even when it would work: %v", out)
	}
}

// No built-in token (a dev build) → a clear error, and GitHub is never called.
func TestSyncGithubNoBuiltinToken(t *testing.T) {
	called := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { called = true }))
	defer srv.Close()
	oldBase, oldTok := githubAPIBase, embeddedSyncTokenB64
	githubAPIBase, embeddedSyncTokenB64 = srv.URL, ""
	defer func() { githubAPIBase, embeddedSyncTokenB64 = oldBase, oldTok }()

	out := syncCall(t, `{"op":"get","token":"tok123"}`)
	if msg, _ := out["error"].(string); out["ok"] != false || !strings.Contains(msg, "no built-in sync connection") {
		t.Fatalf("expected no-built-in error, got %v", out)
	}
	if called {
		t.Fatal("GitHub was called without a built-in token")
	}
}

// An expired/revoked built-in token says so plainly — nothing to paste.
func TestSyncGithubExpiredBuiltinToken(t *testing.T) {
	withSyncServer(t, &mockGithub{token: "fresh-token"}, "expired-token")
	for _, op := range []string{
		`{"op":"get"}`,
		`{"op":"put","doc":{}}`,
	} {
		out := syncCall(t, op)
		msg, _ := out["error"].(string)
		if out["ok"] != false || !strings.Contains(msg, "built-in sync connection was rejected") || strings.Contains(msg, "paste") {
			t.Fatalf("expected built-in rejection error for %s, got %v", op, out)
		}
	}
}

func TestSyncGithubUnknownRepo(t *testing.T) {
	withSyncServer(t, &mockGithub{token: "tok123"}, "tok123")
	syncRepo = "store/other" // a repo the token can't see
	out := syncCall(t, `{"op":"get"}`)
	if out["ok"] != false || !strings.Contains(out["error"].(string), "can't find the store's sync repo") {
		t.Fatalf("expected repo-not-found error, got %v", out)
	}
}

// The repo is fixed in the code: a repo sent by the page (an old Settings
// value, or a crafted "../.." aiming the built-in token at other GitHub
// API paths) must be ignored, every request going to syncRepo's file.
func TestSyncGithubIgnoresPageRepo(t *testing.T) {
	var paths []string
	gh := &mockGithub{token: "tok123", content: []byte(`{}`), sha: 1}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		gh.handler().ServeHTTP(w, r)
	}))
	defer srv.Close()
	oldBase, oldTok, oldRepo := githubAPIBase, embeddedSyncTokenB64, syncRepo
	githubAPIBase, syncRepo = srv.URL, "store/sync"
	embeddedSyncTokenB64 = base64.StdEncoding.EncodeToString([]byte("tok123"))
	defer func() { githubAPIBase, embeddedSyncTokenB64, syncRepo = oldBase, oldTok, oldRepo }()

	for _, repo := range []string{"../..", "evil/repo", "x/.."} {
		paths = nil
		out := syncCall(t, `{"op":"get","repo":"`+repo+`"}`)
		if out["ok"] != true {
			t.Fatalf("repo %q: expected the fixed repo to answer, got %v", repo, out)
		}
		for _, p := range paths {
			if p != "/repos/store/sync/contents/acesignstudio-sync.json" {
				t.Fatalf("repo %q: request went to %q", repo, p)
			}
		}
	}
}
