# Ace Sign Studio

A native macOS app for **Snyder's Ace Hardware (store #12180, Media, PA)** that turns a SKU into a
print-ready shelf sign in seconds:

1. Type an item's SKU and press **Look Up**.
2. The app finds the product on acehardware.com — with your store's context loaded — and fills in
   the **name, price, and product photo**.
3. A live preview shows the sign at true size: **5½ × 3½ in** by default (your sign-holder size),
   Ace-branded in the corner.
4. **Print** it (single, or many per sheet with cut marks) or **Export a PDF**.

Everything the lookup fills in stays editable, so you can fix a price, shorten a name, or paste your
own photo before printing. It's 100% native SwiftUI — no web app, no Electron, no server.

---

## Building it (one time)

Requires macOS 13 Ventura or newer.

**Option A — Terminal (no Xcode app needed):**

```bash
cd AceSignStudio
./Scripts/build-app.sh
```

- If macOS offers to install the *Command Line Developer Tools*, click **Install**, let it finish,
  then run the command again.
- When it says `✅ Done`, drag **Ace Sign Studio.app** into `/Applications`. That's it — from then
  on it's a normal double-clickable Mac app.

**Option B — Xcode:** open `AceSignStudio/Package.swift` in Xcode and press **Run** (⌘R).

## Using it

| Action | How |
|---|---|
| Look up an item | Type the SKU (the item number from the shelf tag / acehardware.com URL), press Return |
| Verify the price | Click **Open Product Page** to see the item on acehardware.com, or pick from the "prices found on the page" chips |
| Fix anything | Every field on the left is editable; the preview updates live |
| Change the photo | **Choose…**, **Paste** (⌘V from a copied image), or drag an image onto the preview |
| Sale signs | Switch **Format** to *Sale* and fill in the *Was price* for a strikethrough + SALE flash |
| Print | ⌘P — pick paper (Letter by default); turn on *Fit as many signs as possible* to gang-run a sheet with cut marks |
| Exact-size output | Set **Paper** to *Exact Sign Size* (useful for PDF exports sent to a print shop) |

## Settings (⌘,)

- **Store number** — preloaded with `12180`; the lookup loads
  [your store's page](https://www.acehardware.com/store-details/12180) first so pricing follows
  your store where the site provides it.
- **Store line** — the footer text printed on signs.
- **Logo** — the official two-line Ace Hardware logo (from the retailer brand kit) is built in and
  used on every sign and the app icon, with the brand's exact red (#E31837) throughout. Settings
  can override it with any PNG; the vector originals live in `AceSignStudio/BrandAssets/`.

## When a lookup doesn't fill everything in

The app loads acehardware.com pages in an embedded WebKit view — the same engine as Safari — so
the site's bot checks pass as they do for a normal visitor, then reads product data from several
redundant places (structured product data, embedded page JSON, meta tags). Retail sites change,
and they sometimes rate-limit — so:

- Open **Diagnostics** (toolbar) to see every step of the last lookup: what was requested, what
  answered, and where each value came from.
- **Copy All** in Diagnostics and share that log to get the parser updated when the site changes.
- Worst case, the app still works fully manually: type the name/price and paste a photo.
- Double-check store-specific sale prices with **Open Product Page** — the website is the source of
  truth, and the price field is always editable.

## Built to grow

This is set up so new signage needs slot in cleanly:

- **New sign sizes** → add one line to `SignSize.presets` in `Sources/AceSignStudio/Models.swift`
  (a "Custom…" size with any dimensions is already built in).
- **New formats** (clearance, bin tags, QR signs…) → add a case to `SignLayoutKind` and a layout
  view in `Views/SignLayouts.swift`; the preview, printer, and PDF exporter pick it up automatically.
- **New paper/imposition options** → `PaperOption` in `Models.swift`; multi-up math is generic in
  `Rendering/Rendering.swift`.
- The lookup lives in `Lookup/` behind one function (`AceLookupService.lookup`) so the data source
  can be upgraded (or swapped) without touching the UI.

## Project layout

```
AceSignStudio/
├── Package.swift               Swift package (open in Xcode, or `swift build`)
├── BrandAssets/                official Ace Hardware logo (PNGs + vector EPS originals)
├── Scripts/
│   ├── build-app.sh            builds "Ace Sign Studio.app" + icon
│   └── generate-icon.swift     renders the app icon from the brand logo
└── Sources/AceSignStudio/
    ├── AceSignStudioApp.swift  app entry, menu commands
    ├── AppState.swift          all UI state + actions
    ├── Models.swift            sizes, formats, paper, preferences, price parsing
    ├── Lookup/                 acehardware.com lookup + HTML/JSON parsers + diagnostics
    ├── Views/                  main window, preview, sign layouts, settings, diagnostics
    └── Rendering/              exact-size print & PDF output, multi-up sheets, cut marks
```
