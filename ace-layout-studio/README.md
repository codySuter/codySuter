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
- **Snap placement**: everything snaps to a 1" grid and to the edges and
  centers of nearby units, so sections butt flush into runs and endcaps
  seat square against them. Hold **Alt** to move freely.
- **Location codes**: double-click any unit (or press Enter with it
  selected) and type its code — it's drawn on the unit, rotated to match.
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

## Files

| File | Purpose |
|---|---|
| `web/index.html` | App shell, palette/inspector/help markup |
| `web/css/app.css` | Ace-branded styling (brand palette, Roboto stack) |
| `web/js/app.js` | Editor: state, snapping, measuring, rendering, persistence |

All world coordinates are in **inches**; `view.scale` is screen pixels per
inch. Units are axis-aligned rectangles (`x, y, w, d, rot`), where `rot`
90/270 swaps the footprint. Layouts live under the localStorage key
`ace-layout-studio:v1`.
