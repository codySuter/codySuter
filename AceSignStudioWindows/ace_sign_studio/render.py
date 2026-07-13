"""Sign rendering, PDF export, and Windows printing for Ace Sign Studio.

Draws a sign to a Pillow image at an exact physical size (300 DPI), following
the Ace Brand Guidelines: Roboto type, the primary palette at 100%, the
official Sale pricepoint (black SALE tag, white price on an Ace-red chip with
superscript cents, black REG. chip). One renderer feeds the on-screen preview,
the PDF export, and the printer, so what you see is what prints.
"""
from __future__ import annotations

import os
import sys
from typing import Optional, Tuple

from PIL import Image, ImageDraw, ImageFont

from .models import (ACE_RED, ACE_COOL_GRAY, ACE_HAIRLINE, BLACK, WHITE,
                     SignSpec, price_parts)

DPI = 300


# ---------------------------------------------------------------------------
# Asset loading (works from source and from a PyInstaller onefile bundle)
# ---------------------------------------------------------------------------
def _asset_dir() -> str:
    base = getattr(sys, "_MEIPASS", None)  # PyInstaller unpack dir
    if base:
        return os.path.join(base, "assets")
    return os.path.join(os.path.dirname(__file__), "assets")


_FONT_CACHE = {}


def _font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    size = max(1, int(round(size)))
    key = (weight, size)
    if key in _FONT_CACHE:
        return _FONT_CACHE[key]
    path = os.path.join(_asset_dir(), f"Roboto-{weight}.ttf")
    try:
        font = ImageFont.truetype(path, size)
    except OSError:
        font = ImageFont.load_default()
    _FONT_CACHE[key] = font
    return font


_LOGO_CACHE = {}


def _load_logo(custom_path: str = "") -> Optional[Image.Image]:
    key = custom_path or "__builtin__"
    if key in _LOGO_CACHE:
        return _LOGO_CACHE[key]
    path = custom_path or os.path.join(_asset_dir(), "ace-hardware-2line-color.png")
    img = None
    try:
        img = Image.open(path).convert("RGBA")
    except OSError:
        img = None
    _LOGO_CACHE[key] = img
    return img


# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------
def _text_size(draw, text, font):
    l, t, r, b = draw.textbbox((0, 0), text, font=font)
    return r - l, b - t


def _fit_font(draw, text, weight, start_size, max_width, min_size=6):
    size = start_size
    while size > min_size:
        f = _font(weight, size)
        if _text_size(draw, text, f)[0] <= max_width:
            return f
        size -= 2
    return _font(weight, min_size)


def _draw_text(draw, xy, text, font, fill, anchor=None):
    draw.text(xy, text, font=font, fill=fill, anchor=anchor)


# ---------------------------------------------------------------------------
# Main render
# ---------------------------------------------------------------------------
def render_sign(spec: SignSpec, scale: float = 1.0, preview: bool = False) -> Image.Image:
    """Render the sign to an RGB image. `scale` multiplies the 300-DPI base
    (use <1 for a fast preview)."""
    w_in, h_in = spec.size_inches()
    px_w = max(1, int(round(w_in * DPI * scale)))
    px_h = max(1, int(round(h_in * DPI * scale)))
    img = Image.new("RGB", (px_w, px_h), WHITE)
    draw = ImageDraw.Draw(img)

    # `u` scales every dimension to the sign's short side (matches macOS app).
    u = min(px_w, px_h) / 252.0
    pad = 14 * u
    sale = spec.layout == "Sale"

    if spec.is_wide:
        _layout_wide(draw, img, spec, px_w, px_h, u, pad, sale)
    else:
        _layout_tall(draw, img, spec, px_w, px_h, u, pad, sale)

    if sale:
        bw = max(2, int(4 * u))
        draw.rectangle([bw // 2, bw // 2, px_w - 1 - bw // 2, px_h - 1 - bw // 2],
                       outline=ACE_RED, width=bw)
    return img


def _place_logo(img, spec, x, y, u):
    logo = _load_logo(getattr(spec, "_logo_path", "") or "")
    if logo is None:
        return 0.0, 56 * u
    ratio = logo.width / logo.height
    logo_h = 56 * u
    logo_w = min(logo_h * ratio, 150 * u)
    placed = logo.resize((max(1, int(logo_w)), max(1, int(logo_h))), Image.LANCZOS)
    img.paste(placed, (int(x), int(y)), placed)
    return logo_w, logo_h


def _header_text(draw, spec, x, y, max_w, u, lines):
    """Draw title (+ detail line). Returns the y just below the block."""
    bottom = y
    if spec.product_name:
        bottom = _draw_wrapped_title(draw, spec.product_name, x, y, max_w, 20 * u, lines)
    if spec.detail_line:
        f = _fit_font(draw, spec.detail_line, "Medium", int(11.5 * u), max_w)
        _draw_text(draw, (x, bottom + 2 * u), spec.detail_line, f, ACE_COOL_GRAY)
        bottom += 2 * u + _text_size(draw, spec.detail_line, f)[1]
    return bottom


def _layout_wide(draw, img, spec, px_w, px_h, u, pad, sale):
    y = pad
    logo_w, logo_h = _place_logo(img, spec, pad, y, u)
    title_x = pad + (logo_w + 12 * u if logo_w else 0)
    _header_text(draw, spec, title_x, y, px_w - pad - title_x, u, lines=2)

    body_top = y + max(logo_h, 52 * u) + 6 * u
    body_bottom = px_h - pad - 26 * u
    band_w = (px_w - 2 * pad) * 0.44
    photo_right = px_w - pad - band_w - 12 * u
    if spec.image is not None:
        _paste_photo(img, spec.image, (pad, body_top, photo_right, body_bottom))
    price_cx = photo_right + 12 * u + band_w / 2
    _draw_price_block(draw, spec, price_cx, body_top, band_w, body_bottom - body_top, u, sale)
    _draw_footer(draw, spec, pad, px_w, px_h - pad, u)


def _layout_tall(draw, img, spec, px_w, px_h, u, pad, sale):
    y = pad
    logo_w, logo_h = _place_logo(img, spec, pad, y, u)
    title_bottom = _header_text(draw, spec, pad, y + logo_h + 6 * u,
                                px_w - 2 * pad, u, lines=3)
    footer_top = px_h - pad - 26 * u
    price_h = 100 * u
    price_top = footer_top - price_h
    body_top = title_bottom + 8 * u
    if spec.image is not None and price_top - 8 * u > body_top:
        _paste_photo(img, spec.image, (pad, body_top, px_w - pad, price_top - 8 * u))
    _draw_price_block(draw, spec, px_w / 2, price_top, px_w - 2 * pad, price_h, u, sale)
    _draw_footer(draw, spec, pad, px_w, px_h - pad, u)


def _draw_wrapped_title(draw, text, x, y, max_w, size, lines):
    """Draw a wrapped, auto-shrinking title. Returns the y below the last line."""
    size = int(size)
    for _ in range(8):
        f = _font("Bold", size)
        wrapped = _wrap(draw, text, f, max_w, lines)
        if wrapped is not None:
            line_h = size * 1.05
            for i, ln in enumerate(wrapped):
                _draw_text(draw, (x, y + i * line_h), ln, f, BLACK)
            return y + line_h * len(wrapped)
        size -= 2
    f = _font("Bold", max(6, size))
    _draw_text(draw, (x, y), text[:40], f, BLACK)
    return y + max(6, size) * 1.05


def _wrap(draw, text, font, max_w, max_lines):
    words = text.split()
    lines, cur = [], ""
    for word in words:
        trial = (cur + " " + word).strip()
        if _text_size(draw, trial, font)[0] <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
            if len(lines) >= max_lines:
                return None
    if cur:
        lines.append(cur)
    return lines if len(lines) <= max_lines else None


def _paste_photo(img, photo, area):
    x0, y0, x1, y1 = [int(v) for v in area]
    box_w, box_h = max(1, x1 - x0), max(1, y1 - y0)
    p = photo.convert("RGBA")
    ratio = min(box_w / p.width, box_h / p.height)
    nw, nh = max(1, int(p.width * ratio)), max(1, int(p.height * ratio))
    resized = p.resize((nw, nh), Image.LANCZOS)
    px = x0 + (box_w - nw) // 2
    py = y0 + (box_h - nh) // 2
    img.paste(resized, (px, py), resized)


def _price_fit(draw, parts, raw, u, avail_w, avail_h, sale, has_was, has_unit):
    """Scale factor so the whole price stack fits both the width and height of
    its band."""
    if parts:
        dollars, cents = parts
        dsize = 68 if sale else 84
        big = _font("Black", int(dsize * u))
        sign = _font("Black", int((26 if sale else 28) * u))
        cent = _font("Black", int((26 if sale else 30) * u))
        w_nat = (_text_size(draw, "$", sign)[0] + _text_size(draw, dollars, big)[0]
                 + _text_size(draw, cents, cent)[0] + 6 * u + (20 * u if sale else 0))
    elif raw.strip():
        f = _font("Black", int((34 if sale else 40) * u))
        w_nat = _text_size(draw, raw, f)[0] + (20 * u if sale else 0)
    else:
        return 1.0

    if sale:
        h_nat = (22 + 6 + 80 + (6 + 18 if has_was else 0)) * u
    else:
        h_nat = (92 + (3 + 16 if has_was else 0) + (3 + 16 if has_unit else 0)) * u

    width_fit = avail_w / w_nat if w_nat > 0 else 1.0
    height_fit = avail_h / h_nat if h_nat > 0 else 1.0
    return max(0.2, min(1.0, width_fit, height_fit))


def _sale_tag(draw, cx, y, u, fit):
    tag_f = _font("Black", int(15 * u * fit))
    tw, th = _text_size(draw, "SALE", tag_f)
    h = th + 5 * u * fit
    draw.rectangle([cx - tw / 2 - 8 * u * fit, y, cx + tw / 2 + 8 * u * fit, y + h], fill=BLACK)
    _draw_text(draw, (cx, y + h / 2), "SALE", tag_f, WHITE, anchor="mm")
    return h


def _draw_price_block(draw, spec, center_x, top, avail_w, avail_h, u, sale):
    parts = price_parts(spec.price_text)
    was = price_parts(spec.was_price_text)
    has_price = bool(spec.price_text.strip())
    fit = _price_fit(draw, parts, spec.price_text, u, avail_w, avail_h,
                     sale, bool(was), bool(spec.unit_suffix))
    gap = 6 * u * fit

    if sale:
        tag_h = 22 * u * fit if has_price else 0
        chip_h = 80 * u * fit if (parts or has_price) else 0
        reg_h = 18 * u * fit if was else 0
        total = tag_h + (gap if tag_h else 0) + chip_h + (gap + reg_h if reg_h else 0)
        y = top + max(0, (avail_h - total) / 2)
        if has_price:
            y += _sale_tag(draw, center_x, y, u, fit) + gap
        _draw_price_chip(draw, spec, center_x, y + chip_h / 2, u, parts, fit)
        y += chip_h
        if was:
            y += gap
            _draw_reg_chip(draw, was, center_x, y + reg_h / 2, u, fit)
    else:
        price_h = 92 * u * fit if parts else 44 * u * fit
        reg_h = 16 * u * fit if was else 0
        unit_h = 16 * u * fit if spec.unit_suffix else 0
        g = 3 * u * fit
        total = price_h + (g + reg_h if reg_h else 0) + (g + unit_h if unit_h else 0)
        y = top + max(0, (avail_h - total) / 2)
        _draw_plain_price(draw, spec, center_x, y + price_h / 2, u, parts, fit)
        y += price_h
        if was:
            y += g
            reg = f"Reg. ${was[0]}.{was[1]}"
            f = _font("Medium", int(13 * u * fit))
            _draw_text(draw, (center_x, y), reg, f, ACE_COOL_GRAY, anchor="ma")
            y += reg_h
        if spec.unit_suffix:
            y += g
            uf = _font("Medium", int(13 * u * fit))
            _draw_text(draw, (center_x, y), spec.unit_suffix, uf, ACE_COOL_GRAY, anchor="ma")


def _draw_plain_price(draw, spec, cx, cy, u, parts, fit=1.0):
    if parts:
        dollars, cents = parts
        big = _font("Black", int(84 * u * fit))
        small = _font("Black", int(30 * u * fit))
        dsign = _font("Black", int(28 * u * fit))
        dw = _text_size(draw, dollars, big)[0]
        sign_w = _text_size(draw, "$", dsign)[0]
        left = cx - (sign_w + dw + _text_size(draw, cents, small)[0] + 4 * u * fit) / 2
        top = cy - 42 * u * fit
        _draw_text(draw, (left, top + 8 * u * fit), "$", dsign, ACE_RED)
        _draw_text(draw, (left + sign_w + 2 * u * fit, top), dollars, big, ACE_RED)
        _draw_text(draw, (left + sign_w + dw + 4 * u * fit, top + 8 * u * fit), cents, small, ACE_RED)
    elif spec.price_text.strip():
        f = _fit_font(draw, spec.price_text, "Black", int(40 * u), avail_w_hint(u))
        _draw_text(draw, (cx, cy), spec.price_text, f, ACE_RED, anchor="mm")


def _draw_price_chip(draw, spec, cx, cy, u, parts, fit=1.0):
    if parts:
        dollars, cents = parts
        big = _font("Black", int(68 * u * fit))
        sign = _font("Black", int(26 * u * fit))
        cent = _font("Black", int(26 * u * fit))
        unit_f = _font("Medium", int(9.5 * u * fit))
        dw = _text_size(draw, dollars, big)[0]
        sign_w = _text_size(draw, "$", sign)[0]
        cent_w = _text_size(draw, cents, cent)[0]
        inner = sign_w + dw + cent_w + 6 * u * fit
        padx, pady = 10 * u * fit, 6 * u * fit
        chip_w = inner + 2 * padx
        chip_h = 68 * u * fit + 2 * pady
        x0 = cx - chip_w / 2
        y0 = cy - chip_h / 2
        draw.rectangle([x0, y0, x0 + chip_w, y0 + chip_h], fill=ACE_RED)
        tx = x0 + padx
        _draw_text(draw, (tx, y0 + pady + 6 * u * fit), "$", sign, WHITE)
        _draw_text(draw, (tx + sign_w + 2 * u * fit, y0 + pady), dollars, big, WHITE)
        cx2 = tx + sign_w + dw + 4 * u * fit
        _draw_text(draw, (cx2, y0 + pady + 6 * u * fit), cents, cent, WHITE)
        if spec.unit_suffix:
            _draw_text(draw, (cx2, y0 + pady + 34 * u * fit), spec.unit_suffix, unit_f, WHITE)
    elif spec.price_text.strip():
        f = _fit_font(draw, spec.price_text, "Black", int(34 * u), avail_w_hint(u))
        tw, th = _text_size(draw, spec.price_text, f)
        draw.rectangle([cx - tw / 2 - 10 * u, cy - th / 2 - 6 * u,
                        cx + tw / 2 + 10 * u, cy + th / 2 + 6 * u], fill=ACE_RED)
        _draw_text(draw, (cx, cy), spec.price_text, f, WHITE, anchor="mm")


def _draw_reg_chip(draw, was, cx, cy, u, fit=1.0):
    dollars, cents = was
    f = _font("Bold", int(10.5 * u * fit))
    small = _font("Bold", int(7 * u * fit))
    label = f"REG. ${dollars}"
    lw = _text_size(draw, label, f)[0]
    cw = _text_size(draw, cents, small)[0]
    inner = lw + cw + 1 * u
    padx, pady = 6 * u * fit, 2.5 * u * fit
    x0 = cx - (inner + 2 * padx) / 2
    y0 = cy - (12 * u * fit) / 2 - pady
    draw.rectangle([x0, y0, x0 + inner + 2 * padx, y0 + 12 * u * fit + 2 * pady], fill=BLACK)
    _draw_text(draw, (x0 + padx, y0 + pady), label, f, WHITE)
    _draw_text(draw, (x0 + padx + lw + 1 * u, y0 + pady), cents, small, WHITE)


def avail_w_hint(u):
    """Fallback width for free-form price text (no numeric parts)."""
    return 200 * u


def _draw_footer(draw, spec, pad, px_w, baseline, u):
    sku = spec.sku or ""
    footer = spec.footer_text or ""
    if not sku and not footer:
        return
    line_y = baseline - 16 * u
    draw.line([(pad, line_y), (px_w - pad, line_y)], fill=ACE_HAIRLINE, width=max(1, int(u)))
    f = _font("Regular", int(9.5 * u))
    if sku:
        _draw_text(draw, (pad, line_y + 4 * u), f"SKU {sku}", f, ACE_COOL_GRAY)
    if footer:
        fw = _text_size(draw, footer, f)[0]
        _draw_text(draw, (px_w - pad - fw, line_y + 4 * u), footer, f, ACE_COOL_GRAY)


# ---------------------------------------------------------------------------
# PDF export
# ---------------------------------------------------------------------------
def export_pdf(spec: SignSpec, path: str, paper: str = "US Letter (8½ × 11)",
               cut_marks: bool = True):
    """Write a print-ready PDF. The sign is drawn at 300 DPI and placed at its
    exact physical size, centered on the chosen paper."""
    from reportlab.lib.units import inch
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.utils import ImageReader

    w_in, h_in = spec.size_inches()
    sign_img = render_sign(spec, scale=1.0)

    if paper.startswith("Exact"):
        page_w, page_h = w_in * inch, h_in * inch
    elif paper.startswith("6"):
        page_w, page_h = 6 * inch, 4 * inch
    else:
        page_w, page_h = letter  # 8.5 x 11 portrait

    c = canvas.Canvas(path, pagesize=(page_w, page_h))
    sign_w, sign_h = w_in * inch, h_in * inch
    ox = (page_w - sign_w) / 2
    oy = (page_h - sign_h) / 2
    c.drawImage(ImageReader(sign_img), ox, oy, width=sign_w, height=sign_h)

    if cut_marks and not paper.startswith("Exact"):
        c.setLineWidth(0.5)
        m = 8
        for (px, py) in [(ox, oy), (ox + sign_w, oy), (ox, oy + sign_h), (ox + sign_w, oy + sign_h)]:
            c.line(px, py - 3, px, py - 3 - m) if py == oy else None
        # simple corner ticks
        for cx in (ox, ox + sign_w):
            for cy in (oy, oy + sign_h):
                c.line(cx, cy, cx + (6 if cx == ox else -6), cy)
                c.line(cx, cy, cx, cy + (6 if cy == oy else -6))
    c.showPage()
    c.save()


# ---------------------------------------------------------------------------
# Windows printing (GDI via pywin32); falls back to opening a PDF
# ---------------------------------------------------------------------------
def print_sign(spec: SignSpec, printer_name: Optional[str] = None) -> Tuple[bool, str]:
    """Print the sign to a Windows printer at true physical size. Returns
    (ok, message)."""
    try:
        import win32print
        import win32ui
        from PIL import ImageWin
    except Exception as exc:  # pragma: no cover - Windows only
        return False, (f"Direct printing needs pywin32 ({exc}). Use Export PDF and "
                       "print the PDF instead.")

    w_in, h_in = spec.size_inches()
    img = render_sign(spec, scale=1.0).convert("RGB")

    name = printer_name or win32print.GetDefaultPrinter()
    hdc = win32ui.CreateDC()
    hdc.CreatePrinterDC(name)
    px_per_in_x = hdc.GetDeviceCaps(88)   # LOGPIXELSX
    px_per_in_y = hdc.GetDeviceCaps(90)   # LOGPIXELSY

    target_w = int(w_in * px_per_in_x)
    target_h = int(h_in * px_per_in_y)

    hdc.StartDoc(f"Ace Sign {spec.sku or ''}".strip())
    hdc.StartPage()
    dib = ImageWin.Dib(img)
    dib.draw(hdc.GetHandleOutput(), (0, 0, target_w, target_h))
    hdc.EndPage()
    hdc.EndDoc()
    hdc.DeleteDC()
    return True, f"Sent to {name}."
