# Ace Location Studio

A Windows app for Snyder's Ace Hardware that takes the busywork out of
Epicor Eagle location changes during a reset (say, aisle 12 going over to
Christmas):

- **Clear Locations** turns the location data for the section being reset
  into the Eagle import file that clears those locations. The data can load
  by itself from a Compass export that Compass saves on a schedule.
- **New Planogram** reads the planogram PDF from Ace and writes the Eagle
  import that gives every SKU its new Location 1 and shelf capacity, plus
  the label printer files. You can take facings away on the plan's own
  drawing first.

**[Download AceLocationStudio.exe](https://github.com/codysuter/codysuter/releases/download/ace-location-studio-windows/AceLocationStudio.exe)**
— portable, no install (Windows 10/11). The first time, SmartScreen may say
it's an unrecognized app: click **More info → Run anyway**.

## Eagle's six locations

| Slot | What it holds | Cleared by the app? |
|---|---|---|
| Location 1 | Primary shelf location, e.g. `12R03` (aisle 12, right side, panel 3) | **Yes** by default, when it matches |
| Location 2 | System flag, e.g. `MDONE`, `16END` | Only when ticked for a code |
| Location 3 | Primary shelf capacity, e.g. `6` | Only when ticked for a code |
| Locations 4–6 | Overstock, e.g. `USTOR`, `107`, `12R06` | **Yes** by default, when they match |

Each code has its own L1–L6 choice (see Clear Locations, step 2).

Locations are at most 5 characters. In an Eagle import, a `?` tells Eagle
to clear that location.

## Clear Locations

1. **Load the location data.** If Compass saves exports to the watched
   folder (see below), the newest one is already loaded. Otherwise drag
   the `.xls` Eagle exported onto the window (or click to choose it). The
   app reads the SKU, the description, and the six **Current** location
   columns. An `.xlsx` or `.csv` with the same columns works too, and so
   does a Compass export (its **Item Number** column is the SKU) or an
   import file you saved earlier (handy for double-checking one).
2. **Type the codes to clear.** A code clears every location that **starts
   with** it: `12R` clears 12R01–12R09, and `12R03` clears only 12R03.
   Add as many codes as you need (`12R, 14L05` works too). For each code
   you see how many locations and SKUs it hits, plus the exact codes it
   matched. You also get a warning if:
   - a code matches nothing,
   - a code is very short (`1` would also catch `107`, `12R01`, …),
   - a code is already covered by another one (`12R03` when `12R` is on the list),
   - a code matches a location that isn't ticked for it, which is left alone.

   **Pick the locations each code clears.** Under every code is a row of
   toggles, **L1** to **L6**. By default Location 1 (shelf) and Locations
   4–6 (overstock) are ticked. Untick any to keep them (for example `12R`
   on L1 only clears shelf locations and leaves overstock alone). Location
   2 (flags) and Location 3 (capacity) start unticked and can be ticked
   when you really mean it; the app warns when they are. The preview greys
   out the columns no code clears, and the saved-files list notes any code
   that didn't use the default.
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

### Loading Compass exports automatically

Compass can run a saved query on a schedule and save the result to a
folder. Ace Location Studio watches that folder, so the location data is
always ready without exporting anything from Eagle by hand.

1. In Compass, make a **query** of items with **Item Number**, **Item
   Description** and **Location**, **Location 2** … **Location 6**, with no
   filter so it has every item.
2. Make a **schedule** that runs every 30 minutes, and a **task** that runs
   the query on it and saves it (Excel or CSV) **into the watched folder,
   with the same file name every time**.
3. The watched folder is set in **Settings → Compass exports**. It defaults
   to `%USERPROFILE%\Cody's Apps\Epicor Exports`.

Then in Clear Locations:

- The **newest** export in the folder loads when the app opens. The step
  says when Compass saved it, e.g. *Saved by Compass 10:30 AM (12 min ago)*.
- The app looks for a newer one every minute and when the window comes
  back into view. A newer export loads straight away if no codes are
  typed. If you're mid-way through, a **Newer Compass data — Load it**
  banner appears instead, so nothing changes under you. A file you loaded
  by hand is never replaced by itself.
- If the loaded export is **over an hour old**, a warning says Compass may
  have stopped saving new ones.
- **Get fresh data from Compass** starts Compass (`Conductor.exe`, path in
  Settings). With Compass's task also set to run **when Compass starts**,
  it saves a new export as you log in, and the app watches closely (every
  few seconds, for up to 10 minutes) and loads it as soon as it lands,
  even if codes are typed (they stay). If Compass is already open, the app
  asks, then closes it the normal way (so Compass can ask about anything
  unsaved; it's never forced) and starts it again.
- A file still being written (changed in the last few seconds) is left
  until it's finished.

The app only ever reads that folder; nothing in it is changed, moved or
deleted.

## New Planogram

1. **Load the planogram PDF** from Ace (drag it onto the window or click to
   choose it). The app reads the **ACE HARDWARE PRODUCT REPORT** for every
   SKU's facings, REC QTY and segment (each segment is one section, usually
   4 ft), plus the POG ID, title and live date. It also reads the
   "ACE NUMBER" drawing pages, so the drawing can be clicked.
2. **Give each section its location** (Location 1), e.g. `12R03`. Type the
   first one and **Fill the rest** suggests the next panels (`12R04`, …).
   You can change any of them.
3. **Adjust facings on the drawing.** Click a product (or a row in the
   list) and use **−** / **+** (or the − and + keys). Fewer facings scale
   the shelf capacity down, rounding down and never below 1: REC QTY 12 at
   2 facings becomes 6 at 1. Taking the last facing away **drops** the SKU
   from every file. The drawing marks changed items in amber and dropped
   ones in grey. Use **− Fit +** to zoom, and **Cover picture** shows the
   plan's photo page.
4. **Save.** These files go into `C:\3apps\Temp`:

| File | Contents |
|---|---|
| `<POG> NEWLOC - Eagle Import.csv` | `SKU,Location 1,Location 3`, one row per SKU. Location 3 is blank when the plan lists no REC QTY |
| `<POG> LABELS.csv` (one location) | `facings,SKU`, no header row |
| `<POG> LABELS <location>.csv` + `<POG> LABELS ALL.csv` (several locations) | One label file per location, plus one with all of them, so you can print a section at a time or the whole plan |

Section locations and facing changes are remembered per POG ID, so you can
close the app and pick up where you left off (**Start over** clears them).
If a SKU appears in more than one section, it gets its first section's
location, its facings and REC QTY are added together, and the app tells
you.

## Live data from Compass (Settings)

Margin Master doesn't need a file from Eagle: it reads inventory straight
from the store's **Compass data warehouse**, a MySQL copy of the Eagle data.
It's on the store network or, when Epicor hosts Eagle, on Epicor's server,
reached over the store's VPN. In its handbook's words, it connects "directly,
read-only, to the Compass database on your local network". Ace Location
Studio connects the same way, and this is the first step toward skipping
the `.xls` export.

1. In **Margin Master**, open Options → POS / Connections → **Epicor**
   tab, with **Connect via MySQL / Compass** checked, and note the
   **Server, Port, Database, Username and Password**.
2. In Ace Location Studio, go to **Settings → Live data from Compass**,
   enter the same five values, and click **Save & test connection**. Like
   Margin Master's troubleshooter, it runs every check and says what to
   fix: settings, server address, network path (same network, or routed /
   VPN), MySQL port (with the Compass version that answered, or a warning
   that the port is SSH, the server's remote login, rather than MySQL),
   login (with SSL-off / old-password fallbacks, reporting the server's own
   reason when it refuses), database, the inventory (`IN`) table and link
   speed.
3. **Explore.** Compass's table layout isn't published. Type a SKU and its
   Location 1 that you know from Eagle, then click **Explore Compass**. The
   report lists the tables, the `IN` table's columns with a few sample
   rows, any location-like columns with example values, and exactly which
   columns hold that SKU and location. **Copy report** / **Save report…**
   so it can be sent to whoever is setting up the app. The next version
   uses it to read the six locations live.

It only reads: every query is a `SELECT`, and on MySQL 5.6 and later the
session is set to `READ ONLY` too (older versions can't do that). Changes
still go into Eagle through the import files.

Older Compass servers (MySQL 5.1, for example) have SSL too old for modern
encryption, so with SSL on **Use if the server has it** the app connects
without it (the same fallback Margin Master's troubleshooter uses).
**Required** never goes without. The way
in that worked is remembered and tried first next time. Old servers count
each failed attempt against the computer and block it after a handful
(Epicor can lift that with `FLUSH HOSTS`), so the app avoids failing its way
in each time.

The settings live in `compass.json` beside `state.json`. The password is
encrypted with Windows DPAPI for the signed-in Windows user, and the page
never sees it.

If the login is refused with "not allowed to connect", the Eagle server
hasn't approved this PC yet. The handbook says access has to be enabled
on the Eagle server, which Margin Master support or Epicor arranges.

## Settings

- **Export folder.** Defaults to `C:\3apps\Temp` and is created if it's
  missing. Change it only if this PC's Eagle picks imports up from
  somewhere else.
- **Compass exports.** Turns the automatic loading on or off, sets the
  folder Compass saves to, and shows the newest export in it. Also where
  Compass is installed (`Conductor.exe`, normally
  `C:\Program Files (x86)\Epicor\Analytics\Eagle`), for **Get fresh data
  from Compass**.
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
- `watch.go`: the Compass export folder: the newest export in it
  (`/api/watch`) and reading one (`/api/watch/load`).
- `compassapp.go`: starting Compass for **Get fresh data**
  (`/api/compass/app`, `/api/compass/launch`); only `Conductor.exe` can
  be started, and closing it is always the polite kind.
- `web/js/clear.js`: the clearing rules (which slots, starts-with
  matching, the CSV layout, the file name). These are pure functions,
  shared by the app and the unit tests.
- `compass.go`: the Compass connection (settings, DPAPI-protected
  password in `secret_windows.go`, the connection test, Explore), using
  [go-sql-driver/mysql](https://github.com/go-sql-driver/mysql) v1.9.3
  (MPL-2.0). `web/js/compass.js` is its Settings card.
- `web/js/pog.js`: reading a planogram from its PDF text (cover, product
  report columns by position, drawing labels), the facings → capacity
  math, and the import/label files. Pure functions, unit-tested.
- `web/vendor/pdfjs/`: [pdf.js](https://github.com/mozilla/pdf.js)
  5.7.284 (legacy build, Apache-2.0). The app uses it to read and draw
  planogram PDFs, and it's bundled so it works offline.

```sh
./build.sh            # Windows exe → ../dist/ace-location-studio/
go test ./...         # .xls reader, column mapping, export writer, server, Compass, export folder
# live Compass tests: ACE_TEST_MYSQL=user:pass@host:port go test ./...  (an admin login on any MySQL/MariaDB)
# E2E against a live server: load testdata/compass-seed.sql, then
#   ACE_TEST_COMPASS=127.0.0.1:3306:compasstest:mmuser:s3cret-test node e2e/run.mjs
node tests/unit.mjs   # clearing rules
node tests/pog.mjs    # planogram reading, capacity math, label files
cd e2e && npm install && node run.mjs   # drives the real app in Chromium
```

The test spreadsheets in `testdata/` are synthetic (made by
`testdata/make_fixtures.py`) and copy the layout of a real Eagle export.
`testdata/compass-export.xlsx` has the same items laid out like a Compass
export. `testdata/pog-sample.pdf` is a synthetic two-section planogram (made by
`testdata/make_pog_fixture.mjs`) laid out like a real Ace planogram PDF.
CI (`.github/workflows/build-location-studio-windows.yml`) runs all of the
above, then publishes the exe and `version.json` to the
`ace-location-studio-windows` release, which installed copies update from.
