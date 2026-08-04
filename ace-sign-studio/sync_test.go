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

func TestSyncGithubRoundtrip(t *testing.T) {
	gh := &mockGithub{token: "tok123"}
	srv := httptest.NewServer(gh.handler())
	defer srv.Close()
	old := githubAPIBase
	githubAPIBase = srv.URL
	defer func() { githubAPIBase = old }()

	// no file yet → missing
	out := syncCall(t, `{"op":"get","repo":"store/sync","token":"tok123"}`)
	if out["missing"] != true {
		t.Fatalf("expected missing, got %v", out)
	}

	// first put (no sha), then get returns the doc + sha
	out = syncCall(t, `{"op":"put","repo":"store/sync","token":"tok123","doc":{"batches":{}},"by":"Front Desk"}`)
	if out["ok"] != true || out["conflict"] == true {
		t.Fatalf("create failed: %v", out)
	}
	out = syncCall(t, `{"op":"get","repo":"store/sync","token":"tok123"}`)
	if out["sha"] != shaStr(1) || out["doc"] == nil {
		t.Fatalf("get after put: %v", out)
	}

	// stale sha → conflict (compare-and-swap)
	out = syncCall(t, `{"op":"put","repo":"store/sync","token":"tok123","sha":"sha-stale","doc":{}}`)
	if out["conflict"] != true {
		t.Fatalf("expected conflict on stale sha, got %v", out)
	}
	// correct sha → accepted
	out = syncCall(t, `{"op":"put","repo":"store/sync","token":"tok123","sha":"`+shaStr(1)+`","doc":{"batches":{"a":1}}}`)
	if out["ok"] != true || out["conflict"] == true {
		t.Fatalf("guarded put failed: %v", out)
	}
}

func TestSyncGithubErrors(t *testing.T) {
	gh := &mockGithub{token: "tok123"}
	srv := httptest.NewServer(gh.handler())
	defer srv.Close()
	old := githubAPIBase
	githubAPIBase = srv.URL
	defer func() { githubAPIBase = old }()

	// bad repo shape / missing token → friendly errors, no GitHub call
	if out := syncCall(t, `{"op":"get","repo":"not a repo","token":"x"}`); out["ok"] != false {
		t.Fatalf("bad repo accepted: %v", out)
	}
	if out := syncCall(t, `{"op":"get","repo":"store/sync","token":""}`); out["ok"] != false {
		t.Fatalf("empty token accepted: %v", out)
	}
	// wrong token → auth error surfaced
	out := syncCall(t, `{"op":"get","repo":"store/sync","token":"wrong"}`)
	if out["ok"] != false || !strings.Contains(out["error"].(string), "token") {
		t.Fatalf("expected token error, got %v", out)
	}
	// unknown repo with valid token → named-repo error, not silent missing
	out = syncCall(t, `{"op":"get","repo":"store/other","token":"tok123"}`)
	if out["ok"] != false || !strings.Contains(out["error"].(string), "find that repo") {
		t.Fatalf("expected repo-not-found error, got %v", out)
	}
}
