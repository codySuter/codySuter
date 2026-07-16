"""Parse STIHL PDF invoices into line items for Epicor Eagle CSV import.

SKU rule: use the customer part number (Cust. Part No.) when the invoice
provides one; otherwise fall back to the manufacturer part number with the
"-US" suffix and all dashes stripped (e.g. "WA31-211-0000-US" -> "WA312110000").

CSV columns produced: SKU, Cost (net price), Retail (list price), Qty.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# Manufacturer part numbers look like "3005-005-9900" or "WA31-211-0000-US".
MFG_PART_PATTERN = r"[A-Z0-9]{4}-[A-Z0-9]{3}-[A-Z0-9]{4}(?:-US)?"

# Start of a line item: invoice line number (100, 200, ...) then the mfg part.
ITEM_START_RE = re.compile(
    rf"^[ \t]*(\d{{2,6}})[ \t]+({MFG_PART_PATTERN})\b(.*)$", re.MULTILINE
)

# Quantity/price group: "4 PC 399.99 301.99 1,207.96"
# (qty, unit of measure, list price, net price, extended line amount)
QTY_PRICE_RE = re.compile(
    r"([\d,]+)\s+([A-Z]{1,4})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})"
)

CUST_PART_RE = re.compile(r"Cust\.?\s*Part\s*No\.?\s*:?\s*([A-Za-z0-9\-]+)")

# The invoice number is the first long all-digit line after the "Invoice No:" label.
INVOICE_NO_RE = re.compile(r"Invoice No:(?:[^\n]*\n)+?\s*(\d{6,})\s*$", re.MULTILINE)

# Lines that end the free-text description portion of an item block.
DESC_STOP_RE = re.compile(
    r"^\s*(UPC\s*#|Serial\s*#|Cust\.?\s*Part|Deal\s+\d|INVOICE\b|Remit-To|Sold-To|"
    r"Ship-To|Bill-To|Information\b|Invoice (No|Date|Dt)|Page No|All products|-{5,})"
)


def normalize_mfg(mfg: str) -> str:
    """"WA31-211-0000-US" -> "WA312110000"; "3005-005-9900" -> "30050059900"."""
    part = mfg.strip().upper()
    if part.endswith("-US"):
        part = part[:-3]
    return part.replace("-", "")


def _num(text: str) -> float:
    return float(text.replace(",", ""))


@dataclass
class LineItem:
    line_no: str
    mfg_part: str
    cust_part: str | None
    description: str
    qty: int
    list_price: float  # retail
    net_price: float  # cost
    line_amount: float

    @property
    def sku(self) -> str:
        return self.cust_part if self.cust_part else normalize_mfg(self.mfg_part)

    def csv_row(self) -> list[str]:
        return [self.sku, f"{self.net_price:.2f}", f"{self.list_price:.2f}", str(self.qty)]


@dataclass
class ParseResult:
    invoice_no: str | None
    items: list[LineItem] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def parse_invoice_text(text: str) -> ParseResult:
    """Parse the concatenated text of every page of one invoice."""
    invoice_match = INVOICE_NO_RE.search(text)
    result = ParseResult(invoice_no=invoice_match.group(1) if invoice_match else None)

    starts = list(ITEM_START_RE.finditer(text))
    for i, start in enumerate(starts):
        block_end = starts[i + 1].start() if i + 1 < len(starts) else len(text)
        block = text[start.start() : block_end]
        line_no, mfg_part, first_line_rest = start.group(1), start.group(2), start.group(3)

        qty_match = QTY_PRICE_RE.search(block)
        if not qty_match:
            result.warnings.append(
                f"Line {line_no} ({mfg_part}): could not find qty/price data - item skipped."
            )
            continue

        qty = int(_num(qty_match.group(1)))
        list_price = _num(qty_match.group(3))
        net_price = _num(qty_match.group(4))
        line_amount = _num(qty_match.group(5))

        cust_match = CUST_PART_RE.search(block)
        cust_part = cust_match.group(1).strip() if cust_match else None

        item = LineItem(
            line_no=line_no,
            mfg_part=mfg_part,
            cust_part=cust_part,
            description=_extract_description(first_line_rest, block),
            qty=qty,
            list_price=list_price,
            net_price=net_price,
            line_amount=line_amount,
        )

        expected = round(item.qty * item.net_price, 2)
        if abs(expected - item.line_amount) > 0.02:
            result.warnings.append(
                f"Line {line_no} ({item.sku}): qty x cost = {expected:.2f} but invoice "
                f"shows {item.line_amount:.2f} - double-check this row."
            )

        result.items.append(item)

    if not result.items:
        result.warnings.append("No line items were found in this PDF.")
    return result


def _extract_description(first_line_rest: str, block: str) -> str:
    parts = []
    first = first_line_rest.strip()
    embedded_qty = QTY_PRICE_RE.search(first)
    had_embedded_qty = False
    if embedded_qty:
        first = first[: embedded_qty.start()].strip()
        had_embedded_qty = True
    if first:
        parts.append(first)
    if not had_embedded_qty:
        # Description may wrap onto the following lines until a stop line.
        for line in block.splitlines()[1:]:
            stripped = line.strip()
            if not stripped or DESC_STOP_RE.match(line) or QTY_PRICE_RE.search(line):
                break
            parts.append(stripped)
    return " ".join(parts)


def extract_pdf_text(pdf_path: str) -> str:
    from pypdf import PdfReader

    reader = PdfReader(pdf_path)
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def parse_pdf(pdf_path: str) -> ParseResult:
    return parse_invoice_text(extract_pdf_text(pdf_path))


def write_csv(items: list[LineItem], csv_path: str, include_header: bool = False) -> None:
    import csv

    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if include_header:
            writer.writerow(["SKU", "Cost", "Retail", "Qty"])
        for item in items:
            writer.writerow(item.csv_row())


def main(argv: list[str]) -> int:
    """Command-line usage: python invoice_parser.py invoice.pdf [output.csv] [--header]"""
    args = [a for a in argv if a != "--header"]
    include_header = "--header" in argv
    if not args:
        print(main.__doc__)
        return 2
    pdf_path = args[0]
    result = parse_pdf(pdf_path)
    csv_path = args[1] if len(args) > 1 else (
        (result.invoice_no or "invoice") + ".csv"
    )
    write_csv(result.items, csv_path, include_header)
    print(f"Invoice {result.invoice_no or '(unknown)'}: wrote {len(result.items)} items to {csv_path}")
    for warning in result.warnings:
        print(f"WARNING: {warning}")
    return 0 if result.items else 1


if __name__ == "__main__":
    import sys

    raise SystemExit(main(sys.argv[1:]))
