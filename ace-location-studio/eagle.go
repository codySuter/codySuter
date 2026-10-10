package main

// Eagle location files: reading an export into SKU rows, and writing the
// import CSV into the export folder.
//
// An Eagle location export has, per location slot, a blank "new" column and
// a "Current" column:
//
//	SKU | Description | Location Codes | Current Location Codes |
//	Location 2 | Current Location 2 | … | Location 6 | Current Location 6
//
// The "Current" columns are what's in Eagle today. A file in the import
// layout (SKU, Location 1 … Location 6) is accepted too, so an import file
// can be re-opened to check it.

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"unicode/utf8"
)

// maxUpload bounds an uploaded export. A whole-store export is a few MB.
const maxUpload = 64 << 20

// readSheet turns an uploaded file into rows of cell text, picking the
// reader from the file's contents (not its extension — Eagle and Excel are
// both loose about those).
func readSheet(name string, data []byte) (sheet string, grid [][]string, err error) {
	switch {
	case bytes.HasPrefix(data, cfbMagic):
		return readXLS(data)
	case bytes.HasPrefix(data, []byte("PK\x03\x04")):
		return readXLSX(data)
	}
	trimmed := bytes.TrimLeft(bytes.TrimPrefix(data, []byte("\xEF\xBB\xBF")), " \t\r\n")
	if bytes.HasPrefix(trimmed, []byte("<")) {
		return "", nil, errors.New("this file is a web page saved with an Excel name, not a real spreadsheet — open it in Excel, Save As \"Excel 97-2003 Workbook (.xls)\", and load that")
	}
	if len(bytes.TrimSpace(trimmed)) == 0 {
		return "", nil, errors.New("the file is empty")
	}
	g, err := readCSV(data)
	return "", g, err
}

func readCSV(data []byte) ([][]string, error) {
	data = bytes.TrimPrefix(data, []byte("\xEF\xBB\xBF"))
	text := string(data)
	if !utf8.Valid(data) {
		text = decodeCP1252(data) // Excel's "CSV" on Windows
	}
	r := csv.NewReader(strings.NewReader(text))
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	rows, err := r.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("couldn't read it as a CSV file: %v", err)
	}
	return rows, nil
}

/* ---------------- .xlsx ---------------- */

func readXLSX(data []byte) (string, [][]string, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", nil, errors.New("couldn't open the .xlsx file — it may be damaged")
	}
	files := map[string]*zip.File{}
	for _, f := range zr.File {
		files[strings.ToLower(f.Name)] = f
	}
	read := func(name string) ([]byte, error) {
		f := files[strings.ToLower(name)]
		if f == nil {
			return nil, os.ErrNotExist
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		defer rc.Close()
		return io.ReadAll(io.LimitReader(rc, 256<<20))
	}

	// First sheet in workbook order, resolved through the relationships.
	var wb struct {
		Sheets []struct {
			Name string `xml:"name,attr"`
			RID  string `xml:"http://schemas.openxmlformats.org/officeDocument/2006/relationships id,attr"`
		} `xml:"sheets>sheet"`
	}
	var rels struct {
		Rels []struct {
			ID     string `xml:"Id,attr"`
			Target string `xml:"Target,attr"`
		} `xml:"Relationship"`
	}
	sheetName, sheetPath := "", "xl/worksheets/sheet1.xml"
	if b, err := read("xl/workbook.xml"); err == nil && xml.Unmarshal(b, &wb) == nil && len(wb.Sheets) > 0 {
		sheetName = wb.Sheets[0].Name
		if b, err := read("xl/_rels/workbook.xml.rels"); err == nil && xml.Unmarshal(b, &rels) == nil {
			for _, r := range rels.Rels {
				if r.ID == wb.Sheets[0].RID {
					t := r.Target
					if strings.HasPrefix(t, "/") {
						sheetPath = strings.TrimPrefix(t, "/")
					} else {
						sheetPath = path.Join("xl", t)
					}
				}
			}
		}
	}

	var shared []string
	if b, err := read("xl/sharedStrings.xml"); err == nil {
		shared, err = xlsxSharedStrings(b)
		if err != nil {
			return "", nil, fmt.Errorf("reading the .xlsx string table: %w", err)
		}
	}
	b, err := read(sheetPath)
	if err != nil {
		return "", nil, errors.New("couldn't find the first worksheet in the .xlsx file")
	}
	grid, err := xlsxSheet(b, shared)
	return sheetName, grid, err
}

// xlsxText collects the text inside an <si> or <is> element, skipping
// phonetic runs.
func xlsxText(d *xml.Decoder, end string) (string, error) {
	var sb strings.Builder
	depthPh := 0
	inT := false
	for {
		tok, err := d.Token()
		if err != nil {
			return "", err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "rPh":
				depthPh++
			case "t":
				inT = true
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "rPh":
				depthPh--
			case "t":
				inT = false
			case end:
				return sb.String(), nil
			}
		case xml.CharData:
			if inT && depthPh == 0 {
				sb.Write(t)
			}
		}
	}
}

func xlsxSharedStrings(b []byte) ([]string, error) {
	d := xml.NewDecoder(bytes.NewReader(b))
	var out []string
	for {
		tok, err := d.Token()
		if err == io.EOF {
			return out, nil
		}
		if err != nil {
			return nil, err
		}
		if se, ok := tok.(xml.StartElement); ok && se.Name.Local == "si" {
			s, err := xlsxText(d, "si")
			if err != nil {
				return nil, err
			}
			out = append(out, s)
		}
	}
}

var cellRefRe = regexp.MustCompile(`^([A-Za-z]+)(\d+)$`)

func xlsxSheet(b []byte, shared []string) ([][]string, error) {
	d := xml.NewDecoder(bytes.NewReader(b))
	cells := map[[2]int]string{}
	row, col := -1, -1
	nextRow := 0
	for {
		tok, err := d.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("reading the .xlsx worksheet: %w", err)
		}
		se, ok := tok.(xml.StartElement)
		if !ok {
			continue
		}
		switch se.Name.Local {
		case "row":
			row = nextRow
			for _, a := range se.Attr {
				if a.Name.Local == "r" {
					if n, err := strconv.Atoi(a.Value); err == nil {
						row = n - 1
					}
				}
			}
			nextRow = row + 1
			col = -1
		case "c":
			typ, ref := "", ""
			for _, a := range se.Attr {
				switch a.Name.Local {
				case "t":
					typ = a.Value
				case "r":
					ref = a.Value
				}
			}
			col++
			if m := cellRefRe.FindStringSubmatch(ref); m != nil {
				col = colIndex(m[1])
				if n, err := strconv.Atoi(m[2]); err == nil {
					row = n - 1
				}
			}
			v, err := xlsxCellValue(d, typ, shared)
			if err != nil {
				return nil, err
			}
			if v != "" && row >= 0 && col >= 0 && row < maxSheetRows && col < maxSheetCols {
				cells[[2]int{row, col}] = v
			}
		}
	}
	return sparseGrid(cells), nil
}

// Excel's own sheet limits; anything past them is a damaged file.
const (
	maxSheetRows = 1 << 20
	maxSheetCols = 1 << 14
)

// sparseGrid turns cell text keyed by (row, col) into rows, each only as
// wide as its last filled cell, so a stray far-off cell can't make the
// grid huge.
func sparseGrid(cells map[[2]int]string) [][]string {
	maxRow := -1
	width := map[int]int{}
	for k := range cells {
		if k[0] > maxRow {
			maxRow = k[0]
		}
		if k[1]+1 > width[k[0]] {
			width[k[0]] = k[1] + 1
		}
	}
	grid := make([][]string, maxRow+1)
	for r, w := range width {
		grid[r] = make([]string, w)
	}
	for k, v := range cells {
		grid[k[0]][k[1]] = v
	}
	return grid
}

func xlsxCellValue(d *xml.Decoder, typ string, shared []string) (string, error) {
	var raw string
	var inline string
	for {
		tok, err := d.Token()
		if err != nil {
			return "", err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "v":
				var s string
				if err := d.DecodeElement(&s, &t); err != nil {
					return "", err
				}
				raw = s
			case "is":
				s, err := xlsxText(d, "is")
				if err != nil {
					return "", err
				}
				inline = s
			}
		case xml.EndElement:
			if t.Name.Local != "c" {
				continue
			}
			switch typ {
			case "s":
				if i, err := strconv.Atoi(strings.TrimSpace(raw)); err == nil && i >= 0 && i < len(shared) {
					return shared[i], nil
				}
				return "", nil
			case "inlineStr":
				return inline, nil
			case "str", "e":
				return raw, nil
			case "b":
				if strings.TrimSpace(raw) == "1" {
					return "TRUE", nil
				}
				return "FALSE", nil
			default:
				if f, err := strconv.ParseFloat(strings.TrimSpace(raw), 64); err == nil {
					return formatNumber(f), nil
				}
				return raw, nil
			}
		}
	}
}

func colIndex(letters string) int {
	n := 0
	for _, c := range strings.ToUpper(letters) {
		n = n*26 + int(c-'A'+1)
	}
	return n - 1
}

/* ---------------- Eagle layout ---------------- */

// EagleRow is one SKU with its six location slots (index 0 = Location 1).
type EagleRow struct {
	SKU  string    `json:"sku"`
	Desc string    `json:"desc"`
	Locs [6]string `json:"locs"`
}

// EagleFile is what the UI gets back after loading an export.
type EagleFile struct {
	Name      string     `json:"name"`
	Sheet     string     `json:"sheet"`
	Layout    string     `json:"layout"` // "export" (Current … columns), "import", or "compass" (Item Number)
	HeaderRow int        `json:"headerRow"`
	Columns   []string   `json:"columns"` // the header text used for SKU, Desc, Loc 1–6
	Rows      []EagleRow `json:"rows"`
	Warnings  []string   `json:"warnings"`
}

var spaceRe = regexp.MustCompile(`\s+`)

// skuHeaders are the headings the SKU column goes by: "SKU" in Eagle's
// export and import layouts, "Item Number" in a Compass export.
var skuHeaders = map[string]bool{"sku": true, "item number": true, "item #": true, "item no": true, "item no.": true}

func normHeader(s string) string {
	return strings.ToLower(strings.TrimSpace(spaceRe.ReplaceAllString(s, " ")))
}

// locHeaders lists the accepted header names for each slot, current-value
// names first.
func locHeaders(slot int) (current, plain []string) {
	if slot == 1 {
		return []string{"current location codes", "current location code", "current location 1", "current location"},
			[]string{"location 1", "location codes", "location code", "location"}
	}
	n := strconv.Itoa(slot)
	return []string{"current location " + n}, []string{"location " + n}
}

// parseEagle finds the header row and maps the SKU, description and six
// location columns.
func parseEagle(name, sheet string, grid [][]string) (*EagleFile, error) {
	hdr := -1
	for r := 0; r < len(grid) && r < 30 && hdr < 0; r++ {
		for _, c := range grid[r] {
			if skuHeaders[normHeader(c)] {
				hdr = r
				break
			}
		}
	}
	if hdr < 0 {
		return nil, errors.New(`couldn't find a "SKU" or "Item Number" column heading in the first 30 rows — is this the Eagle or Compass location export?`)
	}
	heads := map[string]int{}
	for c, h := range grid[hdr] {
		k := normHeader(h)
		if _, dup := heads[k]; !dup && k != "" {
			heads[k] = c
		}
	}
	find := func(names []string) (int, string) {
		for _, n := range names {
			if c, ok := heads[n]; ok {
				return c, grid[hdr][c]
			}
		}
		return -1, ""
	}

	out := &EagleFile{Name: name, Sheet: sheet, HeaderRow: hdr + 1, Warnings: []string{}}
	skuCol := -1
	for _, n := range []string{"sku", "item number", "item #", "item no", "item no."} {
		if c, ok := heads[n]; ok {
			skuCol = c
			break
		}
	}
	descCol, descHead := find([]string{"description", "desc", "item description"})
	out.Columns = append(out.Columns, grid[hdr][skuCol], descHead)

	// Use the "Current …" columns when the file has them; otherwise it's an
	// import-layout file and the plain "Location N" columns hold the values.
	cur1, _ := find([]string{"current location codes", "current location code", "current location 1", "current location"})
	useCurrent := cur1 >= 0
	out.Layout = "import"
	if useCurrent {
		out.Layout = "export"
	} else if normHeader(grid[hdr][skuCol]) != "sku" {
		out.Layout = "compass" // Compass names the SKU column "Item Number"
	}
	var locCols [6]int
	var missing []string
	for slot := 1; slot <= 6; slot++ {
		current, plain := locHeaders(slot)
		names := plain
		if useCurrent {
			names = current
		}
		c, h := find(names)
		if c < 0 {
			if useCurrent {
				missing = append(missing, fmt.Sprintf("Current Location %d", slot))
			} else {
				missing = append(missing, fmt.Sprintf("Location %d", slot))
			}
			continue
		}
		locCols[slot-1] = c
		out.Columns = append(out.Columns, h)
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("the file is missing these columns: %s. All six location columns are needed", strings.Join(missing, ", "))
	}

	cell := func(row []string, c int) string {
		if c < 0 || c >= len(row) {
			return ""
		}
		return strings.TrimSpace(row[c])
	}
	seen := map[string]int{}
	var dups []string
	for r := hdr + 1; r < len(grid); r++ {
		row := grid[r]
		sku := cell(row, skuCol)
		if sku == "" {
			continue
		}
		er := EagleRow{SKU: sku, Desc: cell(row, descCol)}
		for i, c := range locCols {
			er.Locs[i] = cell(row, c)
		}
		if seen[strings.ToUpper(sku)]++; seen[strings.ToUpper(sku)] == 2 {
			dups = append(dups, sku)
		}
		out.Rows = append(out.Rows, er)
	}
	if len(out.Rows) == 0 {
		return nil, errors.New("the file has headings but no SKUs under them")
	}
	if len(dups) > 0 {
		shown := dups
		if len(shown) > 8 {
			shown = shown[:8]
		}
		more := ""
		if len(dups) > len(shown) {
			more = fmt.Sprintf(" and %d more", len(dups)-len(shown))
		}
		out.Warnings = append(out.Warnings, fmt.Sprintf("Some SKUs appear more than once: %s%s. Each copy is kept as-is.", strings.Join(shown, ", "), more))
	}
	return out, nil
}

// handleParse reads an uploaded Eagle file. The body is the raw file; the
// file name comes in X-File-Name (URL-encoded).
func handleParse(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// A raw-bytes body only — a cross-site <form> can't send this type.
	if r.Header.Get("Content-Type") != "application/octet-stream" {
		http.Error(w, "Content-Type must be application/octet-stream", http.StatusUnsupportedMediaType)
		return
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, maxUpload+1))
	if err != nil {
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	if len(data) > maxUpload {
		writeJSONStatus(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "that file is too big to be an Eagle location export"})
		return
	}
	name := r.Header.Get("X-File-Name")
	if un, err := url.PathUnescape(name); err == nil {
		name = un
	}
	sheet, grid, err := readSheet(name, data)
	if err != nil {
		writeJSONStatus(w, http.StatusUnprocessableEntity, map[string]any{"error": err.Error()})
		return
	}
	ef, err := parseEagle(name, sheet, grid)
	if err != nil {
		writeJSONStatus(w, http.StatusUnprocessableEntity, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, ef)
}

/* ---------------- export ---------------- */

// defaultExportDir is where Eagle picks import files up from.
// ACE_EXPORT_DIR overrides it (tests, and PCs set up differently).
func defaultExportDir() string {
	if v := os.Getenv("ACE_EXPORT_DIR"); v != "" {
		return v
	}
	if runtime.GOOS == "windows" {
		return `C:\3apps\Temp`
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "3apps", "Temp")
}

// safeFileName allows the characters the app itself puts in names (codes,
// spaces, dashes, dots, parentheses) and nothing that could leave the folder.
var safeFileName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9 _.,()&+#-]{0,150}\.csv$`)

type exportRequest struct {
	Dir       string `json:"dir"`
	Name      string `json:"name"`
	CSV       string `json:"csv"`
	Overwrite bool   `json:"overwrite"`
}

// handleExport writes an import or label CSV into the export folder (creating the
// folder if needed). It refuses to replace an existing file unless the
// request says to, so the UI can ask first.
func handleExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !requireJSON(w, r) {
		return
	}
	var req exportRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, maxUpload)).Decode(&req); err != nil {
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"error": "bad request: " + err.Error()})
		return
	}
	dir := strings.TrimSpace(req.Dir)
	if dir == "" {
		dir = defaultExportDir()
	}
	if !filepath.IsAbs(dir) {
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"error": "the export folder must be a full path, like C:\\3apps\\Temp"})
		return
	}
	if !safeFileName.MatchString(req.Name) || strings.Contains(req.Name, "..") {
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"error": "that file name isn't allowed — use letters, numbers, spaces and dashes, ending in .csv"})
		return
	}
	if strings.TrimSpace(req.CSV) == "" {
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"error": "the file would be empty"})
		return
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		writeJSONStatus(w, http.StatusInternalServerError, map[string]any{"error": fmt.Sprintf("couldn't create the folder %s: %v", dir, err)})
		return
	}
	dest := filepath.Join(dir, req.Name)
	if _, err := os.Stat(dest); err == nil && !req.Overwrite {
		writeJSONStatus(w, http.StatusConflict, map[string]any{"exists": true, "path": dest})
		return
	}
	if err := writeFileAtomic(dest, []byte(req.CSV)); err != nil {
		writeJSONStatus(w, http.StatusInternalServerError, map[string]any{"error": fmt.Sprintf("couldn't save %s: %v", dest, err)})
		return
	}
	writeJSON(w, map[string]any{"ok": true, "path": dest})
}

// handleReveal opens File Explorer on a saved import file.
func handleReveal(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !requireJSON(w, r) {
		return
	}
	var req struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil || !filepath.IsAbs(req.Path) {
		writeJSONStatus(w, http.StatusBadRequest, map[string]any{"error": "bad path"})
		return
	}
	st, err := os.Stat(req.Path)
	if err != nil {
		writeJSONStatus(w, http.StatusNotFound, map[string]any{"error": "that file isn't there any more"})
		return
	}
	switch runtime.GOOS {
	case "windows":
		if st.IsDir() {
			err = exec.Command("explorer.exe", req.Path).Start()
		} else {
			err = exec.Command("explorer.exe", "/select,", req.Path).Start()
		}
	case "darwin":
		err = exec.Command("open", "-R", req.Path).Start()
	default:
		err = exec.Command("xdg-open", filepath.Dir(req.Path)).Start()
	}
	if err != nil {
		writeJSONStatus(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}
