/* ============================================================
   User-facing version history, shown under Settings → Updates.
   Newest first. Add an entry for every released build and keep
   the language plain — this is read on the store floor, not by
   developers. The "Check for updates" banner shows the newer
   version's manifest notes; this list covers what's installed.
   ============================================================ */
"use strict";

const CHANGELOG = [
  {
    version: "3.6.0",
    date: "August 2026",
    notes: [
      "A cleaner, roomier layout. The left sidebar is now a compact list (the home gallery is still the illustrated menu), so the editor and preview get the space.",
      "The editor shows just the everyday fields; the power controls — element sizes, show/hide toggles, barcode & QR, unit — live in one “Fine-tune this sign” section that stays open if you use it.",
      "One size dropdown instead of nine size buttons above the preview.",
      "A simpler print queue: drag signs to reorder them, and each sign has one ⋯ menu for duplicate / add-to-batch / remove. Batches and History moved up to the top bar, Bulk add is a proper window with more room to paste, and the sheet layout previews tuck behind their summary line.",
      "Settings now separates the everyday switches from the set-once setup (store number, printer margin, sync connection, backup) under Advanced.",
    ],
  },
  {
    version: "3.5.0",
    date: "August 2026",
    notes: [
      "The ✉ Support button is gone — if something's wrong, just tell Cody directly.",
      "Printed PDFs now match the preview exactly for spaced-out lettering (SKU digits under barcodes, FINAL SALE, BUY ONE GET ONE and friends) — they used to print slightly narrower than the screen showed.",
      "Savings amounts print exactly as entered: a $7.50 instant savings no longer rounds up to “SAVE $8”.",
      "Cut guides actually print now. The little margin ticks used to sit in the printer's unprintable edge; they've moved just inside it, they only appear where a full straightedge cut is safe, and the dashed sign outlines now obey the Cut guides setting too.",
      "Full-page signs' gray border moved inside the printable area, and signs packed on a shared sheet can no longer spill over a neighbor when a very long product name won't fit.",
      "Sharing batches between computers is safer: two computers adding signs to the same saved batch around the same time both keep their signs, accepted price updates from the launch banner now reach the other computers, and long-deleted batches stop cluttering the sync data.",
      "Steadier under load and a batch of smaller fixes: big queues (100+ signs) redraw much faster, double-clicking “Look Up & Add All” can't add everything twice, a slow lookup can no longer overwrite a sign you've since opened for editing, and installing an update is more robust end to end.",
    ],
  },
  {
    version: "3.4.0",
    date: "August 2026",
    notes: [
      "New: layout presets. Save a favorite Element-sizes arrangement (say, “big photo”) from the new Presets menu and apply it to any sign with one click.",
      "New: backup. Settings → Backup exports everything — queue, batches, history, settings — to a file, and imports it back (with undo). Sync credentials never leave the computer.",
      "Queued signs that duplicate the same SKU at the same size now show a “duplicate” badge, so bulk adds and batch loads can't sneak double prints past you.",
      "Sync stays healthy with photo-heavy batches: custom photos are slimmed down in the shared copy so the store's sync data can never outgrow its storage limit. Your own computer keeps the full-quality photo.",
    ],
  },
  {
    version: "3.3.0",
    date: "August 2026",
    notes: [
      "Bulk add now covers every sign type that works from a SKU — all twelve, grouped like the sidebar. Types that need promo details (percent off, BOGO %, 2-for, instant savings, buy-2-get, your choice) show small inputs that apply to the whole list, and the app won't add signs until they're filled.",
      "The 11×7 Sign Holder size now prints with the same dashed cut line as the Pallet Holder sizes: cut on the line, laminate, and the finished sign actually fits the 11×7 metal holder (cut at exactly 11×7, the laminate edge made it too big).",
      "Every cut line in the app now uses that same dashed style — including the sign outlines on multi-sign sheets.",
      "The 5.5×3.5″ size is now labeled “Magnet Sleeve”.",
    ],
  },
  {
    version: "3.2.0",
    date: "August 2026",
    notes: [
      "New: add signs to an existing batch. The 🗂 button on any queued sign drops it into a saved batch you pick, and each batch in the Batches window has a “＋ Queue” button that adds everything currently in the queue.",
    ],
  },
  {
    version: "3.1.0",
    date: "August 2026",
    notes: [
      "Sync now works out of the box — the store's sync connection is built into the app. On each computer, just click “Turn on” in the banner at launch (or tick the box in Settings). No repos, no tokens, nothing to paste.",
      "The computer's name fills in automatically from Windows; change it in Settings if you want friendlier names like “Front Desk”.",
    ],
  },
  {
    version: "3.0.0",
    date: "August 2026",
    notes: [
      "Ace Sign Studio 3.0: your store computers now sync. Point every PC's Settings → Sync at the same private GitHub repo and saved batches and print history stay identical everywhere — save a batch at the office computer, print it at the service desk.",
      "Deleting a batch on one computer deletes it on all of them; deletions and edits merge safely even when two computers change things at the same time.",
      "Print history shows which computer printed each set (set “This computer's name” in Settings).",
      "The print queue itself stays per-computer on purpose, so two people can build different queues at once — save a queue as a batch to hand it to another PC.",
      "Setup: create a free private repo on github.com (e.g. ace-sign-sync), make a fine-grained token with Contents read & write on just that repo, and paste both into Settings on each computer.",
    ],
  },
  {
    version: "2.7.0",
    date: "August 2026",
    notes: [
      "New: drag any element right on the sign preview to resize it — the photo, name, price, logo, or SKU footer. Same auto-fitting layout as the sliders, now hands-on.",
      "New: QR codes. Tick “Print a QR code” on any sign with a SKU and customers can scan it to see the product on acehardware.com — reviews, details, online ordering. Skipped on shelf sizes, where a QR would be too small to scan.",
      "New: Print history. Every Print All, Save PDF, and single-sign print is remembered (last 25) — open History next to Batches and restore any of them to the queue with one click.",
      "The launch check now also notices when a saved batch's sale has ended, and offers regular-price replacement signs at today's shelf price. The batch keeps the promo sign for next time.",
    ],
  },
  {
    version: "2.6.0",
    date: "August 2026",
    notes: [
      "New: Element sizes sliders in the editor — grow or shrink the photo, name, price, logo, and SKU footer on any sign. The layout re-fits itself automatically, so a bigger photo squeezes the text down instead of covering it, and nothing ever runs off the page.",
      "Slider settings are saved with each sign, so queued signs, batches, and reprints keep your adjustments.",
      "Looking up a new SKU goes back to the automatic layout by default — a “Keep these sizes” toggle under the sliders carries your adjustments over to the next product instead.",
      "New: at launch, saved batches are checked against current store prices. When prices moved, a banner offers to queue just the changed signs for reprint — and updates the batches to the new prices. Turn it off in Settings.",
    ],
  },
  {
    version: "2.5.0",
    date: "July 2026",
    notes: [
      "Ace Sign Studio now checks before you print. If any queued sign has a price that hasn't been looked up in the last few days — or was never looked up at all — it says so and offers to refresh them first. A queue can sit for weeks and a saved batch can be months old, so this is the guard against reloading last season's sale and sending old prices straight to the shelf. You can still choose “Print anyway”.",
      "The built-in updater is stricter about what it will install. It now only accepts an update published in this app's own release, so a bad or unexpected download can't be installed over it.",
    ],
  },
  {
    version: "2.4.1",
    date: "July 2026",
    notes: [
      "Fixed SKU lookups being much slower in 2.4.0 than they were meant to be — slower, in fact, than 2.3.1. The faster lookup method 2.4.0 introduced was silently failing and waiting 15 seconds before falling back to the old slow way, on every single lookup. Looking up an item now takes about a fifth of a second, and “↻ Prices” on a 20-sign queue finishes in a couple of seconds instead of several minutes.",
      "If that faster method ever stops working again, the app now notices after a few tries and goes straight to the reliable method instead of pausing on every lookup.",
    ],
  },
  {
    version: "2.4.0",
    date: "July 2026",
    notes: [
      "Much faster SKU lookups. The app used to load a full acehardware.com page for every item number; it now keeps one signed-in session open and asks for just the price. Looking up a SKU is about a second instead of five, and “↻ Prices” on a 20-sign queue finishes in seconds rather than minutes.",
      "Bulk add and the queue no longer bog down. Adding a long list of SKUs, changing copies, or reordering rows stays smooth on a big queue.",
      "The app starts quicker: it opens straight to the gallery, and the parts only needed for printing load quietly in the background.",
      "Printing a big queue no longer looks frozen — the “Sheet 3 of 8…” progress now actually updates while the PDF builds.",
      "Typing a SKU and pressing Enter no longer looks the same item up twice.",
      "Photos you drag in are resized before they are saved, so a big phone photo can't bloat your queue or lose it on restart.",
      "The STIHL shelf signs and saw-chain finder, switched off since 2.3, have been removed. The download is about 2.5 MB smaller.",
    ],
  },
  {
    version: "2.3.1",
    date: "July 2026",
    notes: [
      "Fixed: the app could quietly shut down while its window was minimized — after that, every button failed with “Failed to fetch”. It now stays alive, and if the background app ever really does stop, a clear red banner says to relaunch it.",
      "Fixed: the dollar sign printed too high on Regular price signs. The $ and cents now sit level with the top of the price digits on every sign type.",
      "Fixed: if the product-lookup browser failed to start once, lookups stayed degraded until the app was restarted. It now retries after a couple of minutes and reports the real reason.",
      "Faster, safer exports: PDF fonts load at startup instead of at print time.",
      "New: “Check for updates” button and this version history, in Settings.",
    ],
  },
  {
    version: "2.3.0",
    date: "July 2026",
    notes: [
      "The 2.1 and 2.2 lines come together: edit signs right in the queue, print multiple copies, set sale dates for a whole batch, refresh prices in one click, and barcoded SKUs.",
      "PDF exports are ~93% smaller, and the editor's Print/PDF buttons work again.",
      "Layout fixes for narrow windows; hardened local server; lookup cache persists between launches.",
      "The app is now built and tested automatically, and updates download from its official release page.",
    ],
  },
  {
    version: "2.2.0",
    date: "July 2026",
    notes: [
      "New: ✉ Support button — file a bug report or feature request from inside the app; diagnostics are attached automatically.",
    ],
  },
  {
    version: "2.1.1",
    date: "July 2026",
    notes: [
      "Fixed: product photos were missing from exported and printed PDFs.",
    ],
  },
  {
    version: "2.1.0",
    date: "July 2026",
    notes: [
      "New: the app updates itself — when a new version is published, an “Update & Restart” banner appears at launch.",
      "Fixed: SKU lookups work again behind acehardware.com's bot protection by driving a real Edge/Chrome session.",
      "New: Pallet Sign Holder sizes with the laminate cut guide.",
      "New: Final Sale sign type with “*No returns” fine print.",
      "New: show/hide toggles for every element on a sign (photo, price, SKU, logo, …).",
    ],
  },
  {
    version: "2.0.0",
    date: "July 2026",
    notes: [
      "First release of Ace Sign Studio 2.0 — one app for every sign in the store, replacing the Outdoor Signage Tool, SignShop, and Ace Sign Studio 1.0.",
      "13 Ace price-point sign types, nine physical sizes, live store pricing, print queue with sheet optimizer, and one-click Print All / Save PDF.",
    ],
  },
];
