# Ace Sign Studio 2.0

One app for every sign in the store. Replaces and unifies the three older tools:

| Legacy tool | What it did | Where it lives now |
|---|---|---|
| **Cody's Outdoor Signage Tool v19** (`.exe`, Python/Flask) | SKU → live price/photo → 8.5×11 laminate signs, 9 sign types, 4-up/6-up/bulk | All 9 sign types + bulk add, any size, one queue |
| **SignShop** (`.exe`, Go) | STIHL 5×3 shelf signs w/ specs & barcode, saw-chain finder posters | STIHL Shelf Sign type + Tools section (posters embedded as-is) |
| **Ace Sign Studio 1.0** (`.app`, Swift) | Counter/shelf/full-page price cards, queue, sheet packing | The size system, queue, sheet optimizer & lookup diagnostics |

## What it does

- **13 sign types**, each following the official Ace price point formats
  (brand guidelines pp. 72–74): Regular, Sale, Percent Off, BOGO Free,
  BOGO %, 2-for-$X, Instant Savings (Ace Rewards), Buy 2 Get $X Off,
  Your Choice, Under $X, Large Text, Text Only — plus the **STIHL shelf
  sign** (specs grid, UPC-A/EAN-13 barcode, other-configurations panel).
- **Live store pricing**: type a SKU and the name, store-specific price
  (Mozu storefront API, `purchaseLocation` 12180 = Snyder's), sale price
  and product photo fill in automatically. Items on sale auto-switch to a
  Sale sign. Every lookup keeps a step-by-step diagnostics trail.
- **Seven physical sizes**: Full Page (11×8.5 / 8.5×11), Sign Holder 11×7,
  Counter 7×5, Card 6×4, Shelf 5×3, Shelf 5.5×3.5 — live preview at every
  size, WYSIWYG with the printed output (same SVG → same PDF).
- **Print queue**: add any mix of signs/sizes, bulk-add by pasting SKUs
  (runs of 4+ digits are detected), duplicate/remove, live thumbnails.
- **Sheet optimizer**: packs the queue onto US Letter sheets to fit as many
  signs per page as possible — shelf-row packing so every cut is a straight
  guillotine cut, 0.375″ margin (Brother MFC-L9160CDN safe), shared cut
  edges, tick guides in the page margins, full-page signs get their own
  sheet. Layout preview shows each sheet before you print.
- **Print All / Save PDF**: one vector PDF (brand Roboto + STIHL Barlow
  embedded), sent straight to the print dialog or saved.
- **STIHL dealer price file import** (CSV with `STIHL Material Number`,
  `Material Description`, `MSRP` [+ `UPC`, `ACE SKU`]): updates prices,
  UPCs and SKUs in place. Note: brand-new models not in the bundled
  dataset are skipped (the old full-dataset rebuild was not ported).
- **Saw Chain Finder posters** (current + older saws, 24×36) preserved
  verbatim under Tools.
- Queue, settings and STIHL overrides persist to
  `%APPDATA%\AceSignStudio\state.json` (Windows) so nothing is lost
  between launches.

## Running it

`dist/AceSignStudio.exe` is fully standalone — double-click it. It starts a
local server on `127.0.0.1:8347` and opens an app window via Edge/Chrome
(default browser as fallback). Launching it again just refocuses the
running copy. Closing the window shuts it down.

Flags: `-port N`, `-no-browser`, `-no-exit` (for kiosk/testing).

## Building

```sh
cd ace-sign-studio
./build.sh          # → ../dist/AceSignStudio.exe (windows/amd64)
./build.sh mac      # → ../dist/AceSignStudio-mac-arm64 (Apple Silicon)
./build.sh linux    # → ../dist/AceSignStudio-linux
```

Requires Go 1.22+. Windows resources (icon/version/DPI manifest) are
pre-generated in `rsrc_windows_*.syso` from `winres/winres.json`
(regenerate with [go-winres](https://github.com/tc-hib/go-winres)).

## Layout

```
main.go, lookup.go     Go server: embedded UI, acehardware.com lookup,
                       image proxy/cache, state persistence, app window
web/index.html         Shell: nav, gallery, editors, queue rail
web/js/render-ace.js   Ace sign renderers (brand price point formats)
web/js/render-stihl.js STIHL 5×3 sign (vector port of SignShop design)
web/js/layout.js       Sheet packer (shelf rows, rotation, cut guides)
web/js/pdf.js          SVG → vector PDF (jsPDF + svg2pdf, embedded TTFs)
web/js/signtypes.js    Sign type registry (fields, sizes, samples)
web/data/              STIHL datasets carried over from SignShop
web/tools/             Saw Chain Finder posters (as-is)
web/fonts/             Roboto (Ace brand) + Barlow (STIHL) TTF/WOFF2
```
