//go:build windows

package main

import (
	"bufio"
	"bytes"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

// hidden runs a console tool without flashing a window over the app.
func hidden(name string, args ...string) *exec.Cmd {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	return cmd
}

// appRunning reports whether a process with exe's file name is running.
// tasklist's CSV rows start with the quoted image name whatever the
// Windows language, so only that is matched.
func appRunning(exe string) (bool, error) {
	image := filepath.Base(exe)
	out, err := hidden("tasklist", "/FI", "IMAGENAME eq "+image, "/FO", "CSV", "/NH").Output()
	if err != nil {
		return false, err
	}
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(sc.Text())), `"`+strings.ToLower(image)+`"`) {
			return true, nil
		}
	}
	return false, nil
}

// appClose asks the program to close, like clicking its X: no /F, so it
// can ask about unsaved work first.
func appClose(exe string) error {
	return hidden("taskkill", "/IM", filepath.Base(exe)).Run()
}
