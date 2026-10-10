package main

import (
	"bytes"
	"encoding/binary"
	"math"
	"reflect"
	"testing"
	"unicode/utf16"
)

// Hand-built .xls files, for the cases the fixture generator can't produce:
// a workbook small enough to live in the compound file's mini stream, and
// the less common cell records (LABEL, MULRK, FORMULA + STRING, BOOLERR,
// a string split across CONTINUE records with a width change).

type biffBuf struct{ bytes.Buffer }

func (b *biffBuf) rec(id uint16, data []byte) {
	var h [4]byte
	binary.LittleEndian.PutUint16(h[:], id)
	binary.LittleEndian.PutUint16(h[2:], uint16(len(data)))
	b.Write(h[:])
	b.Write(data)
}

func le16(v int) []byte { b := make([]byte, 2); binary.LittleEndian.PutUint16(b, uint16(v)); return b }
func le32(v uint32) []byte {
	b := make([]byte, 4)
	binary.LittleEndian.PutUint32(b, v)
	return b
}
func cat(parts ...[]byte) []byte { return bytes.Join(parts, nil) }

// xlStr is an 8-bit XLUnicodeString (cch, flags=0, chars).
func xlStr(s string) []byte { return cat(le16(len(s)), []byte{0}, []byte(s)) }

func cellHead(row, col int) []byte { return cat(le16(row), le16(col), le16(15)) }

// buildWorkbook makes a BIFF8 Workbook stream whose single sheet holds the
// given SST cells (row, col → index) plus whatever extra records the caller
// writes.
func buildWorkbook(sst [][]byte, sstContinues [][]byte, uniq int, sheet func(*biffBuf)) []byte {
	bof := func(kind int) []byte { return cat(le16(0x0600), le16(kind), make([]byte, 12)) }
	var g biffBuf
	g.rec(recBOF, bof(0x0005))
	// BOUNDSHEET is patched once the sheet offset is known.
	bsAt := g.Len()
	g.rec(recBOUNDSHEET, cat(le32(0), []byte{0, 0}, []byte{6, 0}, []byte("Sheet1")))
	g.rec(recSST, cat(le32(uint32(uniq)), le32(uint32(uniq)), bytes.Join(sst, nil)))
	for _, c := range sstContinues {
		g.rec(recCONTINUE, c)
	}
	g.rec(recEOF, nil)
	sheetPos := g.Len()
	binary.LittleEndian.PutUint32(g.Bytes()[bsAt+4:], uint32(sheetPos))
	var s biffBuf
	s.rec(recBOF, bof(0x0010))
	sheet(&s)
	s.rec(recEOF, nil)
	return append(g.Bytes(), s.Bytes()...)
}

// buildMiniCFB wraps a small stream (< 4096 bytes) in a version-3 compound
// file, stored in the mini stream as Excel does for tiny workbooks.
func buildMiniCFB(workbook []byte) []byte {
	const ss, ms = 512, 64
	const end, free, fatSect = 0xFFFFFFFE, 0xFFFFFFFF, 0xFFFFFFFD
	mini := append([]byte(nil), workbook...)
	for len(mini)%ms != 0 {
		mini = append(mini, 0)
	}
	nMini := len(mini) / ms
	container := append([]byte(nil), mini...)
	for len(container)%ss != 0 {
		container = append(container, 0)
	}
	nCont := len(container) / ss

	hdr := make([]byte, ss)
	copy(hdr, cfbMagic)
	le := binary.LittleEndian
	le.PutUint16(hdr[0x18:], 0x3E)
	le.PutUint16(hdr[0x1A:], 3)
	le.PutUint16(hdr[0x1C:], 0xFFFE)
	le.PutUint16(hdr[0x1E:], 9)
	le.PutUint16(hdr[0x20:], 6)
	le.PutUint32(hdr[0x2C:], 1)    // one FAT sector
	le.PutUint32(hdr[0x30:], 1)    // directory at sector 1
	le.PutUint32(hdr[0x38:], 4096) // mini cutoff
	le.PutUint32(hdr[0x3C:], 2)    // mini FAT at sector 2
	le.PutUint32(hdr[0x40:], 1)
	le.PutUint32(hdr[0x44:], end)
	for i := 0; i < 109; i++ {
		le.PutUint32(hdr[0x4C+4*i:], free)
	}
	le.PutUint32(hdr[0x4C:], 0) // FAT is sector 0

	fat := make([]byte, ss)
	for i := 0; i < ss/4; i++ {
		le.PutUint32(fat[4*i:], free)
	}
	le.PutUint32(fat[0:], fatSect)
	le.PutUint32(fat[4:], end) // directory
	le.PutUint32(fat[8:], end) // mini FAT
	for i := 0; i < nCont; i++ {
		next := uint32(3 + i + 1)
		if i == nCont-1 {
			next = end
		}
		le.PutUint32(fat[4*(3+i):], next)
	}

	entry := func(name string, kind byte, start uint32, size uint64) []byte {
		e := make([]byte, 128)
		u := utf16.Encode([]rune(name))
		for i, c := range u {
			le.PutUint16(e[2*i:], c)
		}
		le.PutUint16(e[64:], uint16(2*(len(u)+1)))
		e[66] = kind
		le.PutUint32(e[68:], free)
		le.PutUint32(e[72:], free)
		le.PutUint32(e[76:], free)
		le.PutUint32(e[116:], start)
		le.PutUint64(e[120:], size)
		return e
	}
	root := entry("Root Entry", 5, 3, uint64(len(mini)))
	le.PutUint32(root[76:], 1) // child: the Workbook entry
	dir := cat(root, entry("Workbook", 2, 0, uint64(len(workbook))), make([]byte, 256))

	mfat := make([]byte, ss)
	for i := 0; i < ss/4; i++ {
		le.PutUint32(mfat[4*i:], free)
	}
	for i := 0; i < nMini; i++ {
		next := uint32(i + 1)
		if i == nMini-1 {
			next = end
		}
		le.PutUint32(mfat[4*i:], next)
	}
	return cat(hdr, fat, dir, mfat, container)
}

func TestReadXLSMiniStreamAndRareRecords(t *testing.T) {
	heads := []string{"SKU", "Description", "Current Location Codes", "Current Location 2", "Current Location 3", "Current Location 4", "Current Location 5", "Current Location 6"}
	var sst [][]byte
	for _, h := range heads {
		sst = append(sst, xlStr(h))
	}
	wb := buildWorkbook(sst, nil, len(sst), func(s *biffBuf) {
		for c := range heads {
			s.rec(recLABELSST, cat(cellHead(0, c), le32(uint32(c))))
		}
		// Row 1: SKU as a NUMBER, desc as LABEL, loc1 via FORMULA+STRING,
		// capacity via RK, overstock 4–5 via MULRK, loc 6 via BOOLERR (error → blank).
		var num [8]byte
		binary.LittleEndian.PutUint64(num[:], math.Float64bits(7000137))
		s.rec(recNUMBER, cat(cellHead(1, 0), num[:]))
		s.rec(recLABEL, cat(cellHead(1, 1), xlStr("HAND PRUNER")))
		s.rec(recFORMULA, cat(cellHead(1, 2), []byte{0, 0, 0, 0, 0, 0, 0xFF, 0xFF}, make([]byte, 6)))
		s.rec(recSTRING, xlStr("12R05"))
		s.rec(recRK, cat(cellHead(1, 4), le32(uint32(6)<<2|2)))
		s.rec(recMULRK, cat(le16(1), le16(5), le16(15), le32(uint32(107)<<2|2), le16(15), le32(uint32(42)<<2|2), le16(6)))
		s.rec(recBOOLERR, cat(cellHead(1, 7), []byte{0x07, 1}))
	})
	if len(wb) >= 4096 {
		t.Fatalf("workbook %d bytes — too big for the mini stream", len(wb))
	}
	file := buildMiniCFB(wb)
	sheet, grid, err := readSheet("tiny.xls", file)
	if err != nil {
		t.Fatal(err)
	}
	ef, err := parseEagle("tiny.xls", sheet, grid)
	if err != nil {
		t.Fatal(err)
	}
	want := []EagleRow{{SKU: "7000137", Desc: "HAND PRUNER", Locs: [6]string{"12R05", "", "6", "107", "42", ""}}}
	if sheet != "Sheet1" || !reflect.DeepEqual(ef.Rows, want) {
		t.Fatalf("sheet %q rows %+v", sheet, ef.Rows)
	}
}

// A shared string that crosses into a CONTINUE record, switching from 8-bit
// to 16-bit characters there, must come back whole.
func TestReadXLSStringAcrossContinue(t *testing.T) {
	heads := []string{"SKU", "Description", "Location 1", "Location 2", "Location 3", "Location 4", "Location 5", "Location 6"}
	var sst [][]byte
	for _, h := range heads {
		sst = append(sst, xlStr(h))
	}
	// "PRUNER — " is 9 chars: 7 go in the SST record (8-bit), the rest
	// ("— BYPASS", with the em dash) in a CONTINUE as 16-bit chars.
	full := "PRUNER — BYPASS"
	runes := []rune(full)
	split := 7
	sst = append(sst, cat(le16(len(runes)), []byte{0}, []byte(string(runes[:split]))))
	var wide []byte
	for _, c := range utf16.Encode(runes[split:]) {
		wide = append(wide, le16(int(c))...)
	}
	cont := cat([]byte{1}, wide, xlStr("70013"), xlStr("12R02"))
	wb := buildWorkbook(sst, [][]byte{cont}, len(heads)+3, func(s *biffBuf) {
		for c := range heads {
			s.rec(recLABELSST, cat(cellHead(0, c), le32(uint32(c))))
		}
		s.rec(recLABELSST, cat(cellHead(1, 0), le32(uint32(len(heads)+1))))
		s.rec(recLABELSST, cat(cellHead(1, 1), le32(uint32(len(heads)))))
		s.rec(recLABELSST, cat(cellHead(1, 2), le32(uint32(len(heads)+2))))
	})
	sheet, grid, err := readSheet("split.xls", buildMiniCFB(wb))
	if err != nil {
		t.Fatal(err)
	}
	ef, err := parseEagle("split.xls", sheet, grid)
	if err != nil {
		t.Fatal(err)
	}
	if len(ef.Rows) != 1 || ef.Rows[0].Desc != full || ef.Rows[0].SKU != "70013" || ef.Rows[0].Locs[0] != "12R02" {
		t.Fatalf("rows %+v", ef.Rows)
	}
}

func TestReadXLSPasswordProtected(t *testing.T) {
	wb := buildWorkbook(nil, nil, 0, func(*biffBuf) {})
	// Insert a FILEPASS record right after the globals BOF.
	var b biffBuf
	b.Write(wb[:4+16])
	b.rec(recFILEPASS, make([]byte, 6))
	b.Write(wb[4+16:])
	_, _, err := readSheet("locked.xls", buildMiniCFB(b.Bytes()))
	if err == nil || !bytes.Contains([]byte(err.Error()), []byte("password")) {
		t.Fatalf("err = %v", err)
	}
}
