/* ============================================================
   User-facing version history, shown under Settings → Updates.
   Newest first. Add an entry for every released build and keep the
   language plain — this is read on the sales floor, not by developers.
   ============================================================ */
"use strict";

const CHANGELOG = [
  {
    version: "1.5.0",
    date: "October 2026",
    notes: [
      "The app now opens on a workflow menu. Pick what you're doing, and the Workflows button at the top takes you back any time.",
      "Planogram Change: two guided steps — clear the old locations for the section (Location 1 and overstock 4–6; flags and capacity are never touched), then the new planogram — with Next and Back.",
      "OPTI Clear: clears matching overstock — Locations 4, 5 and 6 only — into \"<codes> OPTICLEAR - Eagle Import.csv\".",
      "Custom Location Change: pick the locations each code searches (L1–L6), then Clear them or Change them to one new location (12R → 14L05 turns every match into 14L05). Saved as \"<codes> LOCCHANGE - Eagle Import.csv\".",
      "Every workflow saves the same six-location Eagle import file, shares the Compass location data, and keeps its own codes, so switching between them doesn't mix them up. The saved-files list tags OPTI and Custom saves.",
    ],
  },
  {
    version: "1.4.0",
    date: "October 2026",
    notes: [
      "Choose which locations each code clears: under every code, tick L1–L6. By default a code clears Location 1 and the overstock locations (4–6) — untick any you want to keep, e.g. 12R on Location 1 only.",
      "Location 2 (flags) and Location 3 (capacity) can now be ticked too when you really mean it; they start unticked and the app warns when they're on.",
      "Matches in locations you didn't tick are listed as left alone, and the preview greys out the columns no code clears.",
      "Get fresh data from Compass: one click starts Compass so its startup export runs, then the new data loads as soon as Compass saves it (log in to Compass when it asks). If Compass is already open, the app asks, then closes it the normal way — so Compass can ask about anything unsaved — and starts it again.",
      "Settings → Compass exports: where Compass is installed (Conductor.exe), with a check that it's found.",
    ],
  },
  {
    version: "1.3.0",
    date: "October 2026",
    notes: [
      "Clear Locations loads your location data by itself: set Compass to save a location export (Item Number, Item Description, Location – Location 6) into a folder every 30 minutes, and the newest one is ready whenever you open the app — no exporting from Eagle by hand.",
      "When Compass saves a newer export, the app switches to it straight away if you haven't typed any codes yet; if you're mid-way through, a banner offers it instead, so nothing changes under you.",
      "Shows when Compass saved the data (\"Saved by Compass 10:30 AM (12 min ago)\") and warns when it's over an hour old, in case the schedule has stopped.",
      "Settings → Compass exports: choose the folder (Cody's Apps\\Epicor Exports by default), turn it on or off, and see the newest export. The app only reads that folder.",
      "Compass exports dropped in by hand work too — the app reads their \"Item Number\" column as the SKU.",
    ],
  },
  {
    version: "1.2.1",
    date: "October 2026",
    notes: [
      "Compass now works with Epicor-hosted Eagle servers, reached over the store's VPN, and with older Compass versions whose encryption (SSL) is too old to use — the app connects without it, the same fallback Margin Master's troubleshooter uses.",
      "The connection test shows the real reason a login fails (wrong password, computer not allowed, blocked after too many tries) instead of an SSL error, and names the Compass version it found.",
      "It spots when the port is the server's remote login (SSH, port 22) rather than Compass, and says to use port 3306.",
      "Remembers the way in that worked, so it doesn't retry failed ones every time — old Compass servers lock a computer out after too many failed tries.",
      "SSL set to \"Required\" now really is: the app never connects without it.",
    ],
  },
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
