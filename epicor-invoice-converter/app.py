"""Epicor Invoice Converter - Windows GUI.

Converts STIHL PDF invoices into CSV files ready for import into an
Epicor Eagle system. CSV columns: SKU, Cost, Retail, Qty.
"""
from __future__ import annotations

import csv
import os
import traceback
from tkinter import BooleanVar, StringVar, Tk, filedialog, messagebox
from tkinter import ttk

from invoice_parser import LineItem, parse_pdf

APP_TITLE = "Epicor Invoice Converter"


class ConverterApp:
    def __init__(self, root: Tk) -> None:
        self.root = root
        root.title(APP_TITLE)
        root.geometry("980x560")
        root.minsize(760, 400)

        # (invoice_no, LineItem) pairs, in the order they will be written to CSV.
        self.rows: list[tuple[str, LineItem]] = []
        self.include_header = BooleanVar(value=False)
        self.status = StringVar(value="Open a PDF invoice to get started.")

        self._build_ui()

    def _build_ui(self) -> None:
        toolbar = ttk.Frame(self.root, padding=(10, 10, 10, 4))
        toolbar.pack(fill="x")

        ttk.Button(toolbar, text="Open PDF Invoice(s)...", command=self.open_pdfs).pack(
            side="left"
        )
        ttk.Button(toolbar, text="Clear", command=self.clear).pack(side="left", padx=(8, 0))
        ttk.Checkbutton(
            toolbar, text="Include header row in CSV", variable=self.include_header
        ).pack(side="left", padx=(16, 0))
        self.save_button = ttk.Button(
            toolbar, text="Save CSV...", command=self.save_csv, state="disabled"
        )
        self.save_button.pack(side="right")

        columns = ("invoice", "line", "sku", "description", "qty", "cost", "retail")
        table_frame = ttk.Frame(self.root, padding=(10, 4))
        table_frame.pack(fill="both", expand=True)

        self.tree = ttk.Treeview(table_frame, columns=columns, show="headings")
        headings = {
            "invoice": ("Invoice #", 90, "w"),
            "line": ("Ln#", 55, "e"),
            "sku": ("SKU", 120, "w"),
            "description": ("Description", 360, "w"),
            "qty": ("Qty", 55, "e"),
            "cost": ("Cost", 80, "e"),
            "retail": ("Retail", 80, "e"),
        }
        for key, (title, width, anchor) in headings.items():
            self.tree.heading(key, text=title)
            self.tree.column(key, width=width, anchor=anchor, stretch=(key == "description"))

        scrollbar = ttk.Scrollbar(table_frame, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)
        self.tree.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        ttk.Label(self.root, textvariable=self.status, padding=(10, 4)).pack(
            fill="x", side="bottom"
        )

    def open_pdfs(self) -> None:
        paths = filedialog.askopenfilenames(
            title="Select PDF invoice(s)",
            filetypes=[("PDF files", "*.pdf"), ("All files", "*.*")],
        )
        if not paths:
            return

        warnings: list[str] = []
        errors: list[str] = []
        for path in paths:
            try:
                result = parse_pdf(path)
            except Exception:
                errors.append(f"{os.path.basename(path)}:\n{traceback.format_exc(limit=2)}")
                continue
            invoice_no = result.invoice_no or os.path.splitext(os.path.basename(path))[0]
            for item in result.items:
                self.rows.append((invoice_no, item))
                self.tree.insert(
                    "",
                    "end",
                    values=(
                        invoice_no,
                        item.line_no,
                        item.sku,
                        item.description,
                        item.qty,
                        f"{item.net_price:.2f}",
                        f"{item.list_price:.2f}",
                    ),
                )
            warnings.extend(f"{os.path.basename(path)}: {w}" for w in result.warnings)

        self._update_status()
        if errors:
            messagebox.showerror(
                APP_TITLE, "Could not read some files:\n\n" + "\n\n".join(errors)
            )
        if warnings:
            messagebox.showwarning(APP_TITLE, "\n\n".join(warnings))

    def clear(self) -> None:
        self.rows.clear()
        self.tree.delete(*self.tree.get_children())
        self._update_status()

    def save_csv(self) -> None:
        if not self.rows:
            messagebox.showinfo(APP_TITLE, "Nothing to save - open a PDF invoice first.")
            return

        invoice_nos = sorted({invoice for invoice, _ in self.rows})
        default_name = (
            f"{invoice_nos[0]}.csv" if len(invoice_nos) == 1 else "epicor_import.csv"
        )
        path = filedialog.asksaveasfilename(
            title="Save CSV for Epicor Eagle import",
            defaultextension=".csv",
            initialfile=default_name,
            filetypes=[("CSV files", "*.csv"), ("All files", "*.*")],
        )
        if not path:
            return

        try:
            with open(path, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                if self.include_header.get():
                    writer.writerow(["SKU", "Cost", "Retail", "Qty"])
                for _, item in self.rows:
                    writer.writerow(item.csv_row())
        except OSError as exc:
            messagebox.showerror(APP_TITLE, f"Could not save the file:\n{exc}")
            return

        self.status.set(f"Saved {len(self.rows)} items to {path}")
        messagebox.showinfo(APP_TITLE, f"Saved {len(self.rows)} items to:\n{path}")

    def _update_status(self) -> None:
        if not self.rows:
            self.status.set("Open a PDF invoice to get started.")
            self.save_button.configure(state="disabled")
            return
        invoice_count = len({invoice for invoice, _ in self.rows})
        plural = "s" if invoice_count != 1 else ""
        self.status.set(
            f"{len(self.rows)} items loaded from {invoice_count} invoice{plural}. "
            "Review the rows, then click Save CSV."
        )
        self.save_button.configure(state="normal")


def main() -> None:
    root = Tk()
    try:
        ConverterApp(root)
        root.mainloop()
    except Exception:
        messagebox.showerror(APP_TITLE, traceback.format_exc())
        raise


if __name__ == "__main__":
    main()
