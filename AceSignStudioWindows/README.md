# Ace Sign Studio — Windows

A native Windows app for **Snyder's Ace Hardware (store #12180, Media, PA)** that turns a SKU into a
print-ready shelf sign: type the item's SKU, and it pulls the **store-specific price** and the
**product photo** from acehardware.com and lays out an **Ace-branded 5½ × 3½ in sign** (other sizes
and a Sale format included). This is the Windows counterpart to the macOS app, with the same lookup
and the same brand-compliant output.

---

## Build it into an .exe (one time)

You need **Python 3.10+** on a Windows PC. Get it from
[python.org/downloads](https://www.python.org/downloads/) — during install, check
**"Add python.exe to PATH."**

Then just **double-click `build-exe.bat`.** It sets up an isolated build environment, installs the
dependencies, and packages everything into a single file:

```
dist\AceSignStudio.exe
```

That `.exe` is self-contained — copy it to the Desktop, a shared drive, or a USB stick and
double-click to run on any Windows 10/11 PC. (First launch may take a few seconds as it unpacks.)

Prefer to run without building? Double-click **`run-from-source.bat`.**

## Using it

1. Type an item's **SKU** (or item number, product name, or a pasted acehardware.com product URL) and
   press **Enter** / **Look Up**.
2. The app opens the product on acehardware.com, reads the **name and photo**, and calls Ace's
   store-price API with `purchaseLocation=12180` to get **your store's price** (including the sale
   price when the item is on promotion).
3. Everything lands in editable fields; the **preview updates live**.
4. **Print** (**Ctrl+P**) or **Export PDF** (**Ctrl+E**).

| Action | How |
|---|---|
| Look up | Type SKU / name / URL, press Enter |
| Fix anything | Every field is editable; preview updates live |
| Photo | **Choose…**, **Paste** (Ctrl+V image), or it fills in from the lookup |
| Sale sign | Set **Format → Sale**; fill **Was price** for the REG. strikethrough |
| Print | **Print…** (Ctrl+P) — prints at true size to your default printer |
| PDF | **Export PDF…** (Ctrl+E) — great for a print shop or exact-size output |
| Settings | **File → Settings** — store number, footer line, logo override |

## How the lookup gets past the website's bot protection

acehardware.com uses Akamai bot protection. The app first tries a fast direct request (which is
usually fine from a store's normal internet connection). If the site challenges it, the app
**automatically falls back to Microsoft Edge** (already installed on every Windows 10/11 PC) running
invisibly in the background to establish a trusted session, then retries. Nothing to install — it
uses the Edge that's already there.

If a lookup ever comes back incomplete, open **Help → Diagnostics**, click **Copy All**, and share
that log — it records every step and where each value came from.

## Brand compliance

Follows the Ace Brand Guidelines: **Ace Red PMS 186 C**, the **Roboto** brand font (bundled), the
official **Sale pricepoint** (black SALE tag, white price on a red chip with superscript cents, black
REG. chip), and the official two-line Ace logo (override it in Settings if needed).

## Built to grow

- **Sign sizes** → add one entry to `SIGN_SIZES` in `ace_sign_studio/models.py` (a Custom size is
  already built in).
- **Formats** → the Standard/Sale layouts live in `ace_sign_studio/render.py`.
- The acehardware.com lookup is isolated in `ace_sign_studio/lookup.py` behind one `lookup()` call.

## Project layout

```
AceSignStudioWindows/
├── main.py                     launcher / PyInstaller entry
├── build-exe.bat               double-click to build AceSignStudio.exe
├── run-from-source.bat         run without building
├── ace_sign_studio.spec        PyInstaller build recipe
├── requirements.txt
└── ace_sign_studio/
    ├── app.py                  tkinter GUI
    ├── lookup.py               acehardware.com product + store-price lookup
    ├── render.py               sign rendering, PDF export, Windows printing
    ├── models.py               sizes, formats, price parsing, settings
    └── assets/                 Ace logo + Roboto fonts (bundled into the .exe)
```
