# Encounter Board — a DM's combat dashboard

Build, display, and **run** D&D monsters, NPCs, and adversaries as live tiles.
Each character is a card showing its portrait, stats, HP, and moves. The board
auto-fits the space — and you can make the important villains bigger so a boss
commands two grid cells while a mob of goblins stays compact.

Everything is **local-first**: your data lives in your browser (IndexedDB), works
offline at the table, and never leaves your machine. Export a JSON backup any
time. The storage layer is a single swappable interface, so cloud sync can be
added later without touching the UI.

## Features

- **Adaptive tile board.** Tiles resize to fill the screen via a CSS auto-fit
  grid. Per-tile size (S / M / L) — Large bosses span 2×2 for their extra
  complexity.
- **Two ways to build a character, fast:**
  - **Import from the 5e SRD** — search 334 official monsters (CC-licensed) and
    drop them in with full stats, actions, and traits pre-filled. Add several at
    once (e.g. 3 goblins, auto-numbered).
  - **Manual + templates** — Monster / Boss / Allied NPC / Neutral NPC / PC
    starting points, then edit everything in a full form.
- **Live combat tools:**
  - **HP & damage tracking** — apply damage/healing on the tile; temp HP is
    absorbed first; the HP bar shifts green → amber → red and downed creatures
    grey out.
  - **Initiative & turn order** — roll initiative for the whole board, start an
    encounter, and step through turns with a highlighted active combatant, a
    round counter, and a clickable turn-order strip.
  - **Status conditions** — tag tiles with the 5e conditions (icons + optional
    round timers that tick down on the creature's turn).
- **Factions** — enemy / ally / neutral, each with its own accent color
  (red / blue / amber) so the board reads at a glance.
- **Folders** — file saved characters into colored folders in the sidebar; add
  them to the board (or spawn extra copies) with one click.

## Tech stack

| Layer | Choice |
|------|--------|
| App | React 18 + TypeScript + Vite |
| State | Zustand |
| Persistence | IndexedDB via `idb` (behind a swappable `Store` interface) |
| Styling | Tailwind CSS v4 |
| Icons | lucide-react |
| Data | 5e SRD monsters & conditions (5e-bits/5e-database, CC-BY-4.0 / OGL) |

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # typecheck + production build to dist/
npm run preview    # serve the production build
```

## How it's organized

```
src/
  types.ts              # the domain model (Character, Folder, Encounter…)
  data/                 # bundled SRD bestiary + conditions
  lib/                  # dnd math, SRD loader/search, templates, backup, helpers
  store/
    db.ts               # Store interface + IndexedDB implementation (swap point)
    useStore.ts         # Zustand store, wired to persistence
  components/           # Sidebar, TopBar, Board, CharacterCard, editors, dialogs
```

The board shows every character with `onBoard: true`. The sidebar is your
library — characters organized into folders. The same character record holds its
live state (HP, conditions, initiative), so "saving its current state into a
folder" is just filing it.

## Data & licensing

Monster and condition data come from the open-source
[5e-bits/5e-database](https://github.com/5e-bits/5e-database) project, derived
from the D&D 5e SRD under the OGL / CC-BY-4.0. Only SRD content is included.
