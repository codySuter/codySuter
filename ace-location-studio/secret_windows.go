//go:build windows

package main

// The Compass password is encrypted with Windows DPAPI (CryptProtectData)
// for the signed-in Windows user, so compass.json is useless if copied to
// another computer or account.

import (
	"errors"
	"syscall"
	"unsafe"
)

var (
	crypt32            = syscall.NewLazyDLL("crypt32.dll")
	kernel32           = syscall.NewLazyDLL("kernel32.dll")
	procCryptProtect   = crypt32.NewProc("CryptProtectData")
	procCryptUnprotect = crypt32.NewProc("CryptUnprotectData")
	procLocalFree      = kernel32.NewProc("LocalFree")
	errDPAPI           = errors.New("Windows couldn't protect the password")
	secretEntropy      = []byte("AceLocationStudio/compass")
)

const cryptprotectUIForbidden = 0x1

type dataBlob struct {
	cbData uint32
	pbData *byte
}

func newBlob(b []byte) *dataBlob {
	if len(b) == 0 {
		return &dataBlob{}
	}
	return &dataBlob{cbData: uint32(len(b)), pbData: &b[0]}
}

func (b *dataBlob) bytes() []byte {
	out := make([]byte, b.cbData)
	copy(out, unsafe.Slice(b.pbData, b.cbData))
	return out
}

func protectSecret(plain []byte) ([]byte, error) {
	var out dataBlob
	r, _, err := procCryptProtect.Call(uintptr(unsafe.Pointer(newBlob(plain))), 0, uintptr(unsafe.Pointer(newBlob(secretEntropy))), 0, 0, cryptprotectUIForbidden, uintptr(unsafe.Pointer(&out)))
	if r == 0 {
		if err != nil {
			return nil, err
		}
		return nil, errDPAPI
	}
	defer procLocalFree.Call(uintptr(unsafe.Pointer(out.pbData)))
	return out.bytes(), nil
}

func unprotectSecret(enc []byte) ([]byte, error) {
	var out dataBlob
	r, _, err := procCryptUnprotect.Call(uintptr(unsafe.Pointer(newBlob(enc))), 0, uintptr(unsafe.Pointer(newBlob(secretEntropy))), 0, 0, cryptprotectUIForbidden, uintptr(unsafe.Pointer(&out)))
	if r == 0 {
		if err != nil {
			return nil, err
		}
		return nil, errDPAPI
	}
	defer procLocalFree.Call(uintptr(unsafe.Pointer(out.pbData)))
	return out.bytes(), nil
}
