"""Data models, config, and small helpers for Ace Sign Studio (Windows).

Mirrors the macOS app: physical sign sizes, layout formats, price parsing,
the brand palette, and persisted preferences.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Optional


# ---------------------------------------------------------------------------
# Brand palette (Ace Brand Guidelines, primary palette — used at 100%, no tints)
# ---------------------------------------------------------------------------
ACE_RED = (227, 25, 55)        # PMS 186 C
ACE_COOL_GRAY = (109, 113, 110)  # Cool Gray 11
ACE_HAIRLINE = (188, 190, 192)   # Cool Gray 1
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)


# ---------------------------------------------------------------------------
# Sign sizes  (width >= height reference; orientation applied separately)
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class SignSize:
    id: str
    name: str
    width: float   # inches
    height: float  # inches

    @property
    def is_custom(self) -> bool:
        return self.id == "custom"


SIGN_SIZES = [
    SignSize("5.5x3.5", "Sign Holder — 5½ × 3½ in", 5.5, 3.5),
    SignSize("5x3", "Shelf Card — 5 × 3 in", 5.0, 3.0),
    SignSize("6x4", "Card — 6 × 4 in", 6.0, 4.0),
    SignSize("7x5", "Card — 7 × 5 in", 7.0, 5.0),
    SignSize("11x7", "Counter Sign — 11 × 7 in", 11.0, 7.0),
    SignSize("11x8.5", "Full Page — 11 × 8½ in", 11.0, 8.5),
    SignSize("custom", "Custom…", 5.5, 3.5),
]
DEFAULT_SIZE = SIGN_SIZES[0]

ORIENTATIONS = ["Wide", "Tall"]
FORMATS = ["Standard", "Sale"]

PAPER_OPTIONS = ["US Letter (8½ × 11)", "6 × 4 in Card", "Exact Sign Size"]


# ---------------------------------------------------------------------------
# Price parsing / formatting
# ---------------------------------------------------------------------------
def price_parts(text: str):
    """'12.99' / '$12.99' / '1,299' -> ('12','99') or None."""
    if text is None:
        return None
    cleaned = str(text).strip().replace("$", "").replace(",", "")
    if not cleaned:
        return None
    try:
        value = float(cleaned)
    except ValueError:
        return None
    if not (value == value) or value < 0 or value >= 1_000_000:  # NaN / range guard
        return None
    cents = int(round(value * 100))
    return str(cents // 100), "%02d" % (cents % 100)


def price_display(text: str) -> Optional[str]:
    parts = price_parts(text)
    if parts is None:
        return None
    return "$%s.%s" % parts


def format_inches(v: float) -> str:
    if float(v).is_integer():
        return str(int(v))
    return ("%.2f" % v).rstrip("0").rstrip(".")


# ---------------------------------------------------------------------------
# Persisted preferences (JSON under %APPDATA%\AceSignStudio\config.json)
# ---------------------------------------------------------------------------
def _config_dir() -> str:
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    path = os.path.join(base, "AceSignStudio")
    os.makedirs(path, exist_ok=True)
    return path


@dataclass
class Config:
    store_code: str = "12180"
    store_name: str = "Snyder's Ace Hardware • Media, PA"
    show_footer: bool = True
    logo_path: str = ""   # optional override; empty = built-in Ace logo

    _path: str = field(default="", repr=False)

    @classmethod
    def load(cls) -> "Config":
        path = os.path.join(_config_dir(), "config.json")
        cfg = cls()
        cfg._path = path
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            for key in ("store_code", "store_name", "show_footer", "logo_path"):
                if key in data:
                    setattr(cfg, key, data[key])
        except (OSError, ValueError):
            pass
        return cfg

    def save(self) -> None:
        try:
            with open(self._path or os.path.join(_config_dir(), "config.json"),
                      "w", encoding="utf-8") as fh:
                json.dump({
                    "store_code": self.store_code,
                    "store_name": self.store_name,
                    "show_footer": self.show_footer,
                    "logo_path": self.logo_path,
                }, fh, indent=2)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# The editable sign state (what the preview / print consume)
# ---------------------------------------------------------------------------
@dataclass
class SignSpec:
    product_name: str = ""
    detail_line: str = ""
    price_text: str = ""
    was_price_text: str = ""
    unit_suffix: str = ""
    sku: str = ""
    footer_text: Optional[str] = None
    image: object = None         # PIL.Image.Image or None (per-instance field)
    layout: str = "Standard"
    size: SignSize = DEFAULT_SIZE
    custom_w: float = 5.5
    custom_h: float = 3.5
    orientation: str = "Wide"
    _logo_path: str = ""         # optional logo override path

    def size_inches(self):
        if self.size.is_custom:
            w, h = max(self.custom_w, 0.5), max(self.custom_h, 0.5)
        elif self.orientation == "Wide":
            w, h = self.size.width, self.size.height
        else:
            w, h = self.size.height, self.size.width
        return w, h

    @property
    def is_wide(self) -> bool:
        w, h = self.size_inches()
        return w >= h
