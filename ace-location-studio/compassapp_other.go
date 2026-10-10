//go:build !windows

package main

import (
	"errors"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
)

// Off Windows (development and tests) a "Compass" is any process whose
// command line contains the program's path.

func appPIDs(exe string) ([]int, error) {
	out, err := exec.Command("pgrep", "-f", exe).Output()
	var ee *exec.ExitError
	if errors.As(err, &ee) && ee.ExitCode() == 1 {
		return nil, nil // none
	}
	if err != nil {
		return nil, err
	}
	var pids []int
	for _, f := range strings.Fields(string(out)) {
		if n, err := strconv.Atoi(f); err == nil {
			pids = append(pids, n)
		}
	}
	return pids, nil
}

func appRunning(exe string) (bool, error) {
	pids, err := appPIDs(exe)
	return len(pids) > 0, err
}

// appClose asks politely (SIGTERM), never SIGKILL.
func appClose(exe string) error {
	pids, err := appPIDs(exe)
	for _, p := range pids {
		_ = syscall.Kill(p, syscall.SIGTERM)
	}
	return err
}
