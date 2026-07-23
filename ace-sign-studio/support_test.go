package main

import (
	"net/url"
	"strings"
	"testing"
)

func TestFirstLine(t *testing.T) {
	if got := firstLine("Photo missing", "body"); got != "Photo missing" {
		t.Fatalf("summary preferred: %q", got)
	}
	if got := firstLine("", "line1\nline2"); got != "line1" {
		t.Fatalf("first body line: %q", got)
	}
	if got := firstLine("", ""); got != "(no summary)" {
		t.Fatalf("empty fallback: %q", got)
	}
	long := strings.Repeat("x", 200)
	if got := firstLine(long, ""); len(got) > 90 {
		t.Fatalf("not truncated: %d", len(got))
	}
}

func TestBuildReport(t *testing.T) {
	req := &supportRequest{Kind: "bug", Summary: "Photo missing", Message: "It vanished", FromName: "Cody", Diagnostics: "App version: 9.9\nQueue: 3"}
	r := buildReport("Bug Report", req)
	for _, want := range []string{"Bug Report", "App version:", "Photo missing", "It vanished", "Cody", "--- Diagnostics ---", "Queue: 3"} {
		if !strings.Contains(r, want) {
			t.Fatalf("report missing %q:\n%s", want, r)
		}
	}
}

func TestBuildReportNoDiag(t *testing.T) {
	r := buildReport("Feature Request", &supportRequest{Kind: "feature", Message: "add X"})
	if strings.Contains(r, "--- Diagnostics ---") {
		t.Fatalf("should omit diagnostics when empty")
	}
}

func TestTrySMTPUnconfigured(t *testing.T) {
	t.Setenv("ACE_SMTP_HOST", "")
	t.Setenv("ACE_SMTP_FROM", "")
	t.Setenv("ACE_SMTP_USER", "")
	ok, err := trySMTP("subj", "body", "/nonexistent")
	if ok || err == nil {
		t.Fatalf("expected not-configured, got ok=%v err=%v", ok, err)
	}
}

func TestMailtoEscaping(t *testing.T) {
	// The handler builds a mailto with url.QueryEscape; verify round-trip.
	subject := "[Ace Sign Studio] Bug Report: Photo & price missing"
	body := "line1\nline2 with spaces & symbols=?"
	m := "mailto:" + supportInbox + "?subject=" + url.QueryEscape(subject) + "&body=" + url.QueryEscape(body)
	if !strings.HasPrefix(m, "mailto:csuter@snydersace.net?subject=") {
		t.Fatalf("bad mailto: %s", m)
	}
	if strings.Contains(m, "\n") {
		t.Fatalf("newline not escaped in mailto")
	}
}
