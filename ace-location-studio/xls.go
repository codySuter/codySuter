package main

// A small reader for legacy Excel .xls files (BIFF8 inside an OLE2 compound
// file), which is what Epicor Eagle saves when it exports to Excel. It reads
// the first worksheet's cell text into a grid and nothing else — no
// formatting, formulas are taken from their cached result.
//
// References: [MS-CFB] (compound file) and [MS-XLS] (BIFF8 records).

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode/utf16"
)

var cfbMagic = []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}

const (
	cfbEndOfChain = 0xFFFFFFFE
	cfbFree       = 0xFFFFFFFF
	cfbMaxSect    = 0xFFFFFFFA
)

// cfbFile is a parsed OLE2 compound file, enough to read streams by name.
type cfbFile struct {
	data       []byte
	sectorSize int
	miniSize   int
	miniCutoff uint64
	fat        []uint32
	miniFAT    []uint32
	dir        []cfbEntry
	miniStream []byte
}

type cfbEntry struct {
	name  string
	kind  byte // 1 storage, 2 stream, 5 root
	start uint32
	size  uint64
}

func openCFB(data []byte) (*cfbFile, error) {
	if len(data) < 512 || !bytes.Equal(data[:8], cfbMagic) {
		return nil, errors.New("not an Excel 97-2003 (.xls) file")
	}
	le := binary.LittleEndian
	shift := le.Uint16(data[0x1E:])
	miniShift := le.Uint16(data[0x20:])
	if shift != 9 && shift != 12 {
		return nil, fmt.Errorf("unsupported .xls sector size (2^%d)", shift)
	}
	f := &cfbFile{
		data:       data,
		sectorSize: 1 << shift,
		miniSize:   1 << miniShift,
		miniCutoff: uint64(le.Uint32(data[0x38:])),
	}
	numFAT := le.Uint32(data[0x2C:])
	firstDir := le.Uint32(data[0x30:])
	firstMiniFAT := le.Uint32(data[0x3C:])
	firstDIFAT := le.Uint32(data[0x44:])
	numDIFAT := le.Uint32(data[0x48:])

	// The FAT's own sector list: 109 entries in the header, the rest in a
	// chain of DIFAT sectors.
	var fatSectors []uint32
	for i := 0; i < 109 && uint32(len(fatSectors)) < numFAT; i++ {
		s := le.Uint32(data[0x4C+4*i:])
		if s <= cfbMaxSect {
			fatSectors = append(fatSectors, s)
		}
	}
	next := firstDIFAT
	for n := uint32(0); n < numDIFAT && next <= cfbMaxSect; n++ {
		sec, err := f.sector(next)
		if err != nil {
			return nil, err
		}
		per := f.sectorSize/4 - 1
		for i := 0; i < per && uint32(len(fatSectors)) < numFAT; i++ {
			s := le.Uint32(sec[4*i:])
			if s <= cfbMaxSect {
				fatSectors = append(fatSectors, s)
			}
		}
		next = le.Uint32(sec[4*per:])
	}
	for _, s := range fatSectors {
		sec, err := f.sector(s)
		if err != nil {
			return nil, err
		}
		for i := 0; i < f.sectorSize; i += 4 {
			f.fat = append(f.fat, le.Uint32(sec[i:]))
		}
	}

	dirData, err := f.chain(firstDir, f.fat, f.sector, 0)
	if err != nil {
		return nil, fmt.Errorf("reading .xls directory: %w", err)
	}
	for off := 0; off+128 <= len(dirData); off += 128 {
		e := dirData[off : off+128]
		nameLen := int(le.Uint16(e[64:]))
		if nameLen > 64 {
			nameLen = 64
		}
		var u []uint16
		for i := 0; i+1 < nameLen; i += 2 {
			if c := le.Uint16(e[i:]); c != 0 {
				u = append(u, c)
			}
		}
		size := le.Uint64(e[120:])
		if f.sectorSize == 512 {
			size &= 0xFFFFFFFF // v3 files: high dword is undefined
		}
		f.dir = append(f.dir, cfbEntry{name: string(utf16.Decode(u)), kind: e[66], start: le.Uint32(e[116:]), size: size})
	}
	if len(f.dir) == 0 || f.dir[0].kind != 5 {
		return nil, errors.New("damaged .xls file (no root entry)")
	}

	if firstMiniFAT <= cfbMaxSect {
		mf, err := f.chain(firstMiniFAT, f.fat, f.sector, 0)
		if err != nil {
			return nil, fmt.Errorf("reading .xls mini FAT: %w", err)
		}
		for i := 0; i+4 <= len(mf); i += 4 {
			f.miniFAT = append(f.miniFAT, le.Uint32(mf[i:]))
		}
		root := f.dir[0]
		f.miniStream, err = f.chain(root.start, f.fat, f.sector, root.size)
		if err != nil {
			return nil, fmt.Errorf("reading .xls mini stream: %w", err)
		}
	}
	return f, nil
}

func (f *cfbFile) sector(n uint32) ([]byte, error) {
	off := (int64(n) + 1) * int64(f.sectorSize)
	if n > cfbMaxSect || off+int64(f.sectorSize) > int64(len(f.data)) {
		// A truncated final sector is common in files written by other
		// tools; pad it rather than fail.
		if n <= cfbMaxSect && off < int64(len(f.data)) {
			buf := make([]byte, f.sectorSize)
			copy(buf, f.data[off:])
			return buf, nil
		}
		return nil, fmt.Errorf("sector %d is outside the file", n)
	}
	return f.data[off : off+int64(f.sectorSize)], nil
}

func (f *cfbFile) miniSector(n uint32) ([]byte, error) {
	off := int64(n) * int64(f.miniSize)
	if off+int64(f.miniSize) > int64(len(f.miniStream)) {
		return nil, fmt.Errorf("mini sector %d is outside the mini stream", n)
	}
	return f.miniStream[off : off+int64(f.miniSize)], nil
}

// chain follows a sector chain and concatenates it, trimmed to size when
// size > 0. It refuses loops.
func (f *cfbFile) chain(start uint32, table []uint32, read func(uint32) ([]byte, error), size uint64) ([]byte, error) {
	var out []byte
	seen := map[uint32]bool{}
	for s := start; s != cfbEndOfChain; {
		if s > cfbMaxSect || seen[s] {
			if s == cfbFree {
				break
			}
			return nil, errors.New("broken sector chain")
		}
		seen[s] = true
		b, err := read(s)
		if err != nil {
			return nil, err
		}
		out = append(out, b...)
		if size > 0 && uint64(len(out)) >= size {
			break
		}
		if int(s) >= len(table) {
			return nil, errors.New("sector chain runs off the allocation table")
		}
		s = table[s]
	}
	if size > 0 && uint64(len(out)) > size {
		out = out[:size]
	}
	return out, nil
}

// stream returns the named stream's bytes (case-insensitive name).
func (f *cfbFile) stream(names ...string) ([]byte, error) {
	for _, want := range names {
		for _, e := range f.dir {
			if e.kind != 2 || !strings.EqualFold(e.name, want) {
				continue
			}
			if e.size < f.miniCutoff && f.miniStream != nil {
				return f.chain(e.start, f.miniFAT, f.miniSector, e.size)
			}
			return f.chain(e.start, f.fat, f.sector, e.size)
		}
	}
	return nil, fmt.Errorf("no %s stream in the file", names[0])
}

/* ---------------- BIFF ---------------- */

const (
	recBOF        = 0x0809
	recEOF        = 0x000A
	recFILEPASS   = 0x002F
	recBOUNDSHEET = 0x0085
	recSST        = 0x00FC
	recCONTINUE   = 0x003C
	recLABELSST   = 0x00FD
	recLABEL      = 0x0204
	recRSTRING    = 0x00D6
	recNUMBER     = 0x0203
	recRK         = 0x027E
	recMULRK      = 0x00BD
	recFORMULA    = 0x0006
	recSTRING     = 0x0207
	recBOOLERR    = 0x0205
	recCODEPAGE   = 0x0042
)

type biffRecord struct {
	id   uint16
	data []byte
	pos  int // offset of the record header in the stream
}

func biffRecords(stream []byte, from int) []biffRecord {
	var out []biffRecord
	for p := from; p+4 <= len(stream); {
		id := binary.LittleEndian.Uint16(stream[p:])
		n := int(binary.LittleEndian.Uint16(stream[p+2:]))
		end := p + 4 + n
		if end > len(stream) {
			end = len(stream)
		}
		out = append(out, biffRecord{id: id, data: stream[p+4 : end], pos: p})
		p = end
		if id == recEOF && from > 0 {
			break // end of the worksheet substream
		}
	}
	return out
}

// segReader reads a BIFF8 string table that may be split across CONTINUE
// records. Character data that crosses a boundary restarts with a fresh
// option byte saying whether the rest is 8- or 16-bit.
type segReader struct {
	segs [][]byte
	si   int
	off  int
}

func (r *segReader) avail() int {
	for r.si < len(r.segs) && r.off >= len(r.segs[r.si]) {
		r.si++
		r.off = 0
	}
	if r.si >= len(r.segs) {
		return 0
	}
	return len(r.segs[r.si]) - r.off
}

func (r *segReader) bytes(n int) ([]byte, error) {
	var out []byte
	for n > 0 {
		a := r.avail()
		if a == 0 {
			return nil, errors.New("string table ends early")
		}
		k := n
		if k > a {
			k = a
		}
		out = append(out, r.segs[r.si][r.off:r.off+k]...)
		r.off += k
		n -= k
	}
	return out, nil
}

func (r *segReader) u8() (byte, error) {
	b, err := r.bytes(1)
	if err != nil {
		return 0, err
	}
	return b[0], nil
}

func (r *segReader) u16() (uint16, error) {
	b, err := r.bytes(2)
	if err != nil {
		return 0, err
	}
	return binary.LittleEndian.Uint16(b), nil
}

func (r *segReader) u32() (uint32, error) {
	b, err := r.bytes(4)
	if err != nil {
		return 0, err
	}
	return binary.LittleEndian.Uint32(b), nil
}

// xlString reads one XLUnicodeRichExtendedString.
func (r *segReader) xlString() (string, error) {
	cch, err := r.u16()
	if err != nil {
		return "", err
	}
	flags, err := r.u8()
	if err != nil {
		return "", err
	}
	var runs, ext uint32
	if flags&0x08 != 0 {
		n, err := r.u16()
		if err != nil {
			return "", err
		}
		runs = uint32(n)
	}
	if flags&0x04 != 0 {
		if ext, err = r.u32(); err != nil {
			return "", err
		}
	}
	wide := flags&0x01 != 0
	var sb strings.Builder
	for left := int(cch); left > 0; {
		a := r.avail()
		if a == 0 {
			return "", errors.New("string table ends early")
		}
		width := 1
		if wide {
			width = 2
		}
		n := a / width
		if n == 0 {
			return "", errors.New("misaligned string data")
		}
		if n > left {
			n = left
		}
		chunk, _ := r.bytes(n * width)
		sb.WriteString(decodeChars(chunk, wide))
		left -= n
		if left > 0 {
			// Crossed into a CONTINUE record: a new option byte follows.
			if r.avail() == 0 {
				return "", errors.New("string table ends early")
			}
			f2, _ := r.u8()
			wide = f2&0x01 != 0
		}
	}
	if _, err := r.bytes(int(runs)*4 + int(ext)); err != nil {
		return "", err
	}
	return sb.String(), nil
}

// decodeChars decodes BIFF8 character data: UTF-16LE when wide, otherwise
// the "compressed" form, which is the low byte of each UTF-16 code unit
// (i.e. Latin-1).
func decodeChars(b []byte, wide bool) string {
	if wide {
		u := make([]uint16, len(b)/2)
		for i := range u {
			u[i] = binary.LittleEndian.Uint16(b[2*i:])
		}
		return string(utf16.Decode(u))
	}
	r := make([]rune, len(b))
	for i, c := range b {
		r[i] = rune(c)
	}
	return string(r)
}

// shortString reads a BIFF8 XLUnicodeString (16-bit length) from a single
// record, as used by LABEL and STRING.
func shortString(b []byte, biff5 bool) string {
	if len(b) < 2 {
		return ""
	}
	n := int(binary.LittleEndian.Uint16(b))
	if biff5 {
		b = b[2:]
		if n > len(b) {
			n = len(b)
		}
		return decodeCP1252(b[:n])
	}
	r := &segReader{segs: [][]byte{b}}
	s, err := r.xlString()
	if err != nil {
		// Fall back to whatever characters are present.
		if len(b) < 3 {
			return ""
		}
		wide := b[2]&1 != 0
		data := b[3:]
		if wide && n*2 <= len(data) {
			return decodeChars(data[:n*2], true)
		}
		if !wide && n <= len(data) {
			return decodeChars(data[:n], false)
		}
		return ""
	}
	return s
}

func rkValue(rk uint32) float64 {
	var v float64
	if rk&0x02 != 0 {
		v = float64(int32(rk) >> 2)
	} else {
		v = math.Float64frombits(uint64(rk&0xFFFFFFFC) << 32)
	}
	if rk&0x01 != 0 {
		v /= 100
	}
	return v
}

// formatNumber prints a cell number the way Excel's General format would for
// the values Eagle exports (whole SKUs, capacities, bin numbers).
func formatNumber(v float64) string {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return ""
	}
	if v == math.Trunc(v) && math.Abs(v) < 1e15 {
		return strconv.FormatInt(int64(v), 10)
	}
	return strconv.FormatFloat(v, 'f', -1, 64)
}

// readXLS returns the first worksheet of a .xls file as rows of cell text.
func readXLS(data []byte) (sheetName string, grid [][]string, err error) {
	f, err := openCFB(data)
	if err != nil {
		return "", nil, err
	}
	wb, err := f.stream("Workbook", "Book")
	if err != nil {
		return "", nil, errors.New("this .xls has no workbook inside — is it really an Excel file?")
	}
	globals := biffRecords(wb, 0)
	if len(globals) == 0 || globals[0].id != recBOF || len(globals[0].data) < 2 {
		return "", nil, errors.New("damaged .xls workbook (no BOF)")
	}
	biff5 := binary.LittleEndian.Uint16(globals[0].data) < 0x0600

	var sst []string
	sheetPos := -1
	for i := 0; i < len(globals); i++ {
		rec := globals[i]
		switch rec.id {
		case recFILEPASS:
			return "", nil, errors.New("this .xls is password-protected — save it without a password and try again")
		case recBOUNDSHEET:
			if len(rec.data) < 8 || sheetPos >= 0 {
				continue
			}
			if rec.data[5] != 0 { // not a worksheet (chart, macro…)
				continue
			}
			sheetPos = int(binary.LittleEndian.Uint32(rec.data))
			nameLen := int(rec.data[6])
			if biff5 {
				if 7+nameLen <= len(rec.data) {
					sheetName = decodeCP1252(rec.data[7 : 7+nameLen])
				}
			} else if len(rec.data) >= 8 {
				wide := rec.data[7]&1 != 0
				w := 1
				if wide {
					w = 2
				}
				if 8+nameLen*w <= len(rec.data) {
					sheetName = decodeChars(rec.data[8:8+nameLen*w], wide)
				}
			}
		case recSST:
			segs := [][]byte{rec.data}
			for i+1 < len(globals) && globals[i+1].id == recCONTINUE {
				i++
				segs = append(segs, globals[i].data)
			}
			r := &segReader{segs: segs}
			if _, err := r.u32(); err != nil {
				return "", nil, err
			}
			unique, err := r.u32()
			if err != nil {
				return "", nil, err
			}
			for n := uint32(0); n < unique; n++ {
				s, err := r.xlString()
				if err != nil {
					return "", nil, fmt.Errorf("reading the .xls string table: %w", err)
				}
				sst = append(sst, s)
			}
		case recEOF:
			i = len(globals) // end of globals
		}
	}
	if sheetPos < 0 || sheetPos >= len(wb) {
		return "", nil, errors.New("no worksheet found in the .xls file")
	}

	cells := map[[2]int]string{}
	set := func(row, col int, v string) {
		if v != "" {
			cells[[2]int{row, col}] = v
		}
	}
	le := binary.LittleEndian
	pendingFormula := [2]int{-1, -1}
	for _, rec := range biffRecords(wb, sheetPos) {
		d := rec.data
		switch rec.id {
		case recLABELSST:
			if len(d) >= 10 {
				idx := int(le.Uint32(d[6:]))
				if idx < len(sst) {
					set(int(le.Uint16(d)), int(le.Uint16(d[2:])), sst[idx])
				}
			}
		case recLABEL, recRSTRING:
			if len(d) >= 8 {
				set(int(le.Uint16(d)), int(le.Uint16(d[2:])), shortString(d[6:], biff5))
			}
		case recNUMBER:
			if len(d) >= 14 {
				set(int(le.Uint16(d)), int(le.Uint16(d[2:])), formatNumber(math.Float64frombits(le.Uint64(d[6:]))))
			}
		case recRK:
			if len(d) >= 10 {
				set(int(le.Uint16(d)), int(le.Uint16(d[2:])), formatNumber(rkValue(le.Uint32(d[6:]))))
			}
		case recMULRK:
			if len(d) >= 6 {
				row := int(le.Uint16(d))
				col := int(le.Uint16(d[2:]))
				for p := 4; p+6 <= len(d)-2; p += 6 {
					set(row, col, formatNumber(rkValue(le.Uint32(d[p+2:]))))
					col++
				}
			}
		case recFORMULA:
			if len(d) >= 14 {
				row, col := int(le.Uint16(d)), int(le.Uint16(d[2:]))
				res := d[6:14]
				if le.Uint16(res[6:]) == 0xFFFF {
					switch res[0] {
					case 0: // string result in the next STRING record
						pendingFormula = [2]int{row, col}
					case 1:
						if res[2] != 0 {
							set(row, col, "TRUE")
						} else {
							set(row, col, "FALSE")
						}
					}
				} else {
					set(row, col, formatNumber(math.Float64frombits(le.Uint64(res))))
				}
			}
		case recSTRING:
			if pendingFormula[0] >= 0 {
				set(pendingFormula[0], pendingFormula[1], shortString(d, biff5))
				pendingFormula = [2]int{-1, -1}
			}
		case recBOOLERR:
			if len(d) >= 8 && d[7] == 0 {
				if d[6] != 0 {
					set(int(le.Uint16(d)), int(le.Uint16(d[2:])), "TRUE")
				} else {
					set(int(le.Uint16(d)), int(le.Uint16(d[2:])), "FALSE")
				}
			}
		}
	}
	grid = sparseGrid(cells)
	return sheetName, grid, nil
}

// cp1252High maps bytes 0x80–0x9F of Windows-1252 (the rest match Latin-1).
var cp1252High = [32]rune{
	0x20AC, 0x81, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8D, 0x017D, 0x8F,
	0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x9D, 0x017E, 0x0178,
}

func decodeCP1252(b []byte) string {
	r := make([]rune, len(b))
	for i, c := range b {
		if c >= 0x80 && c < 0xA0 {
			r[i] = cp1252High[c-0x80]
		} else {
			r[i] = rune(c)
		}
	}
	return string(r)
}
