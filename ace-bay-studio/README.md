# Ace Bay Studio

The whole store's storage at a glance
([download the Windows .exe](https://github.com/codysuter/codysuter/releases/download/ace-bay-studio-windows/AceBayStudio.exe)).

Every OPTI container in the back-room bays — and every sales-floor aisle
location — as an icon on one screen, with colored overlays to flag groups
of them, per-location contents fed by CSV import (Epicor Compass exports
work as-is), and a built-in red→green wash showing how old each
location's Date Last Physical is.

## What it does

- **The whole back room on one screen.** 4 bay aisles out of the box,
  each with racking on both sides of the walkway, 3 shelves high ×
  8 OPTIs per shelf (192 bins). All of it is editable in **Layout**:
  rename aisles, add/remove aisles, change shelf counts — the map keeps
  every bin that still has a slot.
- **The sales floor too.** A second tab with one tile per aisle location
  code (1–21 seeded; add/remove/rename in Layout to match what Eagle's
  location field uses). Tiles get the same overlays, contents, imports
  and search as the OPTIs.
- **Labels.** Bins start unlabeled. Click one in **Select** mode and type
  the number that's painted on it. The header tracks how many are done.
- **Overlays** — the core feature. Create a colored overlay ("Christmas",
  "Grills", "Needs processing"…), then click or drag across bins to paint
  it on as a translucent wash. Paint the same bin again to erase. A bin
  can carry several overlays (extra ones show as dots); the eye toggle
  hides an overlay without losing what's painted, so you can flip between
  views. 12 preset colors plus a custom picker.
- **Contents per location.** Each bin/tile holds an item list (name,
  qty, SKU, Date Last Physical, note) and free-form notes. Add items by
  hand in the details panel, or **Import contents (CSV)** to load a
  whole spreadsheet at once — rows are matched by location number
  (case-insensitive, leading zeros ignored), scoped to the back room,
  the sales floor, or both, with a dry-run preview that lists any
  numbers the map doesn't have yet. Choose **Replace** (re-import
  friendly) or **Append**. **CSV template** in the toolbar gives you the
  exact columns: `opti,item,qty,sku,last_physical,note`.
- **Epicor Compass exports work unmodified.** Build an inventory query
  in Compass (against Eagle), include the location field plus whatever
  else you want, export CSV, import it — the usual Compass/Eagle headers
  (`Location`, `Item Description`, `QOH`, `SKU`, `UPC`, `Date Last
  Physical`…) are recognized automatically, and dates in `MM/DD/YYYY`,
  `M/D/YY` or ISO form are all understood. Schedule the query in Compass
  and re-import with **Replace** whenever you want the map current.
- **"How old is the data?"** — a built-in overlay preset at the top of
  the Overlays panel. Turn it on and every location with a Date Last
  Physical washes from green (recently counted) through amber to red
  (stale), driven by its **oldest** item's count date. Both ends of the
  scale are editable (default: green ≤ 60 days, red ≥ 365), and the
  panel totals how many locations are fresh / aging / stale. Locations
  with no dated items keep their manual overlay colors.
- **Search** finds an OPTI by number or by what's inside it — everything
  else dims so the match jumps out.
- **Safe by default.** The map saves itself on every change (one JSON
  file in the app's data folder), an automatic rotating backup is written
  on every quit, and **Back up / Restore** in the toolbar moves the whole
  map as a single file — including to another PC.

## Development

```bash
npm install
npm run dev        # renderer only, http://localhost:5174
npm run dev:app    # renderer + Electron shell
npm run typecheck
npm test           # Playwright renderer E2E (builds not required; uses vite preview)
npm run dist:win   # portable AceBayStudio.exe into release/
npm run icon       # regenerate build/icon.* from ace-studio-brand
```

CI (`.github/workflows/build-bay-studio-windows.yml`) runs the E2E suite
and an Electron smoke test on a Windows runner, then publishes
`AceBayStudio.exe` (plus `version.txt` for the in-app update check) to the
`ace-bay-studio-windows` release tag on every push to `main` that touches
this folder.

## Data model (for future imports/integrations)

One JSON document (`map.json` in the app's user-data folder):

```
{ version: 1, updatedAt,
  overlays: [{ id, name, color, visible }],
  freshness: { enabled, greenDays, redDays },
  aisles: [{ id, name, banks: [{ side: 'left'|'right', shelves: [[Bin]] }] }],
  floor: [Bin] }                      // sales-floor location tiles

Bin = { id, label, overlayIds, notes,
        items: [{ id, name, qty, sku, note, lastPhysical }] }
```

`shelves[0]` is the top shelf; bins read left to right. Labels are the
join key for CSV imports, matched loosely (`"07"` ≡ `"7"`, case-insensitive).
`lastPhysical` is ISO (`YYYY-MM-DD`) when the imported date was
recognized, otherwise kept raw; the freshness preset uses each
location's oldest parseable date.
