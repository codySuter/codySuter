# Ace Studio — shared app icon system

One icon language for every app in the Ace Studio family (Ace Sign Studio,
Ace Policy Studio, and whatever comes next): instantly recognizable as a
sibling, instantly tellable apart.

## The recipe

Every icon is the **same red tile** holding a **different white subject card**:

| Layer | Spec |
|---|---|
| Tile | Rounded square, 19% corner radius, full bleed |
| Tile fill | Linear gradient 150°: Ace Red `#D40029` → `#C00026` (55%) → Dark Red `#9E0620` — the official brand reds |
| Subject card | White (`#fff`), 6% corner radius, centered — **the app's canvas** |
| Card content | Drawn only in brand inks: Ace Red `#D40029`, near-black `#15181D`, Cool Gray 5 `#BCBEC0` |
| Typography | Roboto Black (embedded at generation time) when the subject needs lettering |

**Identity comes from the card:** its orientation and what's on it.

| App | Card | Content |
|---|---|---|
| **Ace Sign Studio** | Landscape (a shelf sign) | Black `SALE` chip + big red `$9⁹⁹` price |
| **Ace Policy Studio** | Portrait (a document) | Red header bar, title rule, checklist rows |
| *Future app* | Pick the app's canvas shape | One or two bold marks in brand inks, readable at 32 px |

Rules of thumb for a new sibling: keep the tile byte-identical (it comes from
the shared template), give the card a distinct **silhouette** (orientation or
count), and make sure the 16 px render still reads as "white card on red tile".

## Generating

```sh
node ace-studio-brand/icons.mjs            # all apps
node ace-studio-brand/icons.mjs sign       # just Ace Sign Studio
node ace-studio-brand/icons.mjs policy     # just Ace Policy Studio
```

Renders the HTML templates in headless Chromium at every size and writes
straight into each app's icon locations:

- `ace-sign-studio/winres/icon.png` (256) + `web/img/appicon_256.png` —
  after regenerating, refresh the exe resources with
  `go-winres make --in winres/winres.json` from `ace-sign-studio/`
  ([go-winres](https://github.com/tc-hib/go-winres)).
- `ace-policy-studio/build/icon.png` (512) + `build/icon.ico`
  (16–256, PNG-compressed entries) — electron-builder picks these up as-is.
- `ace-studio-brand/previews/*.png` (512) — for eyeballing the family
  side by side.

No npm dependencies: it uses the Playwright Chromium already present in dev
environments/CI and writes the `.ico` container itself.
