# Ace Change Studio

A Windows app for Snyder's Ace Hardware that makes counting drawers easy,
tracks how far off each drawer is over time, and works out the change order
for the change box.

**[Download AceChangeStudio.exe](https://github.com/codysuter/codysuter/releases/download/ace-change-studio-windows/AceChangeStudio.exe)**
— portable, no install (Windows 10/11). The first time, SmartScreen may say
it's an unrecognized app: click **More info → Run anyway**.

## What it does

### Count Drawer
1. Pick the drawer: Upstairs 1–3, Downstairs 1–2, or the swap drawer for
   Upstairs 1 (the swap drawer is counted and compared on its own, with its
   own register report).
2. Pick the cashier and who's counting.
3. Type how many of each bill, coin roll and loose coin is in the drawer.
   Loose coins can be typed as a count *or* a dollar amount (the choice is
   remembered).
4. The right side shows, live:
   - **Leave in the drawer** — exactly $150, drawn as a till tray, as close
     as possible to the usual reset (3 tens, 8 fives, 60 ones, and $20 in
     coin: 50 quarters, 50 dimes, 50 nickels). If the drawer is short on
     something it substitutes from what's there, and it tells you if $150
     can't be made exactly.
   - **Pull for the deposit** — everything else, bill by bill.
5. Type what the register says to pull. **Over/short = pulled − register**,
   flagged green (within $1), yellow ($1–$5) or red (over $5).
6. Save. The drawer tile shows its last result.

### Change Box
Type what's in the box (coin rolls; bills as straps + loose; any $20/$50/$100).
You get:
- **Call in this order** — coins in whole rolls; bills rounded up to half
  straps when the swap allows it, otherwise exact bill counts.
- **Take these bills to the bank** — every big bill, plus 5s/10s that are
  more than 25 over ideal.
- A check that it's an **even swap** — the bills you take equal the order to
  the dollar — and a warning if the box doesn't add up to its ideal total.
- **Copy** the order as text or **Print** an Ace-branded order sheet.

**Smart box layout:** after 3 saved box counts over 14 days, the app works
out how fast each denomination is used and suggests an ideal box (same total,
in whole rolls and half straps) where nothing runs out early. It only
suggests; **Use this layout** applies it (and can be undone).

### History
Net over/short, count totals, average miss, flag counts and the most-off
drawer; an over/short chart per drawer; a month calendar colored by each
day's worst drawer (click a day to list its counts); a by-cashier table; and
the full logs of counts and change-box orders, with details, edit, delete
(with undo), and CSV export.

### Settings
Names, drawers (name, area, note, start amount), the reset mix, flag levels,
the ideal change box (defaults to 20 rolls quarters, 10 dimes, 10 nickels,
4 straps ones, 1 strap fives, 1 strap tens = **$2,170**), bill rounding,
backup files, and **Check for updates** with the version history.

## Updates
Same as Ace Sign Studio: on launch the app checks the version manifest on the
GitHub Release. When a newer build exists it shows an **Update & Restart**
banner that downloads the new exe, verifies its SHA-256, swaps it in, and
relaunches. If the exe's folder isn't writable it offers a manual download.

## Where data lives
`%APPDATA%\AceChangeStudio\state.json` — one file with settings, every drawer
count and every change-box record. Before the first save of each day the
previous file is copied to `backups\state-YYYY-MM-DD.json`; the last 30 are
kept. Settings → Your data can also save or restore a backup file.

## Development

```sh
cd ace-change-studio
go test ./...            # server, state + backups, self-update
node tests/unit.mjs      # the money math (reset plan, even swap, smart layout)
cd e2e && npm install && node run.mjs   # real binary in headless Chromium
./build.sh               # → ../dist/ace-change-studio/AceChangeStudio.exe + version.json
go run . -port=0         # run locally; opens a browser window
```

- `main.go` — serves the embedded UI on 127.0.0.1, state.json + daily backups,
  heartbeat/watchdog. `update.go` — the self-updater (shared design with Ace
  Sign Studio).
- `web/js/cash.js` — all money math, pure functions in integer cents/dollars.
- `web/js/count.js`, `box.js`, `history.js`, `settings.js` — the four tabs.
- Bump `VERSION` + `NOTES` in `build.sh` and add an entry to
  `web/js/changelog.js` for every release. Pushing to `main` builds and
  publishes via `.github/workflows/build-change-studio-windows.yml`.
- Icon: `node ace-studio-brand/icons.mjs change`, then
  `go-winres make --in winres/winres.json` to refresh the exe resources.
