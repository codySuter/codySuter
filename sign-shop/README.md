# STIHL Sign Shop

Generate print-ready 5″ × 3″ shelf signs for STIHL power tools, matching the
store's sign template exactly — same layout, Barlow typography, and STIHL
orange. Pricing, SKUs, UPC barcodes, and part numbers come straight from the
dealer price file and SKU master listing, never typed by hand.

## Using it

Open `index.html` in any modern browser (double-click works — no server or
install needed; fonts are bundled).

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
- **Performance specs** (`data/specs.js`): pre-filled only where STIHL's
  published figures are well established (MS 250/251/271/291, BR 600, …).
  Everything else shows "—" until filled in — the colored dot in the search
  results shows spec completeness (green = complete, orange = partial,
  gray = none). Add authoritative specs from the STIHL Dealer Support Manual
  to `data/specs.js`, or type them in the app's spec editor.

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
