# Ace Bay Studio

The back-room bay aisles at a glance
([download the Windows .exe](https://github.com/codysuter/codysuter/releases/download/ace-bay-studio-windows/AceBayStudio.exe)).

Every OPTI container in the bays as an icon on one screen — spray-painted
number and all — with colored overlays to flag groups of them and a
contents record per OPTI you can fill by CSV import.

## What it does

- **The whole back room on one screen.** 4 bay aisles out of the box,
  each with racking on both sides of the walkway, 3 shelves high ×
  8 OPTIs per shelf (192 bins). All of it is editable in **Layout**:
  rename aisles, add/remove aisles, change shelf counts — the map keeps
  every bin that still has a slot.
- **Labels.** Bins start unlabeled. Click one in **Select** mode and type
  the number that's painted on it. The header tracks how many are done.
- **Overlays** — the core feature. Create a colored overlay ("Christmas",
  "Grills", "Needs processing"…), then click or drag across bins to paint
  it on as a translucent wash. Paint the same bin again to erase. A bin
  can carry several overlays (extra ones show as dots); the eye toggle
  hides an overlay without losing what's painted, so you can flip between
  views. 12 preset colors plus a custom picker.
- **Contents per OPTI.** Each bin holds an item list (name, qty, SKU,
  note) and free-form notes. Add items by hand in the details panel, or
  **Import contents (CSV)** to load a whole spreadsheet at once — rows
  are matched to bins by OPTI number (case-insensitive, leading zeros
  ignored), with a dry-run preview that lists any numbers the map doesn't
  have yet. Choose **Replace** (re-import friendly) or **Append**.
  **CSV template** in the toolbar gives you the exact columns:
  `opti,item,qty,sku,note`.
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
{ version: 1, updatedAt, overlays: [{ id, name, color, visible }],
  aisles: [{ id, name, banks: [{ side: 'left'|'right',
    shelves: [[{ id, label, overlayIds, items: [{ id, name, qty, sku, note }], notes }]] }] }] }
```

`shelves[0]` is the top shelf; bins read left to right. Labels are the
join key for CSV imports, matched loosely (`"07"` ≡ `"7"`, case-insensitive).
