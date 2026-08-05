package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"2.4.1", "2.4.1", 0},
		{"2.4.1", "2.4.0", 1},
		{"2.4.0", "2.4.1", -1},
		// The classic self-update bug: string comparison says "2.4.9" wins.
		{"2.4.10", "2.4.9", 1},
		{"2.10.0", "2.9.9", 1},
		{"3.0.0", "2.99.99", 1},
		// A "v" prefix and stray whitespace must not read as a new version.
		{"v2.4.1", "2.4.1", 0},
		{" 2.4.1 ", "2.4.1", 0},
		// Missing components count as zero, so 2.4 == 2.4.0 and 2.4.1 > 2.4.
		{"2.4", "2.4.0", 0},
		{"2.4.1", "2.4", 1},
		// Junk must not compare greater than a real version, or every launch
		// would offer a phantom update.
		{"", "2.4.1", -1},
		{"garbage", "2.4.1", -1},
	}
	for _, c := range cases {
		if got := compareVersions(c.a, c.b); got != c.want {
			t.Errorf("compareVersions(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestUpdateURLAllowed(t *testing.T) {
	const manifest = "https://github.com/codysuter/codysuter/releases/download/ace-sign-studio-windows/version.json"

	allowed := []string{
		"https://github.com/codysuter/codysuter/releases/download/ace-sign-studio-windows/AceSignStudio.exe",
		"https://GitHub.com/codysuter/codysuter/releases/download/ace-sign-studio-windows/AceSignStudio.exe",
	}
	for _, u := range allowed {
		if !updateURLAllowed(u, manifest) {
			t.Errorf("updateURLAllowed(%q) = false, want true", u)
		}
	}

	blocked := []string{
		// Another GitHub user's release: same host, so a host-only check
		// would wave this straight through.
		"https://github.com/attacker/evil/releases/download/x/AceSignStudio.exe",
		// A different repo belonging to the same owner.
		"https://github.com/codysuter/other/releases/download/x/AceSignStudio.exe",
		// A sibling release of this repo, but not the one advertised.
		"https://github.com/codysuter/codysuter/releases/download/other-tag/AceSignStudio.exe",
		// Off-host entirely.
		"https://evil.example.com/AceSignStudio.exe",
		"https://github.evil.example.com/codysuter/codysuter/releases/download/ace-sign-studio-windows/x.exe",
		// Downgraded scheme.
		"http://github.com/codysuter/codysuter/releases/download/ace-sign-studio-windows/AceSignStudio.exe",
		// Path traversal back out of the pinned directory.
		"https://github.com/codysuter/codysuter/releases/download/ace-sign-studio-windows/../../../attacker/evil/x.exe",
		// Not a URL at all.
		"",
		"::nonsense::",
	}
	for _, u := range blocked {
		if updateURLAllowed(u, manifest) {
			t.Errorf("updateURLAllowed(%q) = true, want false", u)
		}
	}
}

// The ACE_UPDATE_MANIFEST seam (used by tests and local builds) must keep
// working, including over plain HTTP to loopback.
func TestUpdateURLAllowedLocalManifest(t *testing.T) {
	const manifest = "http://127.0.0.1:8080/dist/version.json"
	if !updateURLAllowed("http://127.0.0.1:8080/dist/AceSignStudio.exe", manifest) {
		t.Error("a local test manifest should be able to advertise a sibling exe")
	}
	if updateURLAllowed("http://127.0.0.1:8080/elsewhere/AceSignStudio.exe", manifest) {
		t.Error("a local manifest must still pin to its own directory")
	}
	if updateURLAllowed("http://evil.example.com/AceSignStudio.exe", manifest) {
		t.Error("a local manifest must not authorise an off-host download")
	}
}

// updateServer serves a manifest plus the exe it points at, and reports how
// many times the exe was fetched.
type updateServer struct {
	*httptest.Server
	downloads int
}

func newUpdateServer(t *testing.T, version string, payload []byte, corruptSum bool) *updateServer {
	t.Helper()
	us := &updateServer{}
	mux := http.NewServeMux()
	us.Server = httptest.NewServer(mux)
	t.Cleanup(us.Close)

	sum := sha256.Sum256(payload)
	hexSum := hex.EncodeToString(sum[:])
	if corruptSum {
		hexSum = strings.Repeat("0", 64)
	}
	mux.HandleFunc("/dist/version.json", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(updateManifest{
			Version: version,
			URL:     us.URL + "/dist/AceSignStudio.exe",
			SHA256:  hexSum,
			Notes:   "test build",
		})
	})
	mux.HandleFunc("/dist/AceSignStudio.exe", func(w http.ResponseWriter, _ *http.Request) {
		us.downloads++
		_, _ = w.Write(payload)
	})
	t.Setenv("ACE_UPDATE_MANIFEST", us.URL+"/dist/version.json")
	return us
}

// fakeExe stands in for the running binary so applyUpdate can swap it.
func fakeExe(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, "AceSignStudio.exe")
	if err := os.WriteFile(p, []byte(content), 0o755); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestApplyUpdateSwapsExeAndKeepsOldAside(t *testing.T) {
	newBinary := []byte("NEW BINARY v2.5.0")
	srv := newUpdateServer(t, "2.5.0", newBinary, false)
	exe := fakeExe(t, "OLD BINARY")

	m, err := fetchManifest()
	if err != nil {
		t.Fatalf("fetchManifest: %v", err)
	}
	if err := applyUpdateTo(m, exe); err != nil {
		t.Fatalf("applyUpdateTo: %v", err)
	}

	got, err := os.ReadFile(exe)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(newBinary) {
		t.Errorf("exe content = %q, want the downloaded binary", got)
	}
	if old, err := os.ReadFile(exe + ".old"); err != nil || string(old) != "OLD BINARY" {
		t.Errorf("previous exe should be kept aside for cleanup, got %q err=%v", old, err)
	}
	if _, err := os.Stat(exe + ".new"); !os.IsNotExist(err) {
		t.Error("the .new staging file should be gone after a successful swap")
	}
	if srv.downloads != 1 {
		t.Errorf("downloads = %d, want 1", srv.downloads)
	}
}

// A corrupt or substituted download must never reach the exe path.
func TestApplyUpdateRejectsChecksumMismatch(t *testing.T) {
	newUpdateServer(t, "2.5.0", []byte("TAMPERED BINARY"), true)
	exe := fakeExe(t, "OLD BINARY")

	m, err := fetchManifest()
	if err != nil {
		t.Fatalf("fetchManifest: %v", err)
	}
	err = applyUpdateTo(m, exe)
	if err == nil {
		t.Fatal("expected a checksum error, got nil")
	}
	if !strings.Contains(err.Error(), "checksum") {
		t.Errorf("error = %v, want it to mention the checksum", err)
	}
	if got, _ := os.ReadFile(exe); string(got) != "OLD BINARY" {
		t.Errorf("exe was modified despite a bad checksum: %q", got)
	}
	if _, err := os.Stat(exe + ".new"); !os.IsNotExist(err) {
		t.Error("the rejected download should have been deleted")
	}
}

func TestApplyUpdateRejectsForeignDownloadURL(t *testing.T) {
	srv := newUpdateServer(t, "2.5.0", []byte("whatever"), false)
	exe := fakeExe(t, "OLD BINARY")

	// Manifest advertises an exe hosted somewhere other than beside itself.
	m, err := fetchManifest()
	if err != nil {
		t.Fatalf("fetchManifest: %v", err)
	}
	m.URL = "https://evil.example.com/AceSignStudio.exe"

	err = applyUpdateTo(m, exe)
	if err == nil {
		t.Fatal("expected a rejection, got nil")
	}
	if !strings.Contains(err.Error(), "expected release location") {
		t.Errorf("error = %v, want it to name the URL as the problem", err)
	}
	if got, _ := os.ReadFile(exe); string(got) != "OLD BINARY" {
		t.Errorf("exe was modified: %q", got)
	}
	if srv.downloads != 0 {
		t.Errorf("downloads = %d, want 0 — nothing should be fetched", srv.downloads)
	}
}

// handleUpdateCheck must not offer an update it would then refuse to install.
func TestUpdateCheckIgnoresManifestPointingElsewhere(t *testing.T) {
	us := &updateServer{}
	mux := http.NewServeMux()
	us.Server = httptest.NewServer(mux)
	defer us.Close()
	mux.HandleFunc("/dist/version.json", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(updateManifest{
			Version: "99.0.0",
			URL:     "https://evil.example.com/AceSignStudio.exe",
			SHA256:  strings.Repeat("a", 64),
		})
	})
	t.Setenv("ACE_UPDATE_MANIFEST", us.URL+"/dist/version.json")

	rec := httptest.NewRecorder()
	handleUpdateCheck(rec, httptest.NewRequest(http.MethodGet, "/api/update/check", nil))
	var st updateStatus
	if err := json.NewDecoder(rec.Body).Decode(&st); err != nil {
		t.Fatal(err)
	}
	if st.Available {
		t.Error("an update pointing off-release must not be advertised as available")
	}
	if st.Error == "" {
		t.Error("the reason should be reported so it is visible in Settings")
	}
}

func TestUpdateCheckReportsNoUpdateForSameVersion(t *testing.T) {
	newUpdateServer(t, appVersion, []byte("same"), false)
	rec := httptest.NewRecorder()
	handleUpdateCheck(rec, httptest.NewRequest(http.MethodGet, "/api/update/check", nil))
	var st updateStatus
	if err := json.NewDecoder(rec.Body).Decode(&st); err != nil {
		t.Fatal(err)
	}
	if st.Available {
		t.Errorf("same version reported as an available update (current=%s latest=%s)", st.Current, st.Latest)
	}
}

func TestFetchManifestRejectsMissingVersion(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, `{"url":"http://x/y.exe"}`)
	}))
	defer srv.Close()
	t.Setenv("ACE_UPDATE_MANIFEST", srv.URL)
	if _, err := fetchManifest(); err == nil {
		t.Error("a manifest without a version should be rejected")
	}
}

// A manifest that parses but carries no checksum must not install — the
// SHA-256 is the only integrity check on the binary we are about to run.
func TestApplyUpdateRejectsMissingChecksum(t *testing.T) {
	newUpdateServer(t, "2.5.0", []byte("NEW BINARY"), false)
	exe := fakeExe(t, "OLD BINARY")

	m, err := fetchManifest()
	if err != nil {
		t.Fatalf("fetchManifest: %v", err)
	}
	m.SHA256 = ""
	if err := applyUpdateTo(m, exe); err == nil {
		t.Fatal("expected an error for a manifest without a checksum")
	}
	if got, _ := os.ReadFile(exe); string(got) != "OLD BINARY" {
		t.Errorf("exe was modified despite the missing checksum: %q", got)
	}
}
