/* ============================================================
   Editor: Layout & color, Extra text & pictures, Favorites.
   The render side lives in render-custom.js; this file builds the
   controls that write spec.arrange / spec.style / spec.nudge /
   spec.extras, the drag-to-move handling for extra boxes on the
   preview, and the shared favorites (synced like batches).
   ============================================================ */
"use strict";

/* Types whose layout comes from the shared product template — the ones
   the photo-left / photo-right arrangements apply to. */
const ARRANGE_TYPES = new Set([
  "regular", "sale", "percent_off", "bogo_free", "bogo_percent", "two_for", "instant_savings",
  "buy_get_off", "was_now", "final_sale", "your_choice", "arrow_up", "arrow_down", "arrow_left", "arrow_right",
]);
const ARRANGEMENTS = [
  { id: "", label: "Photo on top" },
  { id: "photo-left", label: "Photo left" },
  { id: "photo-right", label: "Photo right" },
];
const NUDGE_STEP = 0.01; // 1% of the sign per click

/* A collapsible editor section whose open/closed state is remembered. */
function editorSection(id, title, defaultOpen) {
  const d = el("details", "ed-section");
  d.id = id;
  let open = defaultOpen;
  try { const v = localStorage.getItem("acesignstudio.sec." + id); if (v != null) open = v === "open"; } catch (e) {}
  d.open = open;
  d.addEventListener("toggle", () => {
    try { localStorage.setItem("acesignstudio.sec." + id, d.open ? "open" : "closed"); } catch (e) {}
  });
  d.appendChild(el("summary", null, title));
  const body = el("div", "ed-body");
  d.appendChild(body);
  return { d, body };
}

function swatchRow(colors, current, onPick, opts) {
  const o = opts || {};
  const row = el("div", "swatches");
  for (const c of colors) {
    const id = typeof c === "string" ? c : c.id;
    const label = typeof c === "string" ? (c ? c : "None") : c.label;
    const b = el("button", "swatch" + ((current || "") === id ? " active" : "") + (id ? "" : " swatch-none"));
    b.type = "button";
    b.title = label;
    if (id) b.style.background = id;
    else b.textContent = "∅";
    b.onclick = () => onPick(id);
    row.appendChild(b);
  }
  if (o.custom) {
    const lab = el("label", "swatch swatch-custom");
    lab.title = "Pick any color";
    lab.textContent = "＋";
    const inp = el("input");
    inp.type = "color";
    inp.value = isHex(current) ? current : "#D40029";
    inp.oninput = () => onPick(inp.value.toUpperCase());
    lab.appendChild(inp);
    if (current && !colors.some((c) => (typeof c === "string" ? c : c.id) === current)) {
      lab.classList.add("active");
      lab.style.background = current;
    }
    row.appendChild(lab);
  }
  return row;
}

function segRow(options, current, onPick) {
  const row = el("div", "seg seg-sm");
  for (const opt of options) {
    const b = el("button", "seg-btn" + ((current || "") === opt.id ? " active" : ""), opt.label);
    b.type = "button";
    b.onclick = () => onPick(opt.id);
    row.appendChild(b);
  }
  return row;
}

/* ---------- Layout & color ---------- */
function buildLayoutSection(t, host) {
  const { d, body } = editorSection("secLayout", "Layout & color", false);
  const rebuild = () => { buildEditorFields(t); schedulePreview(); };
  const spec = App.spec;
  if (ARRANGE_TYPES.has(t.id)) {
    body.appendChild(labelEl("Arrangement"));
    body.appendChild(segRow(ARRANGEMENTS, spec.arrange || "", (id) => {
      if (id) spec.arrange = id; else delete spec.arrange;
      rebuild();
    }));
    body.appendChild(el("div", "f-help", spec.image ? "Where the photo sits next to the name and price." : "Side-by-side arrangements need a product photo."));
  }
  body.appendChild(labelEl("Sign color"));
  const accent = (spec.style && spec.style.accent) || "#D40029";
  body.appendChild(swatchRow(SIGN_COLORS, accent.toUpperCase(), (c) => {
    spec.style = Object.assign({}, spec.style);
    if (!c || c.toUpperCase() === "#D40029") delete spec.style.accent; else spec.style.accent = c;
    if (!Object.keys(spec.style).length) delete spec.style;
    rebuild();
  }, { custom: true }));
  body.appendChild(el("div", "f-help", "Ace Red is the brand color. Others are for seasonal or department signs; the Ace logo always stays red."));

  if (t.id !== "multi") {
    const parts = scalablesForType(t).filter((p) => !(spec.hide && spec.hide[p.key]));
    if (parts.length) {
      body.appendChild(labelEl("Move a part"));
      body.appendChild(el("div", "f-help", "Nudge a part a little at a time. The ↺ button puts it back."));
      const n = spec.nudge || {};
      for (const p of parts) {
        const row = el("div", "nudge-row");
        row.appendChild(el("span", "nudge-name", p.label));
        const cur = n[p.key] || { x: 0, y: 0 };
        const push = (dx, dy) => {
          const nn = Object.assign({}, spec.nudge);
          const c = Object.assign({ x: 0, y: 0 }, nn[p.key]);
          c.x = Math.max(-NUDGE_MAX, Math.min(NUDGE_MAX, Math.round((c.x + dx) * 100) / 100));
          c.y = Math.max(-NUDGE_MAX, Math.min(NUDGE_MAX, Math.round((c.y + dy) * 100) / 100));
          if (!c.x && !c.y) delete nn[p.key]; else nn[p.key] = c;
          if (Object.keys(nn).length) spec.nudge = nn; else delete spec.nudge;
          rebuild();
        };
        for (const [lbl, dx, dy, tip] of [["←", -NUDGE_STEP, 0, "left"], ["↑", 0, -NUDGE_STEP, "up"], ["↓", 0, NUDGE_STEP, "down"], ["→", NUDGE_STEP, 0, "right"]]) {
          const b = el("button", "nudge-btn", lbl);
          b.type = "button";
          b.title = `Move ${p.label.toLowerCase()} ${tip}`;
          b.onclick = () => push(dx, dy);
          row.appendChild(b);
        }
        const moved = cur.x || cur.y;
        const rs = el("button", "nudge-btn nudge-reset", "↺");
        rs.type = "button";
        rs.title = "Put it back";
        rs.disabled = !moved;
        rs.onclick = () => push(-cur.x, -cur.y);
        row.appendChild(rs);
        if (moved) row.appendChild(el("span", "nudge-moved", "moved"));
        body.appendChild(row);
      }
    }
  }
  const anything = spec.arrange || (spec.style && spec.style.accent) || hasNudges(spec);
  if (anything) {
    const reset = el("button", "btn btn-ghost btn-sm", "Back to the standard layout");
    reset.style.marginTop = "12px";
    reset.onclick = () => { delete spec.arrange; delete spec.style; delete spec.nudge; rebuild(); };
    body.appendChild(reset);
  }
  host.appendChild(d);
}

/* ---------- Extra text & pictures ---------- */
function newExtra(kind) {
  return kind === "image"
    ? { kind: "image", src: "", x: 0.7, y: 0.06, w: 0.24, h: 0.26 }
    : { kind: "text", text: "", weight: "black", align: "center", x: 0.2, y: 0.72, w: 0.6, h: 0.12 };
}

/* Pictures added to a sign are bounded hard: they travel inside the sign
   into the queue, batches, favorites and store sync. Keeps transparency
   (PNG) for logos/cutouts, else a compact JPEG. */
function acceptExtraPicture(file) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 700 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
        try {
          const cv = document.createElement("canvas");
          cv.width = w; cv.height = h;
          const ctx = cv.getContext("2d");
          const alpha = /^data:image\/(png|gif|webp)/.test(r.result);
          if (!alpha) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); }
          ctx.drawImage(img, 0, 0, w, h);
          resolve(alpha ? cv.toDataURL("image/png") : cv.toDataURL("image/jpeg", 0.85));
        } catch (e) { resolve(r.result); }
      };
      img.onerror = () => resolve(null);
      img.src = r.result;
    };
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });
}

function buildExtrasSection(t, host) {
  const spec = App.spec;
  const list = Array.isArray(spec.extras) ? spec.extras : [];
  const { d, body } = editorSection("secExtras", `Extra text & pictures${list.length ? ` (${list.length})` : ""}`, list.length > 0);
  const rebuild = () => { buildEditorFields(t); schedulePreview(); };
  const add = (kind) => {
    spec.extras = (Array.isArray(spec.extras) ? spec.extras : []).concat([newExtra(kind)]);
    App._focusExtra = spec.extras.length - 1;
    try { localStorage.setItem("acesignstudio.sec.secExtras", "open"); } catch (e) {}
    rebuild();
  };
  body.appendChild(el("div", "f-help", "Add your own words (like “NEW!” or “Limit 2”) or a picture. Drag a box on the preview to move it, or drag its corner dot to resize it."));
  list.forEach((x, i) => body.appendChild(buildExtraCard(t, x, i, rebuild)));
  const row = el("div", "f-row extra-add");
  const at = el("button", "btn btn-ghost btn-sm", "＋ Text box");
  at.id = "addExtraText";
  at.onclick = () => add("text");
  const ai = el("button", "btn btn-ghost btn-sm", "＋ Picture");
  ai.id = "addExtraImage";
  ai.onclick = () => add("image");
  row.appendChild(at);
  row.appendChild(ai);
  body.appendChild(row);
  host.appendChild(d);
  if (App._focusExtra != null) {
    const f = $(`.extra-card[data-extra="${App._focusExtra}"] textarea`);
    App._focusExtra = null;
    if (f) setTimeout(() => { f.focus(); f.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, 0);
  }
}

function buildExtraCard(t, x, i, rebuild) {
  const card = el("div", "extra-card");
  card.dataset.extra = String(i);
  const head = el("div", "extra-head");
  head.appendChild(el("span", "extra-title", x.kind === "image" ? `Picture ${i + 1}` : `Text box ${i + 1}`));
  const rm = el("button", "q-btn", "✕");
  rm.title = "Remove it from the sign";
  rm.onclick = () => { App.spec.extras.splice(i, 1); if (!App.spec.extras.length) delete App.spec.extras; rebuild(); };
  head.appendChild(rm);
  card.appendChild(head);
  const live = () => schedulePreview();

  if (x.kind === "image") {
    const drop = el("div", "img-drop");
    drop.innerHTML = `<img style="${x.src ? "" : "display:none"}" src="${x.src ? esc(x.src) : ""}"><div class="img-note">${x.src ? "Click to swap the picture." : "Click to choose a picture, or drag one here."}</div>`;
    const file = el("input");
    file.type = "file";
    file.accept = "image/*";
    file.style.display = "none";
    drop.appendChild(file);
    const take = async (fl) => {
      if (!fl || !/^image\//.test(fl.type)) return;
      const src = await acceptExtraPicture(fl);
      if (src) { x.src = src; rebuild(); }
    };
    drop.onclick = () => file.click();
    file.onchange = () => { take(file.files && file.files[0]); file.value = ""; };
    drop.addEventListener("dragover", (e) => e.preventDefault());
    drop.addEventListener("drop", (e) => { e.preventDefault(); take(e.dataTransfer.files && e.dataTransfer.files[0]); });
    card.appendChild(drop);
  } else {
    const ta = el("textarea", "f-textarea extra-text");
    ta.rows = 2;
    ta.placeholder = "Type here. Press Enter for a new line.";
    ta.value = x.text || "";
    ta.oninput = () => { x.text = ta.value; live(); };
    card.appendChild(ta);
    card.appendChild(labelEl("Font"));
    card.appendChild(segRow([{ id: "regular", label: "Regular" }, { id: "bold", label: "Bold" }, { id: "black", label: "Heavy" }],
      x.weight || "black", (v) => { x.weight = v; rebuild(); }));
    card.appendChild(labelEl("Text color"));
    card.appendChild(swatchRow(EXTRA_TEXT_COLORS, x.color || "", (c) => { x.color = c; rebuild(); }, { custom: true }));
    card.appendChild(labelEl("Line up"));
    card.appendChild(segRow([{ id: "left", label: "Left" }, { id: "center", label: "Center" }, { id: "right", label: "Right" }],
      x.align || "center", (v) => { x.align = v; rebuild(); }));
    card.appendChild(labelEl("Text size"));
    const sz = el("input", "scale-slider");
    sz.type = "range"; sz.min = "30"; sz.max = "100"; sz.step = "5";
    sz.value = String(Math.round((x.scale || 1) * 100));
    sz.title = "100% fills the box";
    sz.oninput = () => { x.scale = parseInt(sz.value, 10) / 100; live(); };
    card.appendChild(sz);
  }
  card.appendChild(labelEl("Background"));
  card.appendChild(swatchRow(EXTRA_BG_COLORS, x.bg || "", (c) => { x.bg = c; rebuild(); }, { custom: true }));

  // placement: float on top, or make room along an edge
  const mr = el("label", "f-check");
  const cb = el("input");
  cb.type = "checkbox";
  cb.checked = !!x.dock;
  cb.onchange = () => { x.dock = cb.checked ? (x.kind === "image" ? "right" : "top") : ""; rebuild(); };
  mr.appendChild(cb);
  mr.appendChild(document.createTextNode("Make room for it (the rest of the sign moves over)"));
  card.appendChild(mr);
  if (x.dock) {
    card.appendChild(segRow([{ id: "top", label: "Top" }, { id: "bottom", label: "Bottom" }, { id: "left", label: "Left" }, { id: "right", label: "Right" }],
      x.dock, (v) => { x.dock = v; rebuild(); }));
    card.appendChild(labelEl("Space it takes"));
    const band = el("input", "scale-slider");
    band.type = "range"; band.min = "8"; band.max = "45"; band.step = "1";
    band.value = String(Math.round((x.band || (x.dock === "top" || x.dock === "bottom" ? 0.2 : 0.3)) * 100));
    band.oninput = () => { x.band = parseInt(band.value, 10) / 100; live(); };
    card.appendChild(band);
  } else {
    card.appendChild(el("div", "f-help", "Floating on top of the sign. Drag it on the preview to move it; drag the corner dot to resize."));
  }
  return card;
}

/* ---------- drag to move / resize extra boxes on the preview ---------- */
function attachExtrasDrag(svg) {
  const groups = Array.from(svg.querySelectorAll("g[data-extra]"));
  if (!groups.length) return;
  const size = sizeById(App.sizeId);
  const vb = svg.viewBox.baseVal;
  const cutPx = (size.cut || 0) * PPI;
  const bodyW = vb.width - 2 * cutPx, bodyH = vb.height - 2 * cutPx;
  for (const g of groups) {
    const i = parseInt(g.dataset.extra, 10);
    const x = App.spec.extras && App.spec.extras[i];
    if (!x) continue;
    g.style.cursor = x.dock ? "pointer" : "move";
    g.addEventListener("click", (e) => {
      if (_swallowClick) return;
      e.stopPropagation();
      focusExtraCard(i);
    });
    if (x.dock) continue;
    // corner handle (preview only, never printed)
    const bb = g.getBBox();
    const rx = cutPx + x.x * bodyW + x.w * bodyW, ry = cutPx + x.y * bodyH + x.h * bodyH;
    const k = vb.width / (svg.getBoundingClientRect().width || 1);
    const h = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    h.setAttribute("cx", rx); h.setAttribute("cy", ry); h.setAttribute("r", 7 * k);
    h.setAttribute("fill", "#fff"); h.setAttribute("stroke", "#D40029"); h.setAttribute("stroke-width", 2.5 * k);
    h.setAttribute("class", "extra-handle");
    h.style.cursor = "nwse-resize";
    svg.appendChild(h);
    const outline = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    outline.setAttribute("x", cutPx + x.x * bodyW); outline.setAttribute("y", cutPx + x.y * bodyH);
    outline.setAttribute("width", x.w * bodyW); outline.setAttribute("height", x.h * bodyH);
    outline.setAttribute("fill", "none"); outline.setAttribute("stroke", "#D40029");
    outline.setAttribute("stroke-dasharray", `${6 * k} ${4 * k}`); outline.setAttribute("stroke-width", 1.2 * k);
    outline.setAttribute("pointer-events", "none");
    outline.setAttribute("class", "extra-outline");
    svg.insertBefore(outline, h);
    // the outline brightens while the box is hovered or dragged (the
    // preview redraws every frame of a drag, so the drag state is kept)
    if (App._extraDragging && App._extraDragIdx === i) outline.classList.add("hot");
    g.addEventListener("pointerenter", () => outline.classList.add("hot"));
    g.addEventListener("pointerleave", () => { if (!App._extraDragging) outline.classList.remove("hot"); });
    void bb;
    const startDrag = (e, mode) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const sx = e.clientX, sy = e.clientY;
      const start = { x: x.x, y: x.y, w: x.w, h: x.h };
      const scr = svg.getBoundingClientRect();
      const fx = (vb.width / scr.width) / bodyW, fy = (vb.height / scr.height) / bodyH;
      let moved = false;
      const move = (ev) => {
        const dx = (ev.clientX - sx) * fx, dy = (ev.clientY - sy) * fy;
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
        moved = true;
        App._extraDragging = true;
        App._extraDragIdx = i;
        if (mode === "move") {
          x.x = Math.max(-0.1, Math.min(1 - x.w * 0.3, start.x + dx));
          x.y = Math.max(-0.1, Math.min(1 - x.h * 0.3, start.y + dy));
        } else {
          x.w = Math.max(0.05, Math.min(1.2, start.w + dx));
          x.h = Math.max(0.04, Math.min(1.2, start.h + dy));
        }
        x.x = Math.round(x.x * 1000) / 1000; x.y = Math.round(x.y * 1000) / 1000;
        x.w = Math.round(x.w * 1000) / 1000; x.h = Math.round(x.h * 1000) / 1000;
        schedulePreview();
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        App._extraDragging = false;
        App._extraDragIdx = -1;
        if (moved) { _swallowClick = true; setTimeout(() => { _swallowClick = false; }, 0); }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    };
    g.addEventListener("pointerdown", (e) => startDrag(e, "move"));
    h.addEventListener("pointerdown", (e) => startDrag(e, "size"));
  }
}

function focusExtraCard(i) {
  const sec = $("#secExtras");
  if (sec && !sec.open) sec.open = true;
  const card = $(`.extra-card[data-extra="${i}"]`);
  if (!card) return;
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  card.classList.add("field-flash");
  setTimeout(() => card.classList.remove("field-flash"), 1400);
  const ta = card.querySelector("textarea");
  if (ta) ta.focus({ preventScroll: true });
}

/* ---------- favorites (shared through store sync) ----------
   A favorite remembers how a sign looks, not what it's selling: type,
   size and every layout/style choice, without SKU, name, prices or the
   product photo. Applying one keeps the product already in the editor. */
const PRODUCT_KEYS = ["sku", "name", "detail", "price", "regPrice", "savings", "percent", "qty", "category",
  "image", "_customImage", "productUrl", "lookedUpAt", "startDate", "endDate", "_scaleSku", "_savingsManual"];

function layoutOf(spec) {
  const out = JSON.parse(JSON.stringify(spec || {}));
  for (const k of PRODUCT_KEYS) delete out[k];
  if (Array.isArray(out.products)) out.products = out.products.map((p) => ({ typeId: p.typeId, spec: layoutOf(p.spec) }));
  return out;
}

const Favorites = {
  data: {}, // name -> {typeId, sizeId, spec, savedAt} | {deletedAt}
  names() {
    return Object.keys(this.data).filter((n) => this.data[n] && this.data[n].typeId)
      .sort((a, b) => a.localeCompare(b));
  },
  save(name, typeId, sizeId, spec) {
    this.data[name] = { typeId, sizeId, spec: layoutOf(spec), savedAt: new Date().toISOString() };
    persistState();
  },
  remove(name) {
    this.data[name] = { deletedAt: new Date().toISOString() };
    persistState();
  },
};

/* Put a favorite's look onto the sign in the editor (or a new sign). */
function applyFavorite(name) {
  const f = Favorites.data[name];
  if (!f || !typeById(f.typeId)) return;
  const product = {};
  for (const k of PRODUCT_KEYS) if (App.spec && App.spec[k] != null) product[k] = App.spec[k];
  const look = JSON.parse(JSON.stringify(f.spec || {}));
  App.sizeId = f.sizeId || App.sizeId;
  if (f.typeId === "multi") {
    App.spec = { products: (look.products || []).map((p) => ({ typeId: p.typeId, spec: Object.assign({}, p.spec) })) };
    delete look.products;
    Object.assign(App.spec, look);
  } else {
    App.spec = Object.assign({ startDate: App.batchStart, endDate: App.batchEnd }, look, product);
  }
  const keepEdit = App.editingUid;
  showEditor(f.typeId);
  App.editingUid = keepEdit;
  App.sizeId = f.sizeId || App.sizeId;
  buildSizeChips(typeById(f.typeId));
  updateEditMode();
  schedulePreview();
  EditorHistory.reset();
  showToast(`Applied favorite “${name}”.`, { kind: "ok" });
}

function showFavoritesMenu(anchor) {
  closeBatchPickMenu();
  const menu = el("div", "pick-menu fav-menu");
  menu.onclick = (e) => e.stopPropagation();
  menu.appendChild(el("div", "pick-head", "Favorites — shared with the store"));
  const names = Favorites.names();
  if (!names.length) menu.appendChild(el("div", "pick-empty", "No favorites yet. Set a sign up the way you like it, then save it below."));
  for (const n of names) {
    const f = Favorites.data[n];
    const t = typeById(f.typeId);
    const row = el("div", "pick-row");
    const b = el("button", "pick-item", n);
    b.title = `${t ? menuLabel(t) : f.typeId} · ${sizeById(f.sizeId).label}`;
    b.onclick = () => { closeBatchPickMenu(); applyFavorite(n); };
    const del = el("button", "q-btn", "✕");
    del.title = "Delete this favorite (for every computer)";
    del.onclick = () => {
      const keep = Favorites.data[n];
      Favorites.remove(n);
      showFavoritesMenu(anchor);
      showToast(`Deleted favorite “${n}”.`, { undo: () => { Favorites.data[n] = Object.assign({}, keep, { savedAt: new Date().toISOString() }); persistState(); } });
    };
    row.appendChild(b);
    row.appendChild(del);
    menu.appendChild(row);
  }
  const saveRow = el("div", "pick-save");
  const inp = el("input", "f-input");
  inp.placeholder = "Save this sign's look as…";
  inp.id = "favName";
  const save = el("button", "btn btn-primary btn-sm", "Save");
  save.onclick = () => {
    const n = inp.value.trim();
    if (!n) { inp.focus(); return; }
    const existed = Favorites.names().includes(n);
    Favorites.save(n, App.typeId, App.sizeId, App.spec);
    closeBatchPickMenu();
    showToast(existed ? `Updated favorite “${n}”.` : `Saved favorite “${n}” — every store computer will have it.`, { kind: "ok" });
    if (App.view === "gallery") showGallery();
  };
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") save.onclick(); });
  saveRow.appendChild(inp);
  saveRow.appendChild(save);
  menu.appendChild(saveRow);
  document.body.appendChild(menu);
  _pickMenuEl = menu;
  const r = anchor.getBoundingClientRect();
  menu.style.top = Math.max(8, Math.min(window.innerHeight - menu.offsetHeight - 8, r.bottom + 4)) + "px";
  menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, r.left)) + "px";
  setTimeout(() => document.addEventListener("click", closeBatchPickMenu, { once: true }), 0);
  setTimeout(() => inp.focus(), 0);
}

/* Gallery strip: the store's favorites, one click to start a sign. */
function buildFavoritesStrip(host) {
  const names = Favorites.names();
  if (!names.length) return;
  const wrap = el("div", "fav-strip");
  wrap.appendChild(el("div", "fav-strip-head", "★ Store favorites"));
  const row = el("div", "fav-strip-row");
  for (const n of names) {
    const f = Favorites.data[n];
    const t = typeById(f.typeId);
    if (!t) continue;
    const b = el("button", "fav-chip");
    b.style.setProperty("--i", String(Math.min(row.childElementCount, 8))); // chips rise in one after another
    b.innerHTML = `<b>${esc(n)}</b><span>${esc(menuLabel(t))} · ${esc(sizeById(f.sizeId).label)}</span>`;
    b.onclick = () => { App.spec = {}; applyFavorite(n); };
    row.appendChild(b);
  }
  wrap.appendChild(row);
  host.appendChild(wrap);
}

/* What the strip currently shows, so a refresh that changes nothing does
   nothing. */
function favStripSig() {
  return Favorites.names().filter((n) => typeById(Favorites.data[n].typeId))
    .map((n) => [n, Favorites.data[n].typeId, Favorites.data[n].sizeId].join("|")).join("\n");
}

/* Bring the gallery's favorites strip up to date without rebuilding the
   gallery (at launch, once the saved state has loaded, and after a sync
   brings new ones): the strip opens smoothly the first time, and a new
   favorite pops in. Chips are clickable throughout. */
function refreshFavStrip() {
  if (App.view !== "gallery") return;
  const host = $("#favStrip");
  if (!host) return;
  const sig = favStripSig();
  if (host.dataset.sig === sig && host.firstChild) return; // nothing changed
  if (!sig && !host.firstChild) { host.dataset.sig = sig; return; }
  const before = new Set([...host.querySelectorAll(".fav-chip b")].map((b) => b.textContent));
  const had = !!host.firstChild;
  const ae = document.activeElement;
  const f = host.contains(ae) && ae.querySelector && ae.querySelector("b");
  const focusName = f ? f.textContent : null;
  host.innerHTML = "";
  buildFavoritesStrip(host);
  host.dataset.sig = sig;
  const strip = host.firstChild;
  if (!strip) return;
  for (const c of strip.querySelectorAll(".fav-chip")) {
    const n = c.querySelector("b").textContent;
    if (had && before.has(n)) c.style.animation = "none"; // already on screen: no replay
    else if (had) c.classList.add("fav-new");
    if (n === focusName) c.focus({ preventScroll: true });
  }
  if (!had && previewMotionOK()) {
    // open the strip, so the cards below glide down instead of jumping
    const h = strip.offsetHeight;
    strip.animate(
      [{ maxHeight: "0px", opacity: 0, marginBottom: "0px", overflow: "hidden" },
       { maxHeight: h + "px", opacity: 1, marginBottom: "16px", overflow: "hidden" }],
      { duration: 240, easing: "cubic-bezier(.22,.8,.24,1)" });
  }
}

/* Sync merge for favorites: per name, newest savedAt/deletedAt wins;
   deletions are tombstones (pruned after 60 days) so another computer's
   older copy can't bring a deleted favorite back. */
function mergeFavorites(remoteFavs) {
  let changedLocal = false, changedRemote = false;
  const stamp = (f) => Math.max(Date.parse((f && f.savedAt) || 0) || 0, Date.parse((f && f.deletedAt) || 0) || 0);
  const cutoff = Date.now() - 60 * 86400000;
  const rf = remoteFavs && typeof remoteFavs === "object" ? remoteFavs : {};
  const lf = Favorites.data;
  const merged = {};
  for (const n of new Set([...Object.keys(lf), ...Object.keys(rf)])) {
    const l = lf[n], r = rf[n];
    let w;
    if (!r) { w = l; changedRemote = true; }
    else if (!l) { w = r; changedLocal = true; }
    else if (stamp(l) > stamp(r)) { w = l; changedRemote = true; }
    else if (stamp(r) > stamp(l)) { w = r; changedLocal = true; }
    else w = l;
    if (w && !w.typeId && (Date.parse(w.deletedAt || 0) || 0) < cutoff) { if (r) changedRemote = true; continue; }
    merged[n] = w;
  }
  Favorites.data = merged;
  return { changedLocal, changedRemote, merged };
}
