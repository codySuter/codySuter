"""Parser tests using synthetic text shaped exactly like real STIHL invoice extractions.

Run with: python tests/test_parser.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from invoice_parser import normalize_mfg, parse_invoice_text

# Mirrors pypdf extraction of a STIHL invoice, including the tricky cases:
# - item with no Cust. Part No. (falls back to normalized mfg number)
# - qty/prices on the same line as the item start (short description)
# - "Cust. Part No." pushed onto the next page, after the page header
SAMPLE = """INVOICE
Remit-To:
Northeast STIHL
Information
Invoice No:
Invoice Dt:
Page No.:
9106588310
07/15/2026
1  of  2
   Ln# Product Nr. Description Qty UoM List Price Net Price Line Amt
PO NUM / SO NUM: STHL071426 / 2202624630
    100 WA31-211-0000-US RMA 348.0 (USA) SET Cordless lawn
mower
Deal 101884: 2026 RM/RMA Volume
Discount
     4   PC 399.99 301.99 1,207.96
UPC #: 198520014451
Serial #: 956202823, 956202824, 956202825, 956202827
    300 BA05-011-5919-US BGA 50.0 SET Cordless Blower      4   PC 199.99 155.99 623.96
UPC #: 886661422210
    400 3005-005-9900 Bar & Chain Kit 1, 40cm/16", 61PMM3
Cust. Part No.: 7050723D
     2   PC 89.99 59.39 118.78
UPC #: 886661712618
   2000 3610-005-0055 61 PMM3 Picco Micro Mini Chain, 3.355     20   PC 26.99 14.57 291.40
INVOICE
Remit-To:
Northeast STIHL
Information
Invoice No:
Invoice Date:
Page No.:
9106588310
07/15/2026
2  of  2
   Ln# Product Nr. Description Qty UoM List Price Net Price Line Amt
Cust. Part No.: 7000994D
UPC #: 795711356699
   2100 3695-005-0074 23 RM3 Rapid Micro Chain, 3.996 ft.
Cust. Part No.: 7019556D
    10   PC 36.99 19.97 199.70
UPC #: 886661880959
------------------------------------------------------------------------------
Subtotal :     6,218.00
Final amount :     6,404.52
Due 09/13/2026                 6,404.52 USD
"""


def test_normalize_mfg():
    assert normalize_mfg("WA31-211-0000-US") == "WA312110000"
    assert normalize_mfg("3005-005-9900") == "30050059900"
    assert normalize_mfg("BA05-011-5919-US") == "BA050115919"


def test_parse_invoice():
    result = parse_invoice_text(SAMPLE)
    assert result.invoice_no == "9106588310", result.invoice_no
    assert result.warnings == [], result.warnings

    rows = [item.csv_row() for item in result.items]
    expected = [
        ["WA312110000", "301.99", "399.99", "4"],  # no cust part -> normalized mfg
        ["BA050115919", "155.99", "199.99", "4"],  # qty on same line as item start
        ["7050723D", "59.39", "89.99", "2"],
        ["7000994D", "14.57", "26.99", "20"],      # cust part on the next page
        ["7019556D", "19.97", "36.99", "10"],
    ]
    assert rows == expected, "\n".join(map(str, rows))


def test_summary_lines_do_not_become_items():
    result = parse_invoice_text(SAMPLE)
    line_nos = [item.line_no for item in result.items]
    assert line_nos == ["100", "300", "400", "2000", "2100"], line_nos


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except AssertionError as exc:
                failures += 1
                print(f"FAIL {name}: {exc}")
    raise SystemExit(1 if failures else 0)
