package main

// Compass on an Epicor-hosted Eagle server turned out to be MySQL 5.1.73,
// reached over the store's VPN, with SSH on port 22 and SSL that modern
// encryption can't use. These fakes speak just enough of each to test the
// connection against that, with no real server needed.

import (
	"context"
	"io"
	"net"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type fakeServer struct {
	port     int
	conns    atomic.Int32 // connections opened
	tlsTries atomic.Int32 // SSL requests (each failed its handshake)
}

// listen runs handle for every connection until the test ends.
func listen(t *testing.T, handle func(net.Conn, *fakeServer)) *fakeServer {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeServer{port: ln.Addr().(*net.TCPAddr).Port}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			f.conns.Add(1)
			go func() {
				defer c.Close()
				c.SetDeadline(time.Now().Add(10 * time.Second))
				handle(c, f)
			}()
		}
	}()
	return f
}

func writePacket(c net.Conn, seq byte, payload []byte) {
	n := len(payload)
	c.Write(append([]byte{byte(n), byte(n >> 8), byte(n >> 16), seq}, payload...))
}

func readPacket(c net.Conn) (byte, []byte, error) {
	var h [4]byte
	if _, err := io.ReadFull(c, h[:]); err != nil {
		return 0, nil, err
	}
	p := make([]byte, int(h[0])|int(h[1])<<8|int(h[2])<<16)
	_, err := io.ReadFull(c, p)
	return h[3], p, err
}

// greeting51 is MySQL 5.1.73's greeting: protocol 10, no auth plugin name,
// and the SSL capability bit set.
func greeting51() []byte {
	p := []byte{10}
	p = append(p, "5.1.73-log\x00"...)
	p = append(p, 7, 0, 0, 0)        // connection id
	p = append(p, "abcdefgh\x00"...) // scramble, part 1
	p = append(p, 0xff, 0xff)        // capabilities: protocol 41, SSL, secure connection…
	p = append(p, 8, 2, 0, 0, 0, 0)  // latin1, status, upper capabilities
	p = append(p, make([]byte, 10)...)
	return append(p, "ijklmnopqrst\x00"...) // scramble, part 2
}

func errPayload(code uint16, msg string) []byte {
	return append([]byte{0xff, byte(code), byte(code >> 8), '#', '2', '8', '0', '0', '0'}, msg...)
}

var okPayload = []byte{0, 0, 0, 2, 0, 0, 0}

// fakeOldMySQL acts like the Compass we met. A login without SSL gets
// loginErr (or, when it's 0, gets in: pings work, and SET SESSION
// TRANSACTION READ ONLY is a syntax error, as on MySQL before 5.6).
func fakeOldMySQL(t *testing.T, loginErr uint16) *fakeServer {
	return listen(t, func(c net.Conn, f *fakeServer) {
		writePacket(c, 0, greeting51())
		_, p, err := readPacket(c)
		if err != nil {
			return
		}
		if len(p) == 32 { // an SSL request; the TLS ClientHello follows
			f.tlsTries.Add(1)
			buf := make([]byte, 512)
			c.Read(buf)
			c.Write([]byte{0x15, 0x03, 0x01, 0x00, 0x02, 0x02, 0x28}) // fatal alert: handshake_failure
			return
		}
		if loginErr != 0 {
			writePacket(c, 2, errPayload(loginErr, "Access denied for user 'CPS'@'10.1.2.3' (using password: YES)"))
			return
		}
		writePacket(c, 2, okPayload)
		for {
			_, p, err := readPacket(c)
			if err != nil || len(p) == 0 || p[0] == 0x01 { // COM_QUIT
				return
			}
			if p[0] == 0x03 && strings.Contains(string(p[1:]), "READ ONLY") {
				writePacket(c, 1, errPayload(1064, "You have an error in your SQL syntax"))
				continue
			}
			writePacket(c, 1, okPayload)
		}
	})
}

func checksByName(res compassTestResult) map[string]compassCheck {
	m := map[string]compassCheck{}
	for _, c := range res.Checks {
		m[c.Name] = c
	}
	return m
}

// The bug from the field: "remote error: tls: handshake failure" hid the
// real answer from the SSL-off try.
func TestCompassOldServerShowsTheRealLoginError(t *testing.T) {
	f := fakeOldMySQL(t, 1045)
	res := runCompassTest(context.Background(), compassSettings{Server: "127.0.0.1", Port: f.port, Database: "Ace_12180", Username: "CPS", TLS: "preferred"})
	c := checksByName(res)
	if c["MySQL port"].Status != "pass" || !strings.Contains(c["MySQL port"].Detail, "MySQL 5.1.73-log answered") {
		t.Fatalf("port: %+v", c["MySQL port"])
	}
	if login := c["MySQL login"]; login.Status != "fail" || !strings.Contains(login.Detail, "username or password") || strings.Contains(login.Detail, "tls") {
		t.Fatalf("login should show the server's refusal, not the SSL error: %+v", login)
	}
	// One SSL try, one plain try — and no extra connection for the port check.
	if n, tl := f.conns.Load(), f.tlsTries.Load(); n != 2 || tl != 1 {
		t.Fatalf("connections %d, SSL tries %d", n, tl)
	}
}

func TestCompassOldServerRemembersTheWayIn(t *testing.T) {
	t.Setenv("ACE_CONFIG_DIR", t.TempDir())
	f := fakeOldMySQL(t, 0)
	s := compassSettings{Server: "127.0.0.1", Port: f.port, Database: "Ace_12180", Username: "CPS", TLS: "preferred"}
	_ = s.setPassword("pw")
	if err := saveCompass(s); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	cc, err := openCompass(ctx, s, "pw")
	if err != nil {
		t.Fatal(err)
	}
	if cc.key != "nossl" || cc.readOnly || cc.hello.Version != "5.1.73-log" || !strings.Contains(cc.mode, "SSL off") {
		t.Fatalf("%+v", cc)
	}
	cc.Close()
	rememberCompassMode(s, cc.key)
	saved, _ := loadCompass()
	if saved.Mode != "nossl" {
		t.Fatalf("mode not remembered: %q", saved.Mode)
	}
	// Next time it goes straight in: no failed SSL try.
	before, tlsBefore := f.conns.Load(), f.tlsTries.Load()
	cc, err = openCompass(ctx, saved, "pw")
	if err != nil {
		t.Fatal(err)
	}
	cc.Close()
	if f.conns.Load()-before != 1 || f.tlsTries.Load() != tlsBefore {
		t.Fatalf("went the long way round: %d connections, %d SSL tries", f.conns.Load()-before, f.tlsTries.Load()-tlsBefore)
	}
	// Changing the connection settings forgets it.
	u, err := applyCompassUpdate(saved, compassUpdate{Server: "127.0.0.1", Port: f.port, Database: "Ace_12180", Username: "someone-else"})
	if err != nil || u.Mode != "" {
		t.Fatalf("mode kept after a change: %q %v", u.Mode, err)
	}
	u, _ = applyCompassUpdate(saved, compassUpdate{Server: "127.0.0.1", Port: f.port, Database: "Ace_12180", Username: "CPS", TLS: "preferred"})
	if u.Mode != "nossl" {
		t.Fatalf("mode lost on an unchanged save: %q", u.Mode)
	}
}

func TestCompassRequiredSSLNeverGoesWithout(t *testing.T) {
	f := fakeOldMySQL(t, 0)
	_, err := openCompass(context.Background(), compassSettings{Server: "127.0.0.1", Port: f.port, Database: "d", Username: "u", TLS: "on"}, "pw")
	if err == nil {
		t.Fatal("connected without SSL although SSL is Required")
	}
	if d, fix := explainMySQLError(err); !strings.Contains(d, "SSL") || !strings.Contains(fix, "Use if the server has it") {
		t.Fatalf("%q %q", d, fix)
	}
	if f.tlsTries.Load() != f.conns.Load() {
		t.Fatalf("%d connections but %d SSL tries", f.conns.Load(), f.tlsTries.Load())
	}
}

func TestCompassSSHPort(t *testing.T) {
	f := listen(t, func(c net.Conn, _ *fakeServer) {
		c.Write([]byte("SSH-2.0-OpenSSH_8.0\r\n"))
		io.Copy(io.Discard, c)
	})
	t0 := time.Now()
	res := runCompassTest(context.Background(), compassSettings{Server: "127.0.0.1", Port: f.port, Database: "d", Username: "u", TLS: "preferred"})
	c := checksByName(res)
	if p := c["MySQL port"]; p.Status != "fail" || !strings.Contains(p.Detail, "SSH (SSH-2.0-OpenSSH_8.0)") || !strings.Contains(p.Fix, "3306") {
		t.Fatalf("%+v", p)
	}
	if c["MySQL login"].Status != "skip" || f.conns.Load() != 1 {
		t.Fatalf("%+v, %d connections", res.Checks, f.conns.Load())
	}
	if el := time.Since(t0); el > 5*time.Second {
		t.Fatalf("took %v — it should stop at the SSH banner", el)
	}
}

func TestCompassBlockedHost(t *testing.T) {
	f := listen(t, func(c net.Conn, _ *fakeServer) {
		writePacket(c, 0, []byte("\xffi\x04Host '10.1.2.3' is blocked because of many connection errors; unblock with 'mysqladmin flush-hosts'"))
	})
	res := runCompassTest(context.Background(), compassSettings{Server: "127.0.0.1", Port: f.port, Database: "d", Username: "u", TLS: "preferred"})
	c := checksByName(res)
	if c["MySQL port"].Status != "pass" || c["MySQL login"].Status != "fail" ||
		!strings.Contains(c["MySQL login"].Detail, "blocked") || !strings.Contains(c["MySQL login"].Fix, "FLUSH HOSTS") {
		t.Fatalf("%+v", res.Checks)
	}
	if f.conns.Load() != 1 {
		t.Fatalf("kept trying a blocked server: %d connections", f.conns.Load())
	}
}

func TestCompassSilentPort(t *testing.T) {
	f := listen(t, func(c net.Conn, _ *fakeServer) { io.Copy(io.Discard, c) })
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	res := runCompassTest(ctx, compassSettings{Server: "127.0.0.1", Port: f.port, Database: "d", Username: "u", TLS: "preferred"})
	if p := checksByName(res)["MySQL port"]; p.Status != "fail" || !strings.Contains(p.Detail, "nothing answered") {
		t.Fatalf("%+v", res.Checks)
	}
}

func TestHelloInfo(t *testing.T) {
	pkt := func(p []byte) []byte { return append([]byte{byte(len(p)), 0, 0, 0}, p...) }
	cases := []struct {
		raw  []byte
		want helloInfo
	}{
		{nil, helloInfo{}},
		{pkt(greeting51()), helloInfo{Kind: "mysql", Version: "5.1.73-log"}},
		{[]byte("SSH-2.0-OpenSSH_8.0\r\n"), helloInfo{Kind: "ssh", Message: "SSH-2.0-OpenSSH_8.0"}},
		{pkt([]byte("\xffj\x04Host '10.1.2.3' is not allowed to connect to this MySQL server")), helloInfo{Kind: "mysql-error", Code: 1130, Message: "Host '10.1.2.3' is not allowed to connect to this MySQL server"}},
		{pkt(errPayload(1129, "blocked")), helloInfo{Kind: "mysql-error", Code: 1129, Message: "blocked"}},
		{[]byte("HTTP/1.1 400 Bad Request\r\n"), helloInfo{Kind: "other"}},
	}
	for _, c := range cases {
		if got := (&serverHello{raw: c.raw}).info(); got != c.want {
			t.Errorf("%q: got %+v, want %+v", c.raw, got, c.want)
		}
	}
}

func TestCompassAttemptOrder(t *testing.T) {
	keys := func(s compassSettings) string {
		var k []string
		for _, a := range compassAttempts(s) {
			k = append(k, a.key+"/"+a.tls)
		}
		return strings.Join(k, " ")
	}
	for _, c := range []struct {
		s    compassSettings
		want string
	}{
		{compassSettings{TLS: "preferred"}, "ssl/preferred nossl/false oldpw/false"},
		{compassSettings{TLS: "preferred", Mode: "nossl"}, "nossl/false ssl/preferred oldpw/false"},
		{compassSettings{TLS: "preferred", Mode: "oldpw"}, "oldpw/false ssl/preferred nossl/false"},
		{compassSettings{TLS: "off"}, "nossl/false oldpw/false"},
		{compassSettings{TLS: "off", Mode: "ssl"}, "nossl/false oldpw/false"},
		{compassSettings{TLS: "on"}, "ssl/skip-verify oldpw/skip-verify"},
	} {
		if got := keys(c.s); got != c.want {
			t.Errorf("%+v: %s, want %s", c.s, got, c.want)
		}
	}
}
