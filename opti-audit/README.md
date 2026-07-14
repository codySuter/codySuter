# OptiAudit — Eagle OPTI Location Auditor

A Windows desktop app for auditing numbered OPTI storage containers against **Epicor Eagle** (release 35.1).
It takes a **Compass** export of your items and their location fields, finds every SKU whose
**Location 1, 2, 4, 5 or 6** exactly matches the OPTI number, and generates the **FIL**
(Flexible Inventory Load) file with `?` in exactly those fields — the Eagle convention for
clearing a field. After you rescan the container, it also builds the FIL file that puts the
OPTI number back on the items that are actually in it.

**Location 3 is protected.** It stores shelf capacity, so the app never searches it, never
clears it, and never writes to it. This is enforced in the core logic (a tampered request
refuses to generate a file), not just hidden in the UI.

---

## Why it's safe to trust

This tool prepares files that clear live inventory data, so accuracy is the whole design:

- **Whole-field exact matching only.** OPTI `54` never matches `540`, `154`, `54A`, or `54.0`.
  Values are trimmed and compared case-insensitively (configurable). There is no substring mode.
- **Location 3 is hard-protected** (configurable in Settings, default Location 3). Even a hit
  in Location 3 is only *reported*, never cleared. If the OPTI number is found *only* in a
  protected field, the SKU is flagged for manual review instead of silently skipped.
- **Preview before anything is written.** Every matched SKU is shown in a grid with its
  current locations highlighted; you can untick rows.
- **Type-to-confirm.** Generating a clear file requires re-typing the OPTI number.
- **Audit trail.** Every generated FIL file is saved with a `_audit.txt` (source file SHA-256,
  options, every SKU and the exact fields cleared, before-values) and a `_checklist.csv`
  (the list of SKUs expected in the container — take it with you while scanning).
- **The app never posts anything to Eagle by itself.** You (or your macro) run FIL, and you
  should always verify the FIL preview/proof screen in Eagle before posting.
- The matching/CSV/file-building logic lives in a separate library covered by **80 unit tests**,
  including the exact end-to-end scenario from this store's audit procedure. The code was also
  put through an adversarial multi-reviewer pass focused on ways the wrong data could be cleared.
- A truncated/corrupt export makes loading **fail with an error** rather than silently auditing
  part of the file, and re-add plans are invalidated the moment any input changes — the file you
  generate always corresponds to exactly what is on screen.

---

## Getting the app

**Option A — download the built exe:** every push to this folder runs the
[GitHub Actions workflow](../.github/workflows/opti-audit.yml) on Windows. Open the run,
download the **OptiAudit-win-x64** artifact, and drop `OptiAudit.App.exe` anywhere
(no install, no runtime needed — it is self-contained).

**Option B — build it yourself** with the .NET 8 SDK on Windows:

```
dotnet publish opti-audit/src/OptiAudit.App -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o out
```

(The core library and tests build on any OS; the WinForms app itself needs a Windows build —
Linux distro-packaged .NET SDKs lack the Windows Desktop targets.)

Settings are stored per user in `%APPDATA%\OptiAudit\config.json`.

---

## The workflow

### Step 0 — Export from Compass (once per audit session)

Create/reuse a Compass query on the item/inventory view containing at least:

| Column | Required |
|---|---|
| Item / SKU | yes |
| Description | recommended |
| Location Code 1, 2, 4, 5, 6 | yes — **all of them** |
| Location Code 3 | optional (protected either way) |
| Store | only for multi-store FIL formats |

Run it for **one store** and export/save as **CSV** (if Compass gives you Excel, use
File → Save As → CSV in Excel). The app validates the export and refuses to search if any
searchable location column is missing — a partial export would silently miss locations.

### Step 1 — Load the export (tab 1)

Browse to the CSV. Columns are auto-detected from the headers (`Item`, `LOC 1`,
`Location Code 4`, etc. all work); verify the mapping and fix anything with the drop-downs.
Validation errors/warnings (duplicate SKUs, short rows, …) are listed before you can search.

### Step 2 — Find & clear (tab 2)

1. Enter the OPTI number (e.g. `54`) and press **Search locations 1, 2, 4, 5, 6**.
   - If the same container is ever labeled differently (`054`), search both: `54,054`.
2. Review the grid — matched fields are highlighted, Location 3 is shaded gray. Untick any
   SKU you don't want touched.
3. Click **Generate FIL clear file…**, retype the OPTI number to confirm, and choose where to
   save. You get three files: the FIL CSV (`?` in matched fields), the audit log, and the
   scan checklist.
4. Load the CSV with **FIL** in Eagle (or press **Run FIL step** if you configured a macro —
   see below) and **verify FIL's preview counts match the app's summary before posting.**

### Step 3 — Rescan & re-add (tab 3)

Physically scan every SKU in the OPTI into the scan box (a keyboard-wedge scanner that sends
Enter after each barcode types straight into it). Click **Plan re-add**:

- Items whose location was just cleared get the OPTI back **in the same field**.
- Items newly found in the container get it in the **lowest empty** non-protected field.
- Anything odd (SKU not in the export, no empty field, would overwrite another location)
  is flagged as a conflict/exception instead of being written silently.

Generate the FIL re-add file and load it with FIL the same way.

---

## Running the FIL step automatically

Eagle installations differ, so the app shells out to a command **you** provide in
Settings → *Run FIL step*, with `{file}` replaced by the generated CSV path, e.g.:

```
C:\StoreTools\run-fil.cmd {file}
```

Ways to build that command, in order of reliability:

1. **Manual (recommended until you trust the flow):** leave the command empty. The app shows
   the file path; run FIL in Eagle Browser and load the file yourself.
2. **Eagle macro:** record your FIL sequence (open FIL, load file, preview) with Eagle
   Browser's macro facility on the workstation, then point the command at whatever launches
   that macro on your system.
3. **AutoHotkey:** an AHK script can focus Eagle Browser, open FIL and feed it the path from
   `%1`. Example skeleton in [`docs/fil-automation.md`](docs/fil-automation.md).

However you launch it, **FIL's own preview is your final safety net — always check it before
posting.** The app deliberately stops short of pressing the final button for you.

---

## Repo layout

```
opti-audit/
  src/OptiAudit.Core/    all data logic (CSV, matching, FIL building, audit) — unit tested
  src/OptiAudit.App/     WinForms UI (thin wiring over the core library)
  tests/                 xUnit test suite (80 tests)
  samples/               sample Compass export used by the tests and for a dry run
  docs/                  FIL automation notes
```

Try it risk-free: load `samples/compass_export_sample.csv` and search OPTI `54` — you should
get 4 matches (100200, 100201, 100204, 100206), one protected-only warning (100203, OPTI in
Location 3), and `540` (100202) must **not** match.
