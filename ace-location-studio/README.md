# Ace Location Studio

A Windows app for Snyder's Ace Hardware that takes the busywork out of
Epicor Eagle location changes. The first tool, **Clear Locations**, turns
the location export for a section being reset (say, aisle 12 going over to
Christmas) into the Eagle import file that clears those locations.

**[Download AceLocationStudio.exe](https://github.com/codysuter/codysuter/releases/download/ace-location-studio-windows/AceLocationStudio.exe)**
— portable, no install (Windows 10/11). The first time, SmartScreen may say
it's an unrecognized app: click **More info → Run anyway**.

## Eagle's six locations

| Slot | What it holds | Cleared by the app? |
|---|---|---|
| Location 1 | Primary shelf location, e.g. `12R03` (aisle 12, right side, panel 3) | **Yes**, when it matches |
| Location 2 | System flag, e.g. `MDONE`, `16END` | **Never** |
| Location 3 | Primary shelf capacity, e.g. `6` | **Never** |
| Locations 4–6 | Overstock, e.g. `USTOR`, `107`, `12R06` | **Yes**, when they match |

Locations are at most 5 characters. In an Eagle import, a `?` tells Eagle
to clear that location.

## Clear Locations

1. **Load the Eagle export.** Drag the `.xls` Eagle exported onto the
   window (or click to choose it). The app reads the SKU, the description,
   and the six **Current** location columns. An `.xlsx` or `.csv` with
   the same columns works too, and so does an import file you saved
   earlier (handy for double-checking one).
2. **Type the codes to clear.** A code clears every location that **starts
   with** it: `12R` clears 12R01–12R09, and `12R03` clears only 12R03.
   Add as many codes as you need (`12R, 14L05` works too). For each code
   you see how many locations and SKUs it hits, plus the exact codes it
   matched. You also get a warning if:
   - a code matches nothing,
   - a code is very short (`1` would also catch `107`, `12R01`, …),
   - a code is already covered by another one (`12R03` when `12R` is on the list),
   - a code shows up in Location 2 or 3, which are left alone.
3. **Check the preview.** You'll see every SKU going into the import, with
   each cleared location shown as **?** next to the crossed-out old code.
   Switch to **All SKUs** to see the untouched rows too, or search for a
   SKU, item or location.
4. **Save for Eagle.** This writes the import file straight into
   **`C:\3apps\Temp`**, named after the codes, e.g.
   `12R LOCCLEAR - Eagle Import.csv`. If a file with that name is already
   there, the app asks before replacing it. **Show in folder** opens File
   Explorer on the file.

### The import file

```
SKU,Location 1,Location 2,Location 3,Location 4,Location 5,Location 6
70013,?,,6,,,
70018,?,,5,USTOR,,
3008391,14L05,,4,?,,
```

- Only SKUs with at least one cleared location are included.
- Every row has **all six** location columns, because that's the map
  Eagle's import expects. Anything not being cleared is written back
  exactly as it is in Eagle today.
- Windows line endings (CRLF), the same as the file the import was set up with.

The **Saved import files** list keeps the last 50 files you saved, with
the codes, how many SKUs and locations, and which export they came from.

## Settings

- **Export folder.** Defaults to `C:\3apps\Temp` and is created if it's
  missing. Change it only if this PC's Eagle picks imports up from
  somewhere else.
- **Check for updates**, plus the version history. When a new version is
  out, a banner offers **Update & Restart**.

Settings and the saved-files list live in
`%APPDATA%\AceLocationStudio\state.json`, with a daily backup in
`backups\`.

## How it's built

Same recipe as Ace Change Studio: one Go executable that embeds the web UI
(`web/`), serves it on `127.0.0.1:8357`, and opens it in an Edge/Chrome app
window. It quits about 90 seconds after the window closes.

- `xls.go`: a small reader for Excel 97–2003 `.xls` files (the OLE2
  compound file plus BIFF8 records), which is what Eagle exports. It
  takes cell text only.
- `eagle.go`: `.xlsx`/`.csv` reading, finding the SKU and location
  columns, and writing the import file (`/api/parse`, `/api/export`).
- `web/js/clear.js`: the clearing rules (which slots, starts-with
  matching, the CSV layout, the file name). These are pure functions,
  shared by the app and the unit tests.

```sh
./build.sh            # Windows exe → ../dist/ace-location-studio/
go test ./...         # .xls reader, column mapping, export writer, server
node tests/unit.mjs   # clearing rules
cd e2e && npm install && node run.mjs   # drives the real app in Chromium
```

The test spreadsheets in `testdata/` are synthetic (made by
`testdata/make_fixtures.py`) and copy the layout of a real Eagle export.
CI (`.github/workflows/build-location-studio-windows.yml`) runs all of the
above, then publishes the exe and `version.json` to the
`ace-location-studio-windows` release, which installed copies update from.
