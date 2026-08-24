# Ace Floor Studio

The Media PA sales floor at a glance
([download the Windows .exe](https://github.com/codysuter/codysuter/releases/download/ace-floor-studio-windows/AceFloorStudio.exe)).

Every fixture from the store's printed fixture plan — all 340 inventory
locations, walls and all — drawn as one interactive map, heat-colored
green → red from a plain Epicor Compass export. The launch question it
answers: **"how current are our physical counts, bay by bay?"** — and a
dropdown of other heatmaps to run over the same import.

## What it does

- **The whole floor plan on one screen.** Back wall (BW), all thirteen
  aisles with their L/R faces, endcaps (EC), side walls (STW/BBW), paint
  (PP), impulse and queue lines (IM), the ST gondola, grilling (BB +
  GRILL DISPLAY), registers, bait cooler, color chips — transcribed from
  the 12/19/2022 fixture plan. Pan with the mouse, zoom with the wheel,
  click a bay for its contents.
- **One import, many heatmaps.** Feed it a Compass export (.csv or
  .xlsx). Columns are auto-detected — SKU, description, location(s),
  QOH, cost, retail, units sold, and the three "date last …" columns —
  and every guess is editable before anything is applied. Metrics whose
  column isn't in the export show as locked in the picker.
- **The heatmap catalog:**

  | Heatmap | Reads | Needs |
  |---|---|---|
  | **Last physical count** (default) | days since each SKU was counted — oldest / average / newest per bay | date last physical |
  | Last sale (dead stock) | days since anything in the bay sold | date last sale |
  | Last receipt | days since product arrived | date last receipt |
  | Never-counted SKUs | % of the bay with no count on record | date last physical |
  | Out-of-stock SKUs | % of the bay at zero or negative on-hand | QOH |
  | Negative on-hand SKUs | % below zero — count-accuracy red flag | QOH |
  | No-sale SKUs | % with zero movement | units sold |
  | SKUs per location | assortment density | — |
  | Units on hand | total units | QOH |
  | Retail / Cost value | on-hand × price, per bay | QOH + retail/cost |
  | Units sold | where the traffic is | units sold |

- **Honest colors.** Age/percent maps run green → brand yellow → gold →
  Ace red with editable thresholds (defaults: green ≤ 30 days, red ≥
  365); a hatched deep red marks *never counted*, neutral gray marks
  *no SKUs in the import*. Magnitude maps use a light→dark sequential
  red scaled to the floor's 95th percentile. A one-click
  **colorblind-friendly** toggle swaps in a validated blue → red ramp,
  and "Print values on the map" puts the number on every bay.
- **Locations that don't quite match still land.** `13r-5a` → `13R05`,
  `EC4` → `EC04`-style padding fixes, aisle-first endcaps (`04EC`),
  shelf suffixes, and multi-code cells (`BW05; EC03`) all resolve; codes
  that truly aren't on the plan (receiving, outbuildings) are listed,
  with row counts, instead of silently dropped. Full item-file exports
  are welcome — a 109k-row, 19 MB Eagle .xlsx parses in seconds, and
  only the SKUs that land on the plan are kept in the save file.
- **Work the worst first.** The side panel ranks the 15 most urgent
  bays for the current heatmap; click one to open its SKU list, sorted
  oldest-count-first with per-SKU freshness dots. Search finds a SKU,
  item name, or location code and dims everything else.
- **Safe by default.** The import and settings save themselves (one JSON
  file in the app's data folder), an automatic rotating backup is written
  on every quit, and **Back up / Restore** moves everything as a single
  file — including to another PC. **Load sample data** demos the whole
  catalog without a real export.

## Getting the export out of Compass

Any Compass view that exports one row per SKU works. Include at least
**SKU** and a **location** column; add **Date of Last Physical
Inventory** for the count-currency map, and QOH / cost / retail /
units-sold / date-last-sale / date-last-receipt to unlock the rest of
the catalog. Export as CSV or XLSX (old binary .xls is not supported —
re-save it), then **Import Compass export…** in the app.

## Development

```bash
npm install
npm run dev        # renderer only, http://localhost:5175
npm run dev:app    # renderer + Electron shell
npm run typecheck
npm test           # Playwright renderer E2E (uses vite preview)
npm run sample     # regenerate sample/compass-sample.csv from the plan
npm run dist:win   # portable AceFloorStudio.exe into release/
npm run icon       # regenerate build/icon.* from ace-studio-brand
```

CI (`.github/workflows/build-floor-studio-windows.yml`) runs the E2E
suite and an Electron smoke test on a Windows runner, then publishes
`AceFloorStudio.exe` (plus `version.txt` for the in-app update check) to
the `ace-floor-studio-windows` release tag on every push to `main` that
touches this folder.

## The floor plan is code

`src/model/floorplan.ts` holds every fixture as plan-space geometry
(2000×1590 units) with the exact location codes Eagle uses — plus the
walls, vestibule, entrance, and display tables as decor. Move a bay or
add a fixture there and the map, import matching, and heatmaps all pick
it up; the Playwright suite pins the total at 340 locations. Rows are
matched to fixtures case-insensitively with padding and suffix
tolerance (`13r5a` ≡ `13R05A` ≡ `13R05`), and a SKU repeated for the
same bay keeps its freshest physical date.

## Data model (for future imports/integrations)

One JSON document (`floor.json` in the app's user-data folder):

```
{ version: 1, updatedAt,
  settings: { metricId, ageMode: 'oldest'|'average'|'newest',
    ramp: 'classic'|'cvd', showValues, thresholds: { [metricId]: { lo, hi } } },
  data: { fileName, importedAt, rowCount, totalSkus, unlocatedRows,
    unmatched: [{ code, rows }],
    skus: [{ sku, desc, locs: [fixtureId], qoh, cost, retail, sold,
             datePhys, dateSale, dateReceipt }] } }
```

`skus` holds only records that resolved to at least one plan location;
`totalSkus` remembers how many the export contained overall. Dates are
epoch ms at UTC midnight; `null` means never/blank in the export.
