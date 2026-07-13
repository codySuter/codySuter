"""Ace Sign Studio (Windows) — tkinter desktop app.

Type a SKU, look up the price for store #12180 and a product photo from
acehardware.com, and print a branded 5½ × 3½ in sign (other sizes/formats
available). All fields stay editable; the preview updates live.
"""
from __future__ import annotations

import io
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from PIL import Image, ImageTk

from . import __version__
from .lookup import AceLookup
from .models import (Config, DEFAULT_SIZE, FORMATS, ORIENTATIONS, PAPER_OPTIONS,
                     SIGN_SIZES, SignSpec, format_inches)
from . import render


class AceSignApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Ace Sign Studio")
        self.geometry("1120x720")
        self.minsize(940, 620)

        self.cfg = Config.load()
        self.lookup_service = AceLookup()
        self._photo: Image.Image | None = None
        self._preview_imgtk = None
        self._thumb_imgtk = None
        self._diag = []
        self._preview_job = None
        self._busy = False
        self._queue = []   # list of snapshotted SignSpec

        self._build_vars()
        self._build_ui()
        self._schedule_preview()

    # -- state --------------------------------------------------------------
    def _build_vars(self):
        self.v_sku = tk.StringVar()
        self.v_name = tk.StringVar()
        self.v_detail = tk.StringVar()
        self.v_price = tk.StringVar()
        self.v_was = tk.StringVar()
        self.v_unit = tk.StringVar()
        self.v_size = tk.StringVar(value=DEFAULT_SIZE.name)
        self.v_orient = tk.StringVar(value=ORIENTATIONS[0])
        self.v_format = tk.StringVar(value=FORMATS[0])
        self.v_paper = tk.StringVar(value=PAPER_OPTIONS[0])
        self.v_custom_w = tk.StringVar(value="5.5")
        self.v_custom_h = tk.StringVar(value="3.5")
        self.v_status = tk.StringVar(value="Enter a SKU and press Look Up.")
        for var in (self.v_name, self.v_detail, self.v_price, self.v_was, self.v_unit,
                    self.v_size, self.v_orient, self.v_format, self.v_custom_w, self.v_custom_h):
            var.trace_add("write", lambda *_: self._schedule_preview())

    # -- layout -------------------------------------------------------------
    def _build_ui(self):
        self._build_menu()
        outer = ttk.Frame(self, padding=8)
        outer.pack(fill="both", expand=True)

        paned = ttk.Panedwindow(outer, orient="horizontal")
        paned.pack(fill="both", expand=True)

        controls = ttk.Frame(paned, padding=(4, 4, 10, 4))
        paned.add(controls, weight=0)
        self._build_controls(controls)

        right = ttk.Frame(paned)
        paned.add(right, weight=1)
        self._build_preview(right)

        status = ttk.Frame(self, relief="sunken")
        status.pack(fill="x", side="bottom")
        ttk.Label(status, textvariable=self.v_status, anchor="w", padding=4).pack(fill="x")

    def _build_menu(self):
        menubar = tk.Menu(self)
        filem = tk.Menu(menubar, tearoff=0)
        filem.add_command(label="Look Up SKU\tCtrl+L", command=self.do_lookup)
        filem.add_separator()
        filem.add_command(label="Export PDF…\tCtrl+E", command=self.export_pdf)
        filem.add_command(label="Print…\tCtrl+P", command=self.print_sign)
        filem.add_separator()
        filem.add_command(label="Settings…", command=self.open_settings)
        filem.add_command(label="Exit", command=self.destroy)
        menubar.add_cascade(label="File", menu=filem)
        helpm = tk.Menu(menubar, tearoff=0)
        helpm.add_command(label="Diagnostics…", command=self.show_diagnostics)
        helpm.add_command(label="About", command=self._about)
        menubar.add_cascade(label="Help", menu=helpm)
        self.config(menu=menubar)
        self.bind("<Control-l>", lambda e: self.do_lookup())
        self.bind("<Control-e>", lambda e: self.export_pdf())
        self.bind("<Control-p>", lambda e: self.print_sign())

    def _build_controls(self, parent):
        # Lookup
        lf = ttk.LabelFrame(parent, text="Look Up Product", padding=8)
        lf.pack(fill="x", pady=(0, 8))
        row = ttk.Frame(lf); row.pack(fill="x")
        sku = ttk.Entry(row, textvariable=self.v_sku)
        sku.pack(side="left", fill="x", expand=True)
        sku.bind("<Return>", lambda e: self.do_lookup())
        self.btn_lookup = ttk.Button(row, text="Look Up", command=self.do_lookup)
        self.btn_lookup.pack(side="left", padx=(6, 0))
        ttk.Label(lf, text="SKU, item #, product name, or acehardware.com URL",
                  foreground="#777").pack(anchor="w", pady=(4, 0))
        self.lbl_error = ttk.Label(lf, text="", foreground="#b00", wraplength=320)
        self.lbl_error.pack(anchor="w", pady=(2, 0))

        # Text fields
        tf = ttk.LabelFrame(parent, text="Sign Text", padding=8)
        tf.pack(fill="x", pady=(0, 8))
        self._labeled(tf, "Product name", self.v_name)
        self._labeled(tf, "Detail (brand, size, model)", self.v_detail)
        self._labeled(tf, "Price", self.v_price)
        self._labeled(tf, "Was price (adds strikethrough / REG.)", self.v_was)
        self._labeled(tf, "Unit (e.g. each, /ft)", self.v_unit)

        # Photo
        pf = ttk.LabelFrame(parent, text="Photo", padding=8)
        pf.pack(fill="x", pady=(0, 8))
        prow = ttk.Frame(pf); prow.pack(fill="x")
        self.thumb = ttk.Label(prow, width=10, anchor="center", relief="groove")
        self.thumb.pack(side="left", padx=(0, 8))
        btns = ttk.Frame(prow); btns.pack(side="left")
        ttk.Button(btns, text="Choose…", command=self.choose_photo).grid(row=0, column=0, padx=2, pady=2)
        ttk.Button(btns, text="Paste", command=self.paste_photo).grid(row=0, column=1, padx=2, pady=2)
        ttk.Button(btns, text="Clear", command=self.clear_photo).grid(row=0, column=2, padx=2, pady=2)

        # Sign config
        sf = ttk.LabelFrame(parent, text="Sign", padding=8)
        sf.pack(fill="x", pady=(0, 8))
        self._combo(sf, "Size", self.v_size, [s.name for s in SIGN_SIZES])
        self.custom_row = ttk.Frame(sf)
        ttk.Label(self.custom_row, text="Custom (in):").pack(side="left")
        ttk.Entry(self.custom_row, textvariable=self.v_custom_w, width=6).pack(side="left", padx=2)
        ttk.Label(self.custom_row, text="×").pack(side="left")
        ttk.Entry(self.custom_row, textvariable=self.v_custom_h, width=6).pack(side="left", padx=2)
        self._combo(sf, "Orientation", self.v_orient, ORIENTATIONS)
        self._combo(sf, "Format", self.v_format, FORMATS)
        self.v_size.trace_add("write", lambda *_: self._toggle_custom())

        # Output
        of = ttk.LabelFrame(parent, text="Print", padding=8)
        of.pack(fill="x")
        self._combo(of, "Paper", self.v_paper, PAPER_OPTIONS)
        brow = ttk.Frame(of); brow.pack(fill="x", pady=(6, 0))
        ttk.Button(brow, text="Print…", command=self.print_sign).pack(side="left")
        ttk.Button(brow, text="Export PDF…", command=self.export_pdf).pack(side="left", padx=6)
        ttk.Button(brow, text="Diagnostics", command=self.show_diagnostics).pack(side="right")

        # Batch queue
        qf = ttk.LabelFrame(parent, text="Batch Queue", padding=8)
        qf.pack(fill="both", expand=True, pady=(8, 0))
        ttk.Button(qf, text="＋  Add current sign to queue",
                   command=self.add_to_queue).pack(fill="x")
        listrow = ttk.Frame(qf); listrow.pack(fill="both", expand=True, pady=(6, 4))
        self.queue_list = tk.Listbox(listrow, height=5, activestyle="none")
        self.queue_list.pack(side="left", fill="both", expand=True)
        qscroll = ttk.Scrollbar(listrow, command=self.queue_list.yview)
        qscroll.pack(side="right", fill="y")
        self.queue_list.config(yscrollcommand=qscroll.set)
        self.queue_plan = ttk.Label(qf, text="Queue is empty.", foreground="#666")
        self.queue_plan.pack(anchor="w")
        qbtns = ttk.Frame(qf); qbtns.pack(fill="x", pady=(6, 0))
        ttk.Button(qbtns, text="Print Queue", command=self.print_queue).pack(side="left")
        ttk.Button(qbtns, text="Export PDF", command=self.export_queue_pdf).pack(side="left", padx=6)
        ttk.Button(qbtns, text="Remove", command=self.remove_from_queue).pack(side="right")
        ttk.Button(qbtns, text="Clear", command=self.clear_queue).pack(side="right", padx=6)
        self.v_paper.trace_add("write", lambda *_: self._update_queue_plan())

    def _labeled(self, parent, label, var):
        ttk.Label(parent, text=label).pack(anchor="w")
        ttk.Entry(parent, textvariable=var).pack(fill="x", pady=(0, 6))

    def _combo(self, parent, label, var, values):
        row = ttk.Frame(parent); row.pack(fill="x", pady=2)
        ttk.Label(row, text=label, width=12).pack(side="left")
        ttk.Combobox(row, textvariable=var, values=values, state="readonly").pack(
            side="left", fill="x", expand=True)

    def _build_preview(self, parent):
        wrap = ttk.Frame(parent, padding=8)
        wrap.pack(fill="both", expand=True)
        self.canvas = tk.Canvas(wrap, background="#e9e9ec", highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)
        self.canvas.bind("<Configure>", lambda e: self._schedule_preview())
        self.caption = ttk.Label(wrap, text="", anchor="center")
        self.caption.pack(fill="x", pady=(6, 0))

    # -- spec assembly ------------------------------------------------------
    def _current_size(self):
        for s in SIGN_SIZES:
            if s.name == self.v_size.get():
                return s
        return DEFAULT_SIZE

    def _toggle_custom(self):
        if self._current_size().is_custom:
            self.custom_row.pack(fill="x", pady=2)
        else:
            self.custom_row.pack_forget()

    def _spec(self) -> SignSpec:
        def f(var, default):
            try:
                return float(var.get())
            except (ValueError, tk.TclError):
                return default
        spec = SignSpec(
            product_name=self.v_name.get(),
            detail_line=self.v_detail.get(),
            price_text=self.v_price.get(),
            was_price_text=self.v_was.get(),
            unit_suffix=self.v_unit.get(),
            sku="" if self.v_sku.get().lower().startswith("http") or " " in self.v_sku.get()
                else self.v_sku.get().strip(),
            footer_text=(self.cfg.store_name if self.cfg.show_footer and self.cfg.store_name else None),
            layout=self.v_format.get(),
            size=self._current_size(),
            custom_w=f(self.v_custom_w, 5.5),
            custom_h=f(self.v_custom_h, 3.5),
            orientation=self.v_orient.get(),
        )
        spec.image = self._photo
        spec._logo_path = self.cfg.logo_path or ""
        return spec

    # -- preview ------------------------------------------------------------
    def _schedule_preview(self):
        if self._preview_job is not None:
            self.after_cancel(self._preview_job)
        self._preview_job = self.after(120, self._render_preview)

    def _render_preview(self):
        self._preview_job = None
        spec = self._spec()
        cw = max(self.canvas.winfo_width(), 50)
        ch = max(self.canvas.winfo_height(), 50)
        w_in, h_in = spec.size_inches()
        scale = min((cw - 40) / (w_in * render.DPI), (ch - 40) / (h_in * render.DPI), 0.6)
        scale = max(scale, 0.03)
        try:
            img = render.render_sign(spec, scale=scale, preview=True)
        except Exception as exc:  # never let a render error kill the UI
            self.v_status.set(f"Preview error: {exc}")
            return
        self._preview_imgtk = ImageTk.PhotoImage(img)
        self.canvas.delete("all")
        self.canvas.create_image(cw // 2, ch // 2, image=self._preview_imgtk)
        self.caption.config(
            text=f"{format_inches(w_in)} × {format_inches(h_in)} in — {spec.layout} format")

    # -- lookup -------------------------------------------------------------
    def do_lookup(self):
        query = self.v_sku.get().strip()
        if not query or self._busy:
            return
        self._busy = True
        self.btn_lookup.config(state="disabled")
        self.lbl_error.config(text="")
        self.v_status.set(f"Looking up {query}…")
        store = self.cfg.store_code
        threading.Thread(target=self._lookup_worker, args=(query, store), daemon=True).start()

    def _lookup_worker(self, query, store):
        try:
            result = self.lookup_service.lookup(query, store)
        except Exception as exc:  # pragma: no cover
            self.after(0, lambda: self._lookup_failed(str(exc)))
            return
        self.after(0, lambda: self._lookup_done(result, query))

    def _lookup_failed(self, msg):
        self._busy = False
        self.btn_lookup.config(state="normal")
        self.v_status.set("Lookup failed.")
        self.lbl_error.config(text=msg)

    def _lookup_done(self, result, query):
        self._busy = False
        self.btn_lookup.config(state="normal")
        self._diag = result.diagnostics
        if result.product_name:
            self.v_name.set(result.product_name)
        if result.detail_line:
            self.v_detail.set(result.detail_line)
        if result.price_text is not None:
            self.v_price.set(result.price_text)
        # Reset was-price to THIS product (never linger from a prior lookup)
        if result.product_name or result.price_text:
            self.v_was.set(result.was_price_text or "")
        if result.resolved_item_number and (query.lower().startswith("http") or not query.isdigit()):
            self.v_sku.set(result.resolved_item_number)
        if result.image_bytes:
            try:
                self._photo = Image.open(io.BytesIO(result.image_bytes)).convert("RGBA")
                self._update_thumb()
            except Exception:
                pass
        if result.error and not result.product_name and result.price_text is None:
            self.lbl_error.config(text=result.error)
            self.v_status.set("No product data found.")
        else:
            price = f"${result.price_text}" if result.price_text else "no price"
            self.v_status.set(f"Loaded: {result.product_name or query} — {price}")
        self._schedule_preview()

    # -- photo actions ------------------------------------------------------
    def choose_photo(self):
        path = filedialog.askopenfilename(
            title="Choose a product photo",
            filetypes=[("Images", "*.png *.jpg *.jpeg *.gif *.bmp *.webp"), ("All files", "*.*")])
        if path:
            try:
                self._photo = Image.open(path).convert("RGBA")
                self._update_thumb()
                self._schedule_preview()
            except Exception as exc:
                messagebox.showerror("Photo", f"Couldn't open that image:\n{exc}")

    def paste_photo(self):
        try:
            from PIL import ImageGrab
            data = ImageGrab.grabclipboard()
        except Exception:
            data = None
        img = None
        if isinstance(data, Image.Image):
            img = data
        elif isinstance(data, list) and data:
            try:
                img = Image.open(data[0])
            except Exception:
                img = None
        if img is None:
            messagebox.showinfo("Paste", "No image found on the clipboard.")
            return
        self._photo = img.convert("RGBA")
        self._update_thumb()
        self._schedule_preview()

    def clear_photo(self):
        self._photo = None
        self._update_thumb()
        self._schedule_preview()

    def _update_thumb(self):
        if self._photo is None:
            self.thumb.config(image="", text="—")
            self._thumb_imgtk = None
            return
        t = self._photo.copy()
        t.thumbnail((72, 72), Image.LANCZOS)
        self._thumb_imgtk = ImageTk.PhotoImage(t)
        self.thumb.config(image=self._thumb_imgtk, text="")

    # -- output -------------------------------------------------------------
    def export_pdf(self):
        spec = self._spec()
        default = "Sign"
        if spec.sku:
            default += f" {spec.sku}"
        path = filedialog.asksaveasfilename(
            title="Export PDF", defaultextension=".pdf",
            initialfile=default + ".pdf", filetypes=[("PDF", "*.pdf")])
        if not path:
            return
        try:
            render.export_pdf(spec, path, paper=self.v_paper.get())
            self.v_status.set(f"Saved {path}")
        except Exception as exc:
            messagebox.showerror("Export PDF", str(exc))

    def print_sign(self):
        spec = self._spec()
        ok, msg = render.print_sign(spec)
        if ok:
            self.v_status.set(msg)
        else:
            # Offer the PDF path as a fallback.
            if messagebox.askyesno("Print", msg + "\n\nExport a PDF to print instead?"):
                self.export_pdf()

    # -- batch queue --------------------------------------------------------
    def add_to_queue(self):
        spec = self._spec()
        self._queue.append(spec)
        label = spec.product_name or (f"SKU {spec.sku}" if spec.sku else "Untitled sign")
        price = spec.price_text.strip()
        self.queue_list.insert("end", f"{label}" + (f"  —  ${price}" if price else ""))
        self._update_queue_plan()
        self.v_status.set(f"Added to queue ({len(self._queue)} sign(s)).")

    def remove_from_queue(self):
        sel = self.queue_list.curselection()
        if not sel:
            return
        idx = sel[0]
        self.queue_list.delete(idx)
        del self._queue[idx]
        self._update_queue_plan()

    def clear_queue(self):
        self._queue.clear()
        self.queue_list.delete(0, "end")
        self._update_queue_plan()

    def _update_queue_plan(self):
        if not self._queue:
            self.queue_plan.config(text="Queue is empty.")
            return
        plan = render.gang_plan(self._queue, self.v_paper.get())
        n = len(self._queue)
        per = plan["per_page"]
        pages = plan["pages"]
        if self.v_paper.get().startswith("Exact"):
            self.queue_plan.config(text=f"{n} sign(s) · one per page · {pages} page(s)")
        else:
            self.queue_plan.config(
                text=f"{n} sign(s) · {per} per sheet · {pages} sheet(s) to print")

    def print_queue(self):
        if not self._queue:
            messagebox.showinfo("Queue", "Add some signs to the queue first.")
            return
        ok, msg = render.print_gang(self._queue, paper=self.v_paper.get())
        if ok:
            self.v_status.set(msg)
        elif messagebox.askyesno("Print", msg + "\n\nExport a PDF to print instead?"):
            self.export_queue_pdf()

    def export_queue_pdf(self):
        if not self._queue:
            messagebox.showinfo("Queue", "Add some signs to the queue first.")
            return
        path = filedialog.asksaveasfilename(
            title="Export Queue PDF", defaultextension=".pdf",
            initialfile=f"Ace Signs ({len(self._queue)}).pdf", filetypes=[("PDF", "*.pdf")])
        if not path:
            return
        try:
            render.export_gang_pdf(self._queue, path, paper=self.v_paper.get())
            self.v_status.set(f"Saved {len(self._queue)} sign(s) to {path}")
        except Exception as exc:
            messagebox.showerror("Export PDF", str(exc))

    # -- windows ------------------------------------------------------------
    def show_diagnostics(self):
        win = tk.Toplevel(self)
        win.title("Lookup Diagnostics")
        win.geometry("640x460")
        txt = tk.Text(win, wrap="word", padx=8, pady=8)
        txt.pack(fill="both", expand=True)
        if not self._diag:
            txt.insert("end", "No lookup has run yet.")
        for d in self._diag:
            mark = "[ok]  " if d.ok else "[fail]"
            txt.insert("end", f"{mark} {d.title}\n        {d.detail}\n\n")
        txt.config(state="disabled")
        bar = ttk.Frame(win); bar.pack(fill="x")
        def copy_all():
            self.clipboard_clear()
            self.clipboard_append("\n".join(
                f"{'[ok]  ' if d.ok else '[fail]'} {d.title} — {d.detail}" for d in self._diag))
        ttk.Button(bar, text="Copy All", command=copy_all).pack(side="left", padx=8, pady=6)
        ttk.Button(bar, text="Close", command=win.destroy).pack(side="right", padx=8, pady=6)

    def open_settings(self):
        win = tk.Toplevel(self)
        win.title("Settings")
        win.geometry("480x260")
        frm = ttk.Frame(win, padding=12); frm.pack(fill="both", expand=True)
        v_code = tk.StringVar(value=self.cfg.store_code)
        v_name = tk.StringVar(value=self.cfg.store_name)
        v_footer = tk.BooleanVar(value=self.cfg.show_footer)
        v_logo = tk.StringVar(value=self.cfg.logo_path)
        ttk.Label(frm, text="Ace store number").pack(anchor="w")
        ttk.Entry(frm, textvariable=v_code).pack(fill="x", pady=(0, 8))
        ttk.Label(frm, text="Store line printed on signs").pack(anchor="w")
        ttk.Entry(frm, textvariable=v_name).pack(fill="x", pady=(0, 8))
        ttk.Checkbutton(frm, text="Show SKU + store line at the bottom of signs",
                        variable=v_footer).pack(anchor="w", pady=(0, 8))
        lrow = ttk.Frame(frm); lrow.pack(fill="x")
        ttk.Label(lrow, text="Logo override (blank = built-in Ace logo):").pack(side="left")
        ttk.Button(lrow, text="Choose…",
                   command=lambda: v_logo.set(filedialog.askopenfilename(
                       filetypes=[("Images", "*.png *.jpg *.jpeg")]) or v_logo.get())
                   ).pack(side="right")
        ttk.Entry(frm, textvariable=v_logo).pack(fill="x", pady=(2, 8))

        def save():
            self.cfg.store_code = v_code.get().strip() or "12180"
            self.cfg.store_name = v_name.get()
            self.cfg.show_footer = bool(v_footer.get())
            self.cfg.logo_path = v_logo.get().strip()
            self.cfg.save()
            render._LOGO_CACHE.clear()
            self._schedule_preview()
            win.destroy()
        ttk.Button(frm, text="Save", command=save).pack(side="right", pady=(6, 0))

    def _about(self):
        messagebox.showinfo(
            "Ace Sign Studio",
            f"Ace Sign Studio for Windows {__version__}\n\n"
            "SKU → store price → photo → branded sign for Snyder's Ace Hardware.")


def main():
    app = AceSignApp()
    app.mainloop()


if __name__ == "__main__":
    main()
