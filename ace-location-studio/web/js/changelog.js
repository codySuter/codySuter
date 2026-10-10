/* ============================================================
   User-facing version history, shown under Settings → Updates.
   Newest first. Add an entry for every released build and keep the
   language plain — this is read on the sales floor, not by developers.
   ============================================================ */
"use strict";

const CHANGELOG = [
  {
    version: "1.2.0",
    date: "October 2026",
    notes: [
      "Settings → Live data from Compass: connect the app to your Compass data warehouse the same way Margin Master does — read-only, on the store network. Copy Server, Port, Database, Username and Password from Margin Master's Epicor tab.",
      "Save & test checks every step (address, network, port, login, database, inventory table, link speed) and says exactly what to fix when something's wrong.",
      "Explore finds where your SKUs and locations live in Compass: type a SKU and its location that you know and it shows which columns hold them. Copy or save the report.",
      "The password is kept encrypted for your Windows login on that PC and never leaves the app.",
    ],
  },
  {
    version: "1.1.0",
    date: "October 2026",
    notes: [
      "New Planogram: load the planogram PDF from Ace and type the location for each section (12R03, 12R04…). The app reads every SKU, its facings and its REC QTY from the plan's product report.",
      "Take facings away right on the plan's own drawing: click a product, then − / +. Shelf capacity (Location 3) scales down with it — REC QTY 12 at 2 facings becomes 6 at 1 — and taking the last facing away drops the SKU.",
      "Saves the Eagle import (SKU, Location 1, Location 3) and label printer files (facings, SKU) into C:\\3apps\\Temp — one label file per location plus an ALL file when the plan spans more than one.",
      "Remembers your section locations and facing changes for each planogram, so you can close the app and pick up where you left off.",
    ],
  },
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
