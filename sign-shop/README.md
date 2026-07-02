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

## Chain finder wall poster

`dist/chain-poster-24x36.pdf` is a print-ready 24×36 in. poster that maps
every saw model + bar length to its factory chain (marketing number, part
number, store SKU), generated from the same verified data by
`tools/build_poster.py`. The launcher also serves it at
`http://localhost:8377/poster.html` for reprinting after data updates.
