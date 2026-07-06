#!/usr/bin/env python3
"""Build Cricut Print-then-Cut sheets: one multi-page PDF per product
category, two signs per US Letter page, with the corner registration marks
from the store's template so the Cricut can scan and cut each sign.

Layout is measured from the uploaded template (chainsaw_template.pdf):
  - Page: 8.5 x 11 in (US Letter)
  - Four registration marks (1in L-brackets) at the corners — reused verbatim
    from tools/cricut/marks/ so they match what the Cricut expects.
  - Two sign slots (each 5:3, matching the 5x3in template geometry), stacked.

Input signs come from dist/signs-png/<Category>/*.png (run
tools/render_all_signs.js first). Output: dist/cricut/<Category>.pdf.

    python3 tools/build_cricut_sheets.py

Requires PyMuPDF (pip install pymupdf).
"""
import sys
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit("PyMuPDF required: pip install pymupdf")

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
MARKS = HERE / "cricut" / "marks"
SIGNS = ROOT / "dist" / "signs-png"
OUT = ROOT / "dist" / "cricut"

# geometry (inches), measured from the template
PT = 72.0
MARK_RECTS = {  # crop-image placement rects, matching the originals exactly
    "tl": (0.49, 0.957, 1.527, 1.993),
    "tr": (6.96, 0.957, 7.997, 1.993),
    "bl": (0.49, 8.993, 1.527, 10.03),
    "br": (6.96, 8.993, 7.997, 10.03),
}
SLOTS = [  # top sign, bottom sign
    (0.832, 1.303, 7.647, 5.397),
    (0.832, 5.603, 7.647, 9.697),
]


def rect(t):
    return fitz.Rect(t[0] * PT, t[1] * PT, t[2] * PT, t[3] * PT)


def build_category(name, pngs, out_pdf):
    doc = fitz.open()
    for i in range(0, len(pngs), 2):
        page = doc.new_page(width=8.5 * PT, height=11 * PT)
        for k, r in MARK_RECTS.items():
            page.insert_image(rect(r), filename=str(MARKS / f"mark_{k}.png"))
        for slot, png in zip(SLOTS, pngs[i:i + 2]):
            page.insert_image(rect(slot), filename=str(png))
    doc.save(str(out_pdf), deflate=True)
    return len(doc)


def main():
    for k in ("tl", "tr", "bl", "br"):
        if not (MARKS / f"mark_{k}.png").exists():
            sys.exit(f"missing registration mark: {MARKS / f'mark_{k}.png'}")
    if not SIGNS.exists():
        sys.exit(f"no signs at {SIGNS} — run tools/render_all_signs.js first")

    OUT.mkdir(parents=True, exist_ok=True)
    cats = sorted(d for d in SIGNS.iterdir() if d.is_dir())
    total_pages = total_signs = 0
    for cat in cats:
        pngs = sorted(cat.glob("*.png"))
        if not pngs:
            continue
        out_pdf = OUT / f"{cat.name}.pdf"
        pages = build_category(cat.name, pngs, out_pdf)
        total_pages += pages
        total_signs += len(pngs)
        print(f"  {cat.name}: {len(pngs)} signs -> {pages} pages  ({out_pdf.name})")
    print(f"Done: {len(cats)} category PDFs, {total_signs} signs on "
          f"{total_pages} pages -> {OUT}")


if __name__ == "__main__":
    main()
