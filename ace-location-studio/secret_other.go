//go:build !windows

package main

// Off Windows (development and tests only) there is no DPAPI; the password
// is stored with a marker so the round trip still works. The store app
// always runs on Windows, where secret_windows.go encrypts it.

import (
	"bytes"
	"errors"
)

var plainMarker = []byte("plain:")

func protectSecret(plain []byte) ([]byte, error) {
	return append(append([]byte{}, plainMarker...), plain...), nil
}

func unprotectSecret(enc []byte) ([]byte, error) {
	if !bytes.HasPrefix(enc, plainMarker) {
		return nil, errors.New("not a password saved on this system")
	}
	return enc[len(plainMarker):], nil
}
