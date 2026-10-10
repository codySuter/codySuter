/* ============================================================
   User-facing version history, shown under Settings → Updates.
   Newest first. Add an entry for every released build and keep the
   language plain — this is read on the sales floor, not by developers.
   ============================================================ */
"use strict";

const CHANGELOG = [
  {
    version: "1.0.0",
    date: "October 2026",
    notes: [
      "Clear Locations: load the location export from Eagle (.xls), type the location codes being reset (for example 12R for the whole right side of aisle 12), and see every SKU and location that will be cleared before anything is saved.",
      "Saves the Eagle import file straight into C:\\3apps\\Temp — SKU plus all six locations, with a ? for each cleared location. Only SKUs that change are included.",
      "Location 2 (system flags like MDONE) and Location 3 (shelf capacity) are never cleared; the app tells you if a code shows up there.",
      "Keeps a list of the import files you've saved, with the codes, SKU count and time.",
      "Updates itself: when a new version is out, a banner offers Update & Restart.",
    ],
  },
];
