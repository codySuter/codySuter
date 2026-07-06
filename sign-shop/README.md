# STIHL Sign Shop

Generate print-ready 5″ × 3″ shelf signs for STIHL power tools, matching the
store's sign template exactly — same layout, Barlow typography, and STIHL
orange. Pricing, SKUs, UPC barcodes, and part numbers come straight from the
dealer price file and SKU master listing, never typed by hand.

## Using it

**Windows:** double-click `dist/SignShop.exe` — a single self-contained file
(nothing to install). It opens the app in your default browser and exits by
itself about half a minute after the last app tab is closed. Launching it
again while it's already running just opens another tab. Saved sign edits
and imported pricing live in the browser profile, tied to the app's fixed
local address, so they persist between launches.

Or open `index.html` directly in any modern browser (double-click works — no
server or install needed; fonts are bundled).

1. **Search** by model (`MS 271`), SKU, UPC, or part number — or browse with
   the category chips (chain saws, trimmers, blowers, …).
2. **Pick the product.** The sign preview fills in live with file-accurate
   price, store SKU, UPC-A barcode, and every configuration of that model in
   the "Other Configurations" sidebar.
3. **Adjust if needed** — floor configuration, specs, chain/bar part numbers
   (searchable pickers backed by the real chain/bar lists), which sidebar
   configs to show. Edits save automatically on that computer, per model.
4. **Print / Save PDF.** The page is exactly 5in × 3in (identical geometry to
   the original template PDF). In the print dialog choose the label printer, or
   "Save as PDF".

## Saving signs as files (PDF / PNG)

Every sign exports at print quality. The default size is 5×3in (matching the
template); an **Export size** slider next to the export controls scales the
sign up to 2× (keeping the same 5:3 shape) when you want a bigger sign —
e.g. 1.5× gives a 7.5×4.5in sign. PNGs come out at 300 DPI for whatever size
you pick (5×3in = 1500×900 px, 7.5×4.5in = 2250×1350 px). The size is
remembered between visits.

**One sign:** select a product, set the **Export size**, and use the
**Save this sign: PDF / PNG** buttons under the preview.

**Many signs at once:** build an export **queue**, then export the whole batch
as individual files (no zip):

1. Add signs — hover a search result and click the **+**, open a product and
   click **+ ADD TO QUEUE**, or add an entire category at once from the
   **Add a whole category** dropdown in the queue panel.
2. Click **QUEUE** in the top bar to review, remove items, or clear it.
3. Pick an export format, then click **EXPORT ALL**:
   - **PDF** / **PNG** — each queued sign downloads as its own 5×3in file.
     The first time, the browser may ask permission to download multiple
     files — choose **Allow**.
   - **2-UP PDF** — one combined PDF with two signs per US Letter (8.5×11in)
     page, each with a thin cut-guide border. Print it on any office printer,
     then trim — the easiest way to run a stack of signs at once. The Export
     size slider applies here too, capped so two signs still fit per page.

   The queue is remembered between visits until you clear it.

The top-bar **PRINT / SAVE PDF** button still opens the browser's print dialog
for sending a single sign straight to a label printer.

## Generating every sign as a PNG at once

To produce a PNG of every product's sign in one shot (organized into
per-category folders), run:

```
node tools/render_all_signs.js        # -> dist/signs-png/
```

It drives the app headlessly and captures each sign through the same pipeline
as the in-app PNG export (1500×900 px = 5×3in @300 DPI), from the current
`data/products.js` — one file per model, at its default floor configuration.
The output folder is git-ignored; regenerate it whenever the data changes.

## Cricut Print-then-Cut sheets (one PDF per category)

To produce Cricut-ready sheets — a **multi-page PDF per product category**,
two signs per US Letter page, with the store template's corner registration
marks so the Cricut can scan and cut each sign:

```
node tools/render_all_signs.js          # 1. render the PNGs (if not already)
python3 tools/build_cricut_sheets.py    # 2. -> dist/cricut/<Category>.pdf
```

The layout is measured from the store's `chainsaw_template.pdf`: 8.5×11in
pages, four 1-inch L-bracket registration marks at the corners (reused
verbatim from `tools/cricut/marks/` so they match what the Cricut expects),
and two 5:3 sign slots stacked vertically. Odd categories put the last sign
alone in the top slot. Output PDFs are git-ignored (regenerable); the
registration-mark images and the builder are committed.

## Keeping prices current

When STIHL sends a new *Dealer Price File* CSV, click **UPDATE PRICING…** in
the top bar and choose the file. The app rebuilds its product data in the
browser and remembers it — no code changes needed. The status line under the
search box shows which file the pricing came from, and how many prices
changed. Manual price/SKU/UPC edits are reset on import (so stale numbers
can't hide new pricing); spec edits and part-number picks are kept.
"Revert to bundled data" undoes an import.

Note: dealer cost is never stored or displayed — only customer-facing MSRP.

## Data accuracy

- **Price / UPC / store SKU / part numbers:** from the dealer price file +
  SKU master listing. The bundled dataset (`data/products.js`) was generated
  from the 07/01/2026 exports.
- **Performance specs**: `data/specs_dsm.js` is generated from the 2026
  STIHL Dealer Support Manual V2 by `tools/parse_dsm.py` (currently covers
  the battery and corded-electric sections — 94 models). For battery saws
  the DSM's per-configuration guide-bar and chain-loop part numbers
  (`data/dsm_parts.js`) pre-fill the sidebar, but only where they validate
  against the dealer price file's own bar/chain lists. `data/specs.js`
  holds hand-curated specs for well-known gas models. Anything not covered
  shows "—" until filled in — the colored dot in the search results shows
  spec completeness (green = complete, orange = partial, gray = none).

## Rebuilding the bundled dataset

Only needed if the SKU **master listing** changes (price updates go through
the in-app upload). Place the source files in `tools/source/` as
`Dealer_Price_File.csv` and `STIHL_SKU_Master_Listing.xlsx` (kept out of git —
they contain dealer cost), then:

```
cd tools && python3 build_data.py   # requires: pip install openpyxl
```

The unit-description parsing in `tools/build_data.py` and the in-app CSV
importer in `app.js` mirror each other — change both together.

To extend DSM coverage (e.g. when a new DSM version ships), run
`python3 tools/parse_dsm.py <dsm_text.txt>` with a plain-text extraction of
the manual. DSM text is not committed — it contains confidential dealer
pricing.

To rebuild the Windows executable after any app or data change, run
`tools/build_exe.sh` (requires Go; cross-compiles from any OS). It embeds
the current app + data into `dist/SignShop.exe`.

`vendor/` holds two MIT-licensed libraries, pinned and bundled locally (no
CDN, so the app keeps working offline): jsPDF 2.5.2 (builds each PDF) and
html2canvas 1.4.1 (rasterizes a sign to a canvas for PDF/PNG export). They're
plain vendored files, not an npm dependency tree.

## Chain finder wall posters

`dist/chain-poster-24x36.pdf` is a print-ready 24×36 in. poster that maps
every current saw model + bar length to its factory chain (marketing number,
part number, store SKU), generated from the same verified data by
`tools/build_poster.py`.

`dist/chain-poster-legacy-24x36.pdf` is the companion poster for
discontinued and classic saws (017 through MS 660, older MS/MSA/MSE, E-series
electrics, HT pole pruners — 99 model groups). It comes from the STIHL Bar &
Chain Catalog selection guide, extracted by `tools/parse_catalog.py` into
`data/catalog_fitment.js` and laid out by `tools/build_poster_legacy.py`.
Only chains orderable in the current dealer price file are shown, and for
current models the catalog data is cross-checked against each saw's factory
chain pitch from the DSM. The same fitment data powers the app's
"Fits this saw" chain suggestions.

The launcher serves both posters at `http://localhost:8377/poster.html` and
`/poster-legacy.html` for reprinting after data updates.
