# Ace Layout Studio

Top-down store blueprint editor for planning shelving layouts at Snyder's
Ace Hardware. Zero dependencies, no build step — open
`web/index.html` in any modern browser (double-click works; no server
needed).

## What it does

- **Top-down blueprint view** of the sales floor on a 1-foot grid
  (heavier lines every 4'), with pan (scroll / space-drag / touch-drag)
  and zoom (Ctrl+scroll, pinch, or toolbar).
- **Fixture palette**: 4' shelving (48"), 3' shelving (36"), 3' endcaps
  (36"), walls, and generic fixture blocks (checkouts, pallets, displays).
  Drag one onto the floor, or click it and stamp repeatedly — handy for
  laying out a whole gondola run of 4' sections.
- **Tool strip** (V / H / L / D / E / X): **Select** moves and
  box-selects, **Pan** scrolls the floor, **Label** types a location code
  with one click per unit, **Copy** drags a duplicate off any unit,
  **Extend** presses on a panel and drags along the aisle to stamp out
  flush matching panels (with a live ghost preview and count), and
  **Erase** removes units on click or drag-across. Esc returns to Select.
  The Label tool also drags to auto-number a run — see below.
- **Snap placement**: everything snaps to a 1" grid and to the edges and
  centers of nearby units, so sections butt flush into runs and endcaps
  seat square against them. Hold **Alt** to move freely.
- **Location codes**: double-click any unit (or press Enter with it
  selected) and type its code — it's drawn on the unit, rotated to match.
- **Auto-numbering**: type one code, then with the Label tool press on
  that unit and drag along the run — every unit the drag crosses gets the
  next code in sequence (`01R01` → `01R02`, `01R03`…), previewed live in
  red before you release. Zero padding is preserved (`A09` → `A10`), and a
  trailing enumerator letter steps too (`BAY-C` → `BAY-D`) while ordinary
  words are left alone.
- **Per-label rotation & sizing**: turn any label 90° at a time with
  **Shift+R** (or ⟲ Turn) and resize its text with **[** / **]** — set per
  unit, applied across the whole selection at once, and carried through
  PNG/print export.
- **Adjustable to the inch**: width and depth are editable per-inch in the
  inspector (width has quick 4'/3' presets), and every unit rotates in 90°
  steps.
- **Measurements to the inch**: select a unit and red dimension lines show
  the exact gap to its neighbors on all four sides; the same live
  measurements appear while dragging. **Click a gap label and type a
  distance** (`42`, `42"`, or `3' 6"`) to set an aisle exactly. Arrow keys
  nudge 1" (Shift+arrows = 12").
- **Multi-select** with box-drag or Shift-click, group move with snapping,
  align tools, duplicate, undo/redo.
- **Multiple layouts** autosaved in the browser (localStorage), plus JSON
  export/import for backup or moving between machines, PNG export, and
  printing.
- **Printing** renders the plan as inline vector SVG into a hidden print
  sheet that the print stylesheet reveals, so output is sharp at any size
  and letterboxes onto whatever paper and orientation the printer is set
  to. A plain browser **Ctrl+P** produces the same page (a `beforeprint`
  hook rebuilds the sheet first).
- **Saving from a sandboxed page**: when the app is embedded in a frame
  (the shared web version), browsers block automatic downloads and
  `print()` outright and tell the page nothing. Every save detects this
  and opens a fallback dialog with a preview, a real download button, an
  "open in new tab" link, and — for JSON — the raw text with a Copy
  button, so nothing is ever silently lost.

## Files

| File | Purpose |
|---|---|
| `web/index.html` | App shell, palette/inspector/help markup |
| `web/css/app.css` | Ace-branded styling (brand palette, Roboto stack) |
| `web/js/app.js` | Editor: state, snapping, measuring, rendering, persistence |
| `layouts/media-pa.layout.json` | Snyder's Ace (Media, PA) floor extracted from the official Ace fixture plan (12/19/2022) — import via layout menu ⋯ → Import JSON |

## Bundled layout: Media PA fixture plan

`layouts/media-pa.layout.json` was machine-extracted from the vector
linework and per-section labels of the AutoCAD-plotted
`12180_MEDIA_PA_l01_FINAL_FIXTURE_PLAN_12192022.pdf` (1.5 pt = 1",
origin at the building's outer NW corner), then verified tile-by-tile
against the drawing. It contains 368 units: 312 shelving panels (one per
gondola/wall section side, depth = drawn base-deck footprint), 13
endcaps snapped to their drawn boxes, 39 labeled fixture blocks
(checkouts, STIHL, grill fences, displays…), and the 4 building walls.
Location codes are intentionally blank on shelving — add your own with
the Label tool.

All world coordinates are in **inches**; `view.scale` is screen pixels per
inch. Units are axis-aligned rectangles (`x, y, w, d, rot`), where `rot`
90/270 swaps the footprint. Layouts live under the localStorage key
`ace-layout-studio:v1`.
