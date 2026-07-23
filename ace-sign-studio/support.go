package main

// Support tickets: bug reports and feature requests from inside the app.
//
// A standalone exe has no mail credentials to safely embed, so delivery is
// layered: the full report is always written to a file on disk (so nothing
// is lost), then — if SMTP is configured via env vars — emailed with the
// diagnostics attached; otherwise the handler returns a prefilled mailto:
// link the UI opens in the user's mail client (Outlook, etc.), addressed to
// the support inbox with the report in the body.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/smtp"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const supportInbox = "csuter@snydersace.net"

type supportRequest struct {
	Kind        string `json:"kind"`    // "bug" | "feature"
	Summary     string `json:"summary"` // short title
	Message     string `json:"message"` // body
	FromName    string `json:"fromName,omitempty"`
	Diagnostics string `json:"diagnostics,omitempty"` // client-gathered block
	When        string `json:"when,omitempty"`        // client timestamp (display only)
}

func handleSupport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 8<<20))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var req supportRequest
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	req.Kind = strings.ToLower(strings.TrimSpace(req.Kind))
	if req.Kind != "feature" {
		req.Kind = "bug"
	}
	if strings.TrimSpace(req.Message) == "" && strings.TrimSpace(req.Summary) == "" {
		http.Error(w, "empty report", http.StatusBadRequest)
		return
	}

	kindLabel := "Bug Report"
	if req.Kind == "feature" {
		kindLabel = "Feature Request"
	}
	subject := fmt.Sprintf("[Ace Sign Studio] %s: %s", kindLabel, firstLine(req.Summary, req.Message))
	report := buildReport(kindLabel, &req)

	// Always persist the full report so it's never lost.
	savedPath, saveErr := saveSupportReport(req.Kind, report)

	// Try SMTP if fully configured; otherwise hand back a mailto: link.
	sent, sendErr := trySMTP(subject, report, savedPath)

	resp := map[string]any{
		"ok":        true,
		"emailed":   sent,
		"savedPath": savedPath,
		"inbox":     supportInbox,
	}
	if saveErr != nil {
		resp["saveError"] = saveErr.Error()
	}
	if !sent {
		// mailto body is length-limited by the OS; keep it to the essentials
		// and point at the saved file for the full diagnostics.
		mailBody := report
		if len(mailBody) > 1600 {
			mailBody = report[:1600] + "\n\n[...truncated — full report saved on this PC at:\n" + savedPath + "\nplease attach it to this email...]"
		}
		resp["mailto"] = fmt.Sprintf("mailto:%s?subject=%s&body=%s",
			supportInbox, url.QueryEscape(subject), url.QueryEscape(mailBody))
		if sendErr != nil {
			resp["sendNote"] = sendErr.Error()
		}
	}
	writeJSON(w, resp)
}

func firstLine(summary, msg string) string {
	s := strings.TrimSpace(summary)
	if s == "" {
		s = strings.TrimSpace(msg)
	}
	if i := strings.IndexAny(s, "\r\n"); i >= 0 {
		s = s[:i]
	}
	if len(s) > 80 {
		s = s[:80] + "…"
	}
	if s == "" {
		s = "(no summary)"
	}
	return s
}

func buildReport(kindLabel string, req *supportRequest) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Ace Sign Studio — %s\n", kindLabel)
	fmt.Fprintf(&b, "App version: %s\n", appVersion)
	if req.When != "" {
		fmt.Fprintf(&b, "Reported: %s\n", req.When)
	}
	if strings.TrimSpace(req.FromName) != "" {
		fmt.Fprintf(&b, "From: %s\n", strings.TrimSpace(req.FromName))
	}
	if strings.TrimSpace(req.Summary) != "" {
		fmt.Fprintf(&b, "Summary: %s\n", strings.TrimSpace(req.Summary))
	}
	b.WriteString("\n--- Description ---\n")
	b.WriteString(strings.TrimSpace(req.Message))
	b.WriteString("\n")
	if strings.TrimSpace(req.Diagnostics) != "" {
		b.WriteString("\n--- Diagnostics ---\n")
		b.WriteString(strings.TrimSpace(req.Diagnostics))
		b.WriteString("\n")
	}
	return b.String()
}

func saveSupportReport(kind, report string) (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = os.TempDir()
	}
	appDir := filepath.Join(dir, "AceSignStudio", "support")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		return "", err
	}
	name := fmt.Sprintf("%s-%s.txt", kind, time.Now().Format("2006-01-02-150405"))
	path := filepath.Join(appDir, name)
	if err := os.WriteFile(path, []byte(report), 0o644); err != nil {
		return "", err
	}
	return path, nil
}

// trySMTP sends the report (with a .txt attachment) when SMTP env vars are
// present. Returns (false, reason) when SMTP isn't configured or fails, so
// the caller can fall back to a mailto: link.
func trySMTP(subject, report, attachPath string) (bool, error) {
	host := os.Getenv("ACE_SMTP_HOST")
	user := os.Getenv("ACE_SMTP_USER")
	pass := os.Getenv("ACE_SMTP_PASS")
	from := os.Getenv("ACE_SMTP_FROM")
	if from == "" {
		from = user
	}
	port := os.Getenv("ACE_SMTP_PORT")
	if port == "" {
		port = "587"
	}
	if host == "" || from == "" {
		return false, fmt.Errorf("SMTP not configured")
	}

	var msg bytes.Buffer
	boundary := "aceSupport" + time.Now().Format("150405")
	fmt.Fprintf(&msg, "From: %s\r\n", from)
	fmt.Fprintf(&msg, "To: %s\r\n", supportInbox)
	fmt.Fprintf(&msg, "Subject: %s\r\n", subject)
	msg.WriteString("MIME-Version: 1.0\r\n")
	fmt.Fprintf(&msg, "Content-Type: multipart/mixed; boundary=%s\r\n\r\n", boundary)

	mw := multipart.NewWriter(&msg)
	_ = mw.SetBoundary(boundary)
	// body part
	tp := textproto.MIMEHeader{}
	tp.Set("Content-Type", "text/plain; charset=utf-8")
	part, _ := mw.CreatePart(tp)
	part.Write([]byte(report))
	// attachment part
	if data, err := os.ReadFile(attachPath); err == nil {
		ap := textproto.MIMEHeader{}
		ap.Set("Content-Type", "text/plain; charset=utf-8")
		ap.Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filepath.Base(attachPath)))
		p2, _ := mw.CreatePart(ap)
		p2.Write(data)
	}
	mw.Close()

	addr := host + ":" + port
	var auth smtp.Auth
	if user != "" {
		auth = smtp.PlainAuth("", user, pass, host)
	}
	if err := smtp.SendMail(addr, auth, from, []string{supportInbox}, msg.Bytes()); err != nil {
		return false, err
	}
	return true, nil
}
