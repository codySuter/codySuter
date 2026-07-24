# Ace Sign Studio 2.3

One app for every sign in the store
([download the Windows .exe](https://github.com/codysuter/codysuter/releases/download/ace-sign-studio-windows/AceSignStudio.exe)).
Replaces and unifies the three older tools:

| Legacy tool | What it did | Where it lives now |
|---|---|---|
| **Cody's Outdoor Signage Tool v19** (`.exe`, Python/Flask) | SKU → live price/photo → 8.5×11 laminate signs, 9 sign types, 4-up/6-up/bulk | All 9 sign types + bulk add, any size, one queue |
| **SignShop** (`.exe`, Go) | STIHL 5×3 shelf signs w/ specs & barcode, saw-chain finder posters | STIHL Shelf Sign type + Tools section (posters embedded as-is) |
| **Ace Sign Studio 1.0** (`.app`, Swift) | Counter/shelf/full-page price cards, queue, sheet packing | The size system, queue, sheet optimizer & lookup diagnostics |

## What it does

- **13 sign types**, each following the official Ace price point formats
  (brand guidelines pp. 72–74): Regular, Sale, Percent Off, BOGO Free,
  BOGO %, 2-for-$X, Instant Savings (Ace Rewards), Buy 2 Get $X Off,
  Was/Now (This Unit Only), Your Choice, Under $X, Large Text, Text Only.
- **Per-field toggles** on every sign: hide the photo, price, reg price,
  SKU, name, detail line, or the Ace logo — the layout reflows around
  whatever is hidden.
- **STIHL module (shelf sign, datasets, chain-finder posters) is
  currently disabled** — files are retained under `web/data`, `web/tools`
  and `js/*stihl*`; re-enable per the comment in `web/index.html`.
- **Live store pricing**: type a SKU and the name, store-specific price,
  sale price and product photo fill in automatically. acehardware.com is
  behind bot protection that blocks plain HTTP clients (empty page + 401
  on the price API), so lookups drive a **headless instance of the user's
  own Edge/Chrome** — a real browser clears the challenge and authorizes
  the in-page storefront price fetch (`purchaseLocation` 12180 = Snyder's),
  the same approach the original Mac app used with a WKWebView. Falls back
  to a direct HTTP request when a browser can't be launched. Items on sale
  auto-switch to a Sale sign; every lookup keeps a step-by-step diagnostics
  trail (set `ACE_LOOKUP_MODE=http` to force the direct path).
- **Nine physical sizes**: Full Page (11×8.5 / 8.5×11), **Pallet Sign
  Holder** (11×8.5 / 8.5×11 with the legacy 22pt dashed laminate cut
  guide — cut, laminate, and it fits back into an 8.5×11 holder),
  Sign Holder 11×7, Counter 7×5, Card 6×4, Shelf 5×3, Shelf 5.5×3.5 —
  live preview at every size, WYSIWYG with the printed output.
- **Print queue**: add any mix of signs/sizes, bulk-add by pasting SKUs
  (runs of 4+ digits are detected), duplicate/remove, live thumbnails.
  **Click any queued sign to reopen it in the editor** and update it in
  place; every row has a **copies counter** (− ×N +) and ▲▼ reordering.
  Destructive actions (clear, remove, batch load) show an **Undo** toast
  instead of a confirm dialog.
- **Named batches**: save the whole queue under a name ("Spring Grill
  Sale") and load it back any week — great for recurring promos.
- **↻ Prices**: one button re-checks the store price of every queued
  Regular/Sale/Large Text sign, updates them (flipping Regular↔Sale as
  items go on/off sale), and leaves hand-priced signs alone. Queue rows
  show an amber badge when a price was looked up more than 3 days ago.
- **SKU barcodes**: any sign with a SKU can print it as a scannable
  Code 128 barcode (checkbox in the editor) — scan straight from the
  shelf sign at the register.
- **Bulk add reports failures**: SKUs that didn't resolve are listed with
  the reason and a one-click **Retry failed**. Bulk Was/Now signs
  auto-fill the WAS price from today's shelf price and flag any that
  still need a NOW price.
- **Sheet optimizer**: packs the queue onto US Letter sheets to fit as many
  signs per page as possible — shelf-row packing so every cut is a straight
  guillotine cut, 0.375″ margin (Brother MFC-L9160CDN safe), shared cut
  edges, tick guides in the page margins, full-page signs get their own
  sheet. Layout preview shows each sheet before you print.
- **Print All / Save PDF**: one vector PDF (brand Roboto + STIHL Barlow
  embedded), sent straight to the print dialog or saved.
- **Self-update**: on launch the app checks a version manifest on GitHub;
  when a newer build exists it shows an "Update & Restart" banner that
  downloads the new exe, verifies its SHA-256, swaps it in (rename-swap,
  the standard single-binary idiom) and relaunches. Stays a portable
  single file — no installer. Falls back to a manual download link if the
  folder isn't writable. Set `ACE_DEBUG_LOG=<path>` for a launch/update log.
  Settings → Updates adds an on-demand **Check for updates** button and a
  user-facing **version history** (`web/js/changelog.js` — add an entry per
  release).
- **Support & feedback**: a ✉ Support button files a bug report or feature
  request to csuter@snydersace.net. Bug reports auto-attach diagnostics
  (app version, OS, store #, current sign/queue, the last lookup log, and
  recent errors) to speed up troubleshooting. Every report is also saved
  to `%APPDATA%\AceSignStudio\support`. Delivery: SMTP if configured
  (ACE_SMTP_HOST/USER/PASS/FROM[/PORT]), otherwise it opens a prefilled
  email in the user's mail client; a Copy report button is the manual
  fallback.
- Queue, settings and STIHL overrides persist to
  `%APPDATA%\AceSignStudio\state.json` (Windows) so nothing is lost
  between launches.

## Running it

Download
[`AceSignStudio.exe`](https://github.com/codysuter/codysuter/releases/download/ace-sign-studio-windows/AceSignStudio.exe)
— fully standalone, double-click it. It starts a local server on
`127.0.0.1:8347` and opens an app window via Edge/Chrome (default browser
as fallback). Launching it again just refocuses the running copy. Closing
the window shuts it down. The exe is rebuilt and republished by CI
(`.github/workflows/build-sign-windows.yml`) on every push to `main` that
touches this app, after the Go and E2E suites pass.

Flags: `-port N`, `-no-browser`, `-no-exit` (for kiosk/testing).

## Building & testing

```sh
cd ace-sign-studio
./build.sh          # → ../dist/AceSignStudio.exe (windows/amd64)
./build.sh mac      # → ../dist/AceSignStudio-mac-arm64 (Apple Silicon)
./build.sh linux    # → ../dist/AceSignStudio-linux

go test ./...       # Go suite: lookup parsing, disk cache, server hardening
cd e2e && npm install && node run.mjs   # Playwright E2E: builds the real
                    # binary, mocks acehardware.com, drives every flow
```

Requires Go 1.26+. Windows resources (icon/version/DPI manifest) are
pre-generated in `rsrc_windows_*.syso` from `winres/winres.json`
(regenerate with [go-winres](https://github.com/tc-hib/go-winres)). The
app icon comes from the shared family style in
[`../ace-studio-brand/`](../ace-studio-brand/) —
`node ../ace-studio-brand/icons.mjs sign` regenerates it.

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
