# Ace Sign Studio 2.0 — Evaluation & Recommendations

*July 2026. Evaluated by building and running the app (Go 1.26, Linux build), driving the
full UI in a real browser (gallery → editor → queue → sheet packing → PDF export), and
reading every source file. Findings marked **fixed** were corrected on this branch and
re-verified end-to-end.*

---

## Where it stands

The app is in strong shape. The core loop — pick a type, look up a SKU, preview
WYSIWYG, queue, pack onto sheets, print — works and feels fast. Standout strengths:

- **Single-binary architecture holds up.** Go server + embedded UI + app-mode browser
  window is simple, has no install/update story to maintain, and the heartbeat/watchdog
  lifecycle (`main.go:114`) cleanly avoids orphaned processes.
- **One SVG pipeline for everything.** Previews, nav/gallery thumbnails, queue thumbs,
  sheet composition, and the printed PDF all come from the same renderer
  (`render-ace.js:285`), so WYSIWYG is real, not approximate.
- **The sheet optimizer is genuinely good.** Shelf-row packing with shared cut edges,
  rotation trials, margin ticks, and dedicated sheets for page-size signs
  (`layout.js`) — 5 mixed-size signs packed onto 3 sheets correctly in testing.
- **Lookup resilience.** Browser-driven lookup with HTTP fallback, an on-disk image
  cache, and a step-by-step diagnostics trail viewable in-app is a thoughtful design
  for a moving target like acehardware.com's bot protection.
- **State survives** restarts, port changes, and cache clears (server-side
  `state.json` + localStorage fallback).

## Defects found (running the app)

### Fixed on this branch

1. **P0 — The editor's Print and PDF buttons were broken for every sign type.**
   `signToPdf` read `q.size.w`, but the editor passes `{typeId, sizeId, spec}` with no
   `size` object → `Cannot read properties of undefined (reading 'w')` on every click.
   Only the queue's Print All / Save PDF path worked. Fixed in `pdf.js` (accept
   `sizeId` or `size`); verified the button now downloads a correct PDF.

2. **P1 — Every exported/printed PDF was ~5.7 MB**, slowing spooling and filling the
   print server. Two causes, both fixed:
   - All 13 TTFs were registered into every PDF, including 9 Barlow fonts used only by
     the disabled STIHL module (`fonts.js`). Now Roboto-only while STIHL is off.
   - jsPDF was created without `compress: true`, so the Ace logo raster embedded as
     ~5.4 MB of *uncompressed* RGB + alpha per document. Now compressed.
   Result: a 3-sheet export went **5,692 KB → 391 KB (−93 %)**.

3. **P2 — Editor preview overflowed/clipped at narrower window widths** (e.g. a
   1280-px window: preview cut off, Print/PDF buttons unreachable) and never re-scaled
   when the window was resized. Fixed: `minmax(0,1fr)` on the preview grid column
   (`app.css:118`) plus a resize → re-render hook (`app.js`). Verified at 1280×800.

### Open (small, worth doing)

4. **Bulk add doesn't say *which* SKUs failed.** "Added 6 of 9" leaves you diffing a
   40-line paste by hand. Track failures in the bulk loop (`app.js:625`) and list them
   in the badge area with a one-click "retry failed".
5. **Bulk-adding "Was / Now" signs for items that aren't on sale prints "WAS $—".**
   The editor validates the was-price (`app.js:263`) but the bulk path never does.
   Either skip-and-report those SKUs or fall back to a Regular sign.
6. **`onlyDigitsMaybe` is a no-op** — both ternary branches return `t`
   (`app.js:438`). Harmless, but either strip non-digits as the name implies or
   delete it.
7. **Local server trusts any caller.** Fine for a store PC, but two cheap hardening
   wins in `main.go`: reject requests whose `Host` isn't `127.0.0.1:*` (blocks DNS
   rebinding) and require `Content-Type: application/json` on `POST /api/state`
   (blocks cross-site form posts from overwriting the queue).

## Recommended features (ranked by day-to-day value)

1. **Edit a queued sign.** Today a queued item can only be duplicated or removed — a
   typo means rebuild from scratch. Make the queue row clickable to reload it into the
   editor, with "Update" replacing "Add". One prerequisite: keep `spec.hide` on the
   stored spec and apply it at render time instead of destructively blanking fields at
   add time (`app.js:248` `currentRenderSpec`), so toggles survive the round-trip.
2. **Copies counter per queue item.** Printing 12 identical shelf signs for an endcap
   currently means clicking duplicate 11 times. A ± stepper on the queue row (and a
   "copies" field in bulk add) feeds naturally into the packer.
3. **"Refresh prices" on the queue.** The queue persists across days but prices move.
   Store the lookup timestamp in each spec, show a stale badge (e.g. > 3 days), and
   offer one button that re-runs lookups for every queued SKU and flags changes —
   protects against printing last week's price.
4. **Named batches.** Weekly-ad sets and seasonal resets recur. "Save queue as… /
   Load batch" is a small extension of the existing `state.json` (store
   `batches: {name → items}`) and pairs perfectly with #3: load "Spring Grill Sale",
   refresh prices, print.
5. **Undo instead of confirm.** Replace `confirm()` on Clear (and add for row ✕) with
   a 10-second "Queue cleared — Undo" toast. Cheaper than the dialog and actually
   recoverable.
6. **SKU barcodes on price signs.** `barcode.js` (Code 128 SVG, currently
   STIHL-only) is already in the repo — an optional "Barcode" toggle on shelf/counter
   sizes would let staff scan the sign instead of typing the SKU at the register or
   for inventory checks.
7. **Persist the lookup cache to disk.** The 1-hour cache (`lookup.go:79`) dies with
   the process, so every launch re-pays browser startup + page loads for SKUs printed
   every week. Persisting it beside `state.json` (with the same TTL logic, longer for
   name/image, shorter for price) would make repeat batches near-instant and reduce
   bot-protection exposure.
8. **Queue reordering** (drag or ▲▼) — minor, but helps when reviewing a big batch
   against a planogram order.

## Engineering recommendations

- **Add CI like the policy app has.** `build-policy-windows.yml` builds, tests, and
  publishes Ace Policy Studio to a GitHub Release — Ace Sign Studio has nothing, and
  its 14 MB `dist/AceSignStudio.exe` is committed to git (every rebuild permanently
  grows repo history). Mirror the workflow: build on push, publish the exe as a
  Release asset, drop `dist/` from the repo.
- **Add the two cheap test layers the code is already shaped for.**
  - Go: `lookup.go` has `ACE_BASE_URL`/`ACE_BROWSER_PATH` seams for a mock server —
    a table test over JSON-LD/meta/store-API fixtures would lock in the parsing that
    breaks whenever acehardware.com changes.
  - UI: one Playwright smoke test (load → build sign → queue 4 sizes → export → PDF
    is non-trivial and < 1 MB) would have caught defects #1–#3 here. The scripts used
    for this evaluation are a working starting point.
- **When re-enabling STIHL**, remember `PDF_FONTS` in `fonts.js` now gates which
  fonts embed in PDFs — add the Barlow families back there along with the
  `index.html` script tags.

## Verification evidence

| Check | Result |
|---|---|
| `go build` (linux + windows targets) | clean |
| Gallery, 13 types, thumbnails | renders correctly |
| Editor: fields, toggles, size chips, live preview | works |
| Queue: add/duplicate/remove, mixed sizes, sheet previews | works; 5 signs → 3 sheets |
| Editor Print/PDF buttons | **was broken**, fixed, re-verified |
| Queue Save PDF | works; 5.7 MB → 391 KB after fixes |
| Fonts embedded in PDF after fix | RobotoRegular/Medium/Bold/Black only, subset |
| 1280-px window | **was clipped**, fixed, re-verified |
| Console/page errors during all flows | none |
