# Epicor Invoice Converter

A Windows app that converts STIHL PDF invoices into CSV files ready to import
into an Epicor Eagle system.

## What it does

For every line item on the invoice it produces one CSV row with 4 columns:

| Column | Where it comes from |
| ------ | ------------------- |
| SKU    | The **Cust. Part No.** (e.g. `7050723D`). If the line has no customer part number, the manufacturer part number is used instead, with the `-US` suffix and all dashes removed (e.g. `WA31-211-0000-US` becomes `WA312110000`). |
| Cost   | The **Net Price** (your cost per unit) |
| Retail | The **List Price** |
| Qty    | The **Qty** shipped |

By default the CSV has no header row (just data). Tick the
"Include header row in CSV" box if your Eagle import expects one.

## Getting the app

Every change pushed to this folder automatically builds a fresh
`EpicorInvoiceConverter.exe` with GitHub Actions:

1. Go to the repo's **Releases** page and open **"Epicor Invoice Converter (latest build)"**.
2. Download `EpicorInvoiceConverter.exe`.
3. Double-click it to run - nothing to install.

> Windows SmartScreen may warn about an unrecognized app the first time.
> Click **More info -> Run anyway** (it's your own build from your own repo).

## Using the app

1. Click **Open PDF Invoice(s)...** and pick one or more invoice PDFs.
2. Review the parsed items in the table (SKU, description, qty, cost, retail).
3. Click **Save CSV...** - the file is named after the invoice number
   (e.g. `9106588310.csv`) and is ready to import into Epicor Eagle.

If the app can't confidently read a line (or a line's qty x cost doesn't match
the invoice's line amount), it shows a warning so you can double-check that row.

## Building it yourself (optional)

On a Windows PC with Python 3.9+ installed ([python.org](https://www.python.org),
check "Add python.exe to PATH" during install):

1. Download this folder.
2. Double-click `build.bat`.
3. The finished app appears at `dist\EpicorInvoiceConverter.exe`.

## Command-line use (optional)

The parser also works from a terminal, handy for automation:

```
python invoice_parser.py invoice.pdf output.csv
python invoice_parser.py invoice.pdf output.csv --header
```

## Tests

```
python tests/test_parser.py
```
