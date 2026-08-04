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
    version: "2.4.0",
    date: "August 2026",
    notes: [
      "New: Element sizes sliders in the editor — grow or shrink the photo, name, price, logo, and SKU footer on any sign. The layout re-fits itself automatically, so a bigger photo squeezes the text down instead of covering it, and nothing ever runs off the page.",
      "Slider settings are saved with each sign, so queued signs, batches, and reprints keep your adjustments.",
      "Looking up a new SKU goes back to the automatic layout by default — a “Keep these sizes” toggle under the sliders carries your adjustments over to the next product instead.",
      "New: at launch, saved batches are checked against current store prices. When prices moved, a banner offers to queue just the changed signs for reprint — and updates the batches to the new prices. Turn it off in Settings.",
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
