// SignShop launcher: single-file executable that serves the embedded
// sign-shop web app on localhost and opens it in the default browser.
// The browser is deliberate — its print preview / "Save as PDF" is the
// printing workflow the signs are designed around.
//
// Build (from sign-shop/): tools/build_exe.sh
package main

import (
	"embed"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"sync/atomic"
	"time"
)

// The app is copied into launcher/app/ by the build script.
//
//go:embed all:app
var appFiles embed.FS

// Fixed port keeps the browser origin stable so saved sign edits and
// imported pricing (localStorage) survive restarts.
const port = 8377

const healthPath = "/__signshop"
const pingPath = "/__ping"

func main() {
	// If a previous instance is already serving, just open the browser.
	if alreadyRunning() {
		openBrowser(fmt.Sprintf("http://localhost:%d/", port))
		return
	}

	sub, err := fs.Sub(appFiles, "app")
	if err != nil {
		panic(err)
	}

	var lastPing atomic.Int64
	lastPing.Store(time.Now().UnixMilli())
	var pinged atomic.Bool

	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(sub)))
	mux.HandleFunc(healthPath, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("signshop"))
	})
	mux.HandleFunc(pingPath, func(w http.ResponseWriter, r *http.Request) {
		lastPing.Store(time.Now().UnixMilli())
		pinged.Store(true)
		w.Write([]byte("ok"))
	})

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		// Port taken by something that isn't us — surface it in the
		// browser via a data URL is overkill; just bail quietly.
		return
	}

	go func() {
		// Exit when every app tab has been closed for a while. Tabs ping
		// every 2s; wait until at least one ping ever arrived so we don't
		// exit before the browser finishes launching.
		for {
			time.Sleep(5 * time.Second)
			idle := time.Now().UnixMilli() - lastPing.Load()
			if pinged.Load() && idle > 30_000 {
				ln.Close()
				return
			}
			if !pinged.Load() && idle > 10*60_000 {
				ln.Close() // browser never showed up; give up after 10 min
				return
			}
		}
	}()

	openBrowser(fmt.Sprintf("http://localhost:%d/", port))
	http.Serve(ln, mux)
}

func alreadyRunning() bool {
	c := http.Client{Timeout: 700 * time.Millisecond}
	resp, err := c.Get(fmt.Sprintf("http://127.0.0.1:%d%s", port, healthPath))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	buf := make([]byte, 16)
	n, _ := resp.Body.Read(buf)
	return string(buf[:n]) == "signshop"
}

func openBrowser(url string) {
	switch runtime.GOOS {
	case "windows":
		exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		exec.Command("open", url).Start()
	default:
		exec.Command("xdg-open", url).Start()
	}
}
