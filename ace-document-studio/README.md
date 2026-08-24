# Ace Document Studio

A Windows desktop app for **Snyder's Ace Hardware (Media, PA)** that designs the
store's documents — **policies, procedures & SOPs, customer postings, memos,
agreements, and checklist sheets** — in the exact look, fonts, and layout of the
store's Policy & Procedures Guide. Drag-and-drop sections, a template gallery, a
live one-page fit meter, revision history, and print-ready PDF & PNG export.
Built to feel like a sibling of [Ace Sign Studio](https://github.com/codysuter/ace-sign-studio):
controls on the left, a live page on the right, and Print / Export one click away.

> Formerly **Ace Policy Studio** — same app, broader scope. On first launch the
> renamed app automatically copies your existing documents over from the old
> `Ace Policy Studio` data folder.

| Download | |
|---|---|
| [**AceDocumentStudio-Setup.exe**](https://github.com/codysuter/codysuter/releases/download/ace-document-studio-windows/AceDocumentStudio-Setup.exe) | **Recommended** — installs in seconds and keeps itself updated automatically |
| [**AceDocumentStudio.exe**](https://github.com/codysuter/codysuter/releases/download/ace-document-studio-windows/AceDocumentStudio.exe) | Portable — no install; updates by re-downloading when the app points one out |

> Both links serve the latest build, published automatically by GitHub Actions
> (see [`.github/workflows/build-document-studio-windows.yml`](../.github/workflows/build-document-studio-windows.yml)).
> On first launch Windows SmartScreen may warn about an unrecognized app (it's
> unsigned) — click **More info → Run anyway** (once).

![The editor](docs/editor.png)

## What's inside

### Writing documents

- **A template gallery.** New Document opens a picker of store document types —
  Policy, Procedure (SOP), Customer posting, Agreement, Memo, Checklist sheet,
  or Blank — each with a live thumbnail and a ready-to-edit outline. **Save as
  template** turns any finished document into a starting point of your own.
- **Your library, pre-loaded.** First launch seeds the three existing store
  policies — Grill Special Orders, STIHL Special Order Inquiries, and Special
  Orders for Pickup — converted 1:1 from the original designs.
- **The exact design language.** Barlow Semi Condensed + IBM Plex Sans are
  bundled (no internet needed), with the numbered red-rule sections, badge
  pills, square bullets, dark callout boxes with brand-yellow highlights, brand
  chips (like the orange STIHL tag), and the 8px accent bar — all at the
  original sizes and spacing.
- **Two kinds of headers.** Numbered sections count themselves automatically;
  plain headers use the same red-rule style with no number — for memos,
  postings, and checklist sheets. Numbered sections keep counting around them.
- **Drag, drop, snap — even above the title.** Grab any block by its grip
  handle; a red line shows where it'll snap. The title section itself is
  draggable too, so a banner image or notice can sit above it.
- **Click anything to edit** — the title included. **Ctrl+B** bold, **Ctrl+I**
  italics, **Ctrl+H** yellow highlight inside a callout bar.
- **Spellcheck, everywhere.** Typos get the red squiggle; right-click for
  suggestions or to add a word to the dictionary.
- **Find & replace** (**Ctrl+F**) across every block, table cell, and list item
  in the document — replacements never touch bold/highlight markup.
- **Smart paste.** Pasting several lines into a list makes one item per line.
  Pasting plain text with nothing selected turns it into blocks — bullet lines
  become bullet lists, `1.` lines become steps, ALL-CAPS or colon lines become
  headers. Great for converting an old Word policy in one paste.
- **Copy blocks between documents.** **Ctrl+C / Ctrl+X / Ctrl+V** on a selected
  block rides the real clipboard, so a callout can move from one document to
  another (or another window).
- **Alignment — per block, per title, or the whole document.** Left / center /
  right on headers, text, badges, lists, callouts, and images; an **Align ·
  everything** setting flips the whole document at once (blocks with their own
  alignment override it), and the title section has its own alignment control.
  The **Space above** stepper opens up or tightens the gap over any block.
- **A leaner title section when you want one.** Empty kicker and subtitle
  lines take no space at all — hover the title and use **+ Kicker** /
  **+ Subtitle** to bring one back.

### Blocks

Section headers (numbered and plain), paragraphs, badge rows, bullet lists,
numbered steps, checklists, dark callouts, **tables** (insert/delete rows &
columns at the focused cell, per-column alignment, drag the red lines to resize
columns), **two-column sections** (great for DO / DON'T), **agreement signature
blocks** in the exact style of the Radio & Scanner Policy Contract, **images**
(drag a file onto the page or paste one; stored inside the document; captions
only take space when they exist), and **page breaks**.

### Page & output

- **One-page focus.** A live meter shows how full the page is; if content
  spills, a dashed "PAGE 2 STARTS" line appears right where the break lands.
- **Multi-page when you mean it.** Page-break blocks print everything below
  them on a new page; multi-page PDFs get automatic "Page x of y" footers.
- **Print & PDF** through Chromium's print engine: Letter paper, 0.4″ margins,
  full-bleed color — identical geometry to the original documents.
- **PNG export** (**Ctrl+Shift+E**) — one crisp 2× image per page, margins
  included, ready to text to someone or send to a print shop.
- **Compile a manual.** Pick documents in the library, order them, and export
  one PDF with a cover page, a table of contents with page numbers, and
  continuous page footers — the Policy & Procedures binder in one click.
- **Metadata footer.** One checkbox adds the strip real policies carry —
  Effective date, Version, Supersedes, Approved by — editable right on the
  page; empty fields stay off the printout.
- **A type-size slider** (90–140%: compact handbook pages through big customer
  postings) and per-document accent color.

### The library

- **Search everything** — the box filters by any text anywhere in a document,
  not just titles.
- **Rename from the card** (the pencil next to the title), duplicate, export,
  and **delete with Undo** — deleted documents go to a trash folder and stay
  restorable for 30 days.
- **An outline panel** in the editor jumps between sections of long documents.

### Never lose work

- **Autosave + undo/redo**, with unsaved edits flushed to disk the moment the
  window closes. Documents are written atomically, so a crash mid-save can't
  corrupt a file.
- **Version history.** The app snapshots each document as you come back and
  edit it; the History panel previews any snapshot and restores it — restoring
  keeps today's state in history too.
- **Automatic backups** of the whole library on every quit (newest 15 kept),
  now restorable from inside the app: **File → Restore from Backup…**
- **Import & export.** Every document exports as a file; Import accepts single
  documents or whole backups. Imported files pass through the same formatting
  allowlist as in-app edits.
- **Sync between store computers** — the same sharing model as Ace Sign
  Studio's batches. **File → Sync Settings…** points every computer at the same
  private GitHub repo with a fine-grained token (Contents read & write on that
  repo only), and the library and saved templates stay merged across all of
  them: newest edit wins per document, deletions carry 60-day tombstones so an
  old copy can't bring a deleted document back — while editing (or Undo) after
  a delete deliberately does. Writes are compare-and-swap guarded, so two
  registers saving at once never tear the sync file; big in-document images are
  downscaled in the pushed copy only, keeping the file under GitHub's limit
  while this computer keeps its full-resolution originals. Version history,
  the trash, and settings stay per-computer. The library footer shows sync
  state at a glance.
- **A shared documents folder** as a simpler alternative — **File → Choose
  Documents Folder…** points the library at any folder, so a network share
  works for registers on the same LAN (last write wins, no merge).
- **Updates.** The installer build updates itself in the background and asks to
  restart when ready. The portable build checks on launch and points at the
  download.

![A finished document](docs/document.png)

## Where things live

- **Documents**: `%APPDATA%\Ace Document Studio\documents\` by default — plain
  JSON files, easy to back up — or any folder you pick via File → Choose
  Documents Folder.
- **Automatic backups**: `%APPDATA%\Ace Document Studio\backups\` (on every
  quit, newest 15 kept) — restore via File → Restore from Backup…
- **Version history**: `%APPDATA%\Ace Document Studio\history\` (up to 40
  snapshots per document).
- **Deleted documents**: `%APPDATA%\Ace Document Studio\trash\` (30 days).
- **Saved templates**: `%APPDATA%\Ace Document Studio\templates\`.
- PDFs and PNGs export wherever you choose — the app remembers the last folder.

## Keyboard shortcuts

Also in the app under **Help → Keyboard Shortcuts**.

| Keys | Action |
|---|---|
| `Ctrl+N` | New document (template picker) |
| `Ctrl+L` | Back to library |
| `Ctrl+E` / `Ctrl+Shift+E` | Export PDF / Export PNG |
| `Ctrl+P` | Print |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `Ctrl+B` / `Ctrl+I` | Bold / italic (in text) |
| `Ctrl+H` | Yellow highlight (in a callout bar) |
| `Ctrl+F` | Find & replace |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / cut / paste the selected block (or paste text as blocks) |
| `Alt+↑` / `Alt+↓` | Move the selected block |
| `Delete` | Remove the selected block |
| `Enter` / `Backspace` | Add / remove list items |

## Building from source

```bash
cd ace-document-studio
npm install
npm run dev:app     # live-reload app (Vite + Electron)
npm run dist:win    # installer + portable exe → release/
```

Other scripts: `npm run dev` (browser-only dev server), `npm run typecheck`,
`npm run build` (renderer), `npm test` (Playwright E2E against the built
renderer), `node scripts/electron-smoke.mjs` (boots the real app and runs a
production `printToPDF`), `npm run icon` (regenerates `build/icon.*`).

> Code signing: builds are unsigned today (hence the one-time SmartScreen
> prompt). electron-builder picks up a certificate automatically via the
> standard `CSC_LINK` / `CSC_KEY_PASSWORD` environment variables in CI if one
> is ever purchased — no config changes needed.

## How it's built

Electron 43 + React 19 + Vite + Tailwind 4, `@dnd-kit` for drag-and-drop,
`zustand` for state, `electron-updater` for installer auto-updates. Documents
render from a small block model through one `PageView` component used
everywhere — the editor, the library thumbnails, the template picker, and the
hidden print/compile windows — so what you see is exactly what prints. CI
builds and tests on a real Windows runner (renderer E2E + an Electron smoke
test that seeds the library and exports a PDF) before every release.
