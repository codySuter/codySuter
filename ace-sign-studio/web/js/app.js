/* ============================================================
   Ace Sign Studio — UI controller: nav, gallery, editors, preview,
   queue rail, sheet previews, print/export, bulk add, settings.
   ============================================================ */
"use strict";

const App = {
  view: "gallery",       // gallery | editor
  typeId: null,
  sizeId: "letter-l",
  spec: {},              // editor working spec
  userPickedType: false,
  batchStart: "",
  batchEnd: "",
  _previewSeq: 0,
};

/* ---------------- boot ---------------- */
window.addEventListener("DOMContentLoaded", async () => {
  startHeartbeat();
  await restoreState();
  buildNav();
  renderQueue();
  showGallery();
  ensureFontsLoaded().then(() => {
    buildNavThumbs();
    buildGalleryThumbs();
  });
  loadTemplateProduct();
  $("#settingsBtn").onclick = openSettings;
  $("#homeBtn").onclick = showGallery;
  $("#clearQueueBtn").onclick = () => { if (confirm("Clear the whole queue?")) Queue.clear(); };
  $("#printAllBtn").onclick = () => exportQueue(true);
  $("#exportAllBtn").onclick = () => exportQueue(false);
  $("#storeLineTop").textContent = Settings.get().storeLine || "Snyder's Ace Hardware";
  initBulk();
  window.addEventListener("resize", () => schedulePreview()); // re-scale preview to the new window
  $$(".modal-back").forEach((mb) => {
    mb.addEventListener("click", (e) => { if (e.target === mb) mb.classList.remove("show"); });
  });
  $$(".modal-close").forEach((b) => (b.onclick = () => b.closest(".modal-back").classList.remove("show")));
});

function startHeartbeat() {
  setInterval(() => { fetch("/__ping").catch(() => {}); }, 2000);
}

/* ---------------- nav ---------------- */
function buildNav() {
  const nav = $("#nav");
  nav.innerHTML = "";
  const groups = [...new Set(SIGN_TYPES.map((t) => t.group))];
  const sec = (title) => {
    const s = el("div", "nav-section");
    s.appendChild(el("div", "nav-head", title));
    nav.appendChild(s);
    return s;
  };
  const home = sec("Ace Sign Studio");
  const homeBtn = el("button", "nav-item");
  homeBtn.innerHTML = `<div class="nav-thumb">🏠</div><div><div class="nav-label">All sign types</div><div class="nav-note">Gallery & previews</div></div>`;
  homeBtn.onclick = showGallery;
  homeBtn.id = "nav-home";
  home.appendChild(homeBtn);

  for (const g of groups) {
    const s = sec(g);
    for (const t of SIGN_TYPES.filter((x) => x.group === g)) {
      const b = el("button", "nav-item");
      b.dataset.type = t.id;
      b.innerHTML = `<div class="nav-thumb" id="thumb-${t.id}"></div><div><div class="nav-label">${esc(t.label)}</div><div class="nav-note">${esc(t.note || "")}</div></div>`;
      b.onclick = () => showEditor(t.id);
      s.appendChild(b);
    }
  }
}

function markActiveNav() {
  $$(".nav-item").forEach((b) => b.classList.remove("active"));
  if (App.view === "gallery") $("#nav-home") && $("#nav-home").classList.add("active");
  else if (App.typeId) { const b = $(`.nav-item[data-type="${App.typeId}"]`); b && b.classList.add("active"); }
}

/* Small sample SVG thumbnails in nav + gallery. */
async function typeThumbSVG(t, boxW, boxH) {
  try {
    const spec = t.sample;
    const w = 11, h = 8.5;
    const svg = await t.render(Object.assign({}, spec), w, h);
    const scale = Math.min(boxW / (w * PPI), boxH / (h * PPI));
    return svg.replace(/^<svg /, `<svg style="width:${w * PPI * scale}px;height:${h * PPI * scale}px" `);
  } catch (e) {
    return "";
  }
}

async function buildNavThumbs() {
  for (const t of SIGN_TYPES) {
    const holder = $(`#thumb-${t.id}`);
    if (holder) holder.innerHTML = await typeThumbSVG(t, 50, 34);
  }
}

/* Load the gallery template product (default SKU 81995): cached copy first,
   then a live lookup so previews show the real store photo and price. */
async function loadTemplateProduct() {
  const sku = (Settings.get().templateSku || "81995").trim();
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem("acesignstudio.template.v1") || "null"); } catch (e) {}
  if (cached && cached.sku === sku && cached.image) {
    applyTemplateProduct(cached);
    refreshTypeThumbs();
  }
  try {
    const res = await fetch(`/api/lookup?q=${encodeURIComponent(sku)}&store=${encodeURIComponent(Settings.get().storeCode || "12180")}`).then((r) => r.json());
    if (res.ok && (res.name || res.imageUrl)) {
      let image = TEMPLATE_FALLBACK.image;
      if (res.imageUrl) {
        try { image = await toDataURI(res.imageUrl); } catch (e) {}
      }
      const t = {
        sku,
        name: res.name || TEMPLATE_FALLBACK.name,
        price: res.price || res.listPrice || TEMPLATE_FALLBACK.price,
        salePrice: res.salePrice || "",
        image,
      };
      try { localStorage.setItem("acesignstudio.template.v1", JSON.stringify(t)); } catch (e) {}
      applyTemplateProduct(t);
      refreshTypeThumbs();
    }
  } catch (e) { /* offline — fallback/cached template stays */ }
}

function refreshTypeThumbs() {
  ensureFontsLoaded().then(async () => {
    for (const t of SIGN_TYPES) {
      const holder = $(`#thumb-${t.id}`);
      if (holder) holder.innerHTML = await typeThumbSVG(t, 50, 34);
      const g = $(`#g-prev-${t.id}`);
      if (g) g.innerHTML = await typeThumbSVG(t, 190, 100);
    }
  });
}

/* ---------------- gallery ---------------- */
function showGallery() {
  App.view = "gallery";
  markActiveNav();
  const work = $("#work");
  work.innerHTML = `
    <div class="work-inner">
      <div class="gallery-head">
        <h2>What are we making today?</h2>
        <p>Pick a sign type — live pricing fills in automatically from acehardware.com for store #${esc(Settings.get().storeCode)}. Every sign can go to the print queue.</p>
      </div>
      <div class="gallery" id="gallery"></div>
    </div>`;
  const g = $("#gallery");
  for (const t of SIGN_TYPES) {
    const card = el("button", "g-card");
    card.innerHTML = `<div class="g-prev" id="g-prev-${t.id}"></div><div class="g-label">${esc(t.label)}</div><div class="g-note">${esc(t.note || "")}</div>`;
    card.onclick = () => showEditor(t.id);
    g.appendChild(card);
  }
  buildGalleryThumbs();
}

async function buildGalleryThumbs() {
  if (App.view !== "gallery") return;
  await ensureFontsLoaded();
  for (const t of SIGN_TYPES) {
    const holder = $(`#g-prev-${t.id}`);
    if (holder && !holder.firstChild) holder.innerHTML = await typeThumbSVG(t, 190, 100);
  }
}

/* ---------------- Ace editor ---------------- */
function showEditor(typeId) {
  const t = typeById(typeId);
  if (!t) return;
  App.view = "editor";
  App.typeId = typeId;
  App.userPickedType = true;
  if (!t.sizes && !SIZES.some((s) => s.id === App.sizeId)) App.sizeId = "letter-l";
  if (t.sizes && !t.sizes.includes(App.sizeId)) App.sizeId = t.defaultSize;
  // keep shared fields (sku/name/image/price) when switching types
  const keep = App.spec || {};
  App.spec = Object.assign({ startDate: App.batchStart, endDate: App.batchEnd }, keep);
  markActiveNav();

  const work = $("#work");
  work.innerHTML = `
    <div class="work-inner">
      <div class="editor-grid">
        <div class="card">
          <div class="card-head"><h2>${esc(t.label)}</h2><span class="hint">${esc(t.note || "")}</span></div>
          <div class="card-body" id="editorFields"></div>
        </div>
        <div class="card preview-card">
          <div class="card-head">
            <h2>Preview</h2>
            <div class="size-chips" id="sizeChips" style="margin-left:auto"></div>
          </div>
          <div class="preview-stage"><div class="sign-holder" id="signHolder"></div></div>
          <div class="preview-meta" id="previewMeta"></div>
          <div class="card-body" style="padding-top:0">
            <div class="actions" style="margin-top:0">
              <button class="btn btn-primary" id="addQueueBtn">＋ Add to Queue</button>
              <button class="btn btn-secondary" id="printOneBtn">Print</button>
              <button class="btn btn-secondary" id="pdfOneBtn">PDF</button>
            </div>
            <div class="msg" id="editorMsg"></div>
          </div>
        </div>
      </div>
    </div>`;
  buildSizeChips(t);
  buildEditorFields(t);
  $("#addQueueBtn").onclick = () => {
    const err = validateSpec(t, App.spec);
    if (err) return showMsg("editorMsg", "err", err);
    Queue.add(t.id, App.sizeId, currentRenderSpec());
    showMsg("editorMsg", "ok", `Added to queue — ${Queue.items.length} sign${Queue.items.length === 1 ? "" : "s"} queued.`);
  };
  $("#printOneBtn").onclick = async () => {
    const err = validateSpec(t, App.spec);
    if (err) return showMsg("editorMsg", "err", err);
    showMsg("editorMsg", "ok", "Preparing print…");
    try {
      const doc = await signToPdf({ typeId: t.id, sizeId: App.sizeId, spec: currentRenderSpec() });
      printPdfDoc(doc);
      showMsg("editorMsg", "ok", "Sent to the print dialog.");
    } catch (e) { showMsg("editorMsg", "err", "Print failed: " + e.message); }
  };
  $("#pdfOneBtn").onclick = async () => {
    const err = validateSpec(t, App.spec);
    if (err) return showMsg("editorMsg", "err", err);
    showMsg("editorMsg", "ok", "Building PDF…");
    try {
      const doc = await signToPdf({ typeId: t.id, sizeId: App.sizeId, spec: currentRenderSpec() });
      downloadPdfDoc(doc, sanitizeFilename(queueItemTitle({ typeId: t.id, spec: App.spec })) + ".pdf");
      showMsg("editorMsg", "ok", "PDF saved.");
    } catch (e) { showMsg("editorMsg", "err", "PDF failed: " + e.message); }
  };
  schedulePreview();
}

function currentRenderSpec() {
  const spec = Object.assign({}, App.spec);
  const hide = spec.hide;
  delete spec.hide;
  return applyHiddenFields(spec, hide);
}

function validateSpec(t, spec) {
  const hidden = (f) => !!(spec.hide && spec.hide[f]);
  const need = (f) => !hidden(f) && t.fields.some((x) => x.key === f);
  if (need("name") && !String(spec.name || "").trim() && t.id !== "under_amount") return "Enter a product name (or look up a SKU).";
  if (need("price") && !String(spec.price || "").trim()) return "Enter a price.";
  if (need("percent") && !String(spec.percent || "").trim()) return "Enter the percent off.";
  if (need("savings") && !String(spec.savings || "").trim()) return "Enter the savings amount.";
  if (need("category") && !String(spec.category || "").trim()) return "Enter the category name.";
  if (t.id === "was_now" && !String(spec.regPrice || "").trim()) return "Enter the was price.";
  return null;
}

function buildSizeChips(t) {
  const wrap = $("#sizeChips");
  wrap.innerHTML = "";
  for (const s of sizesForType(t)) {
    const c = el("button", "size-chip" + (s.id === App.sizeId ? " active" : ""), s.label.replace(/"$/, "″"));
    c.onclick = () => { App.sizeId = s.id; buildSizeChips(t); schedulePreview(); };
    wrap.appendChild(c);
  }
}

function buildEditorFields(t) {
  const host = $("#editorFields");
  host.innerHTML = "";
  for (const f of t.fields) {
    if (f.kind === "sku") {
      host.appendChild(labelEl(f.label));
      const inp = inputEl("text", App.spec.sku || "", "e.g. 7135975 — or paste a product URL");
      const status = el("div", "lookup-status");
      inp.addEventListener("input", () => { App.spec.sku = onlyDigitsMaybe(inp.value); });
      attachAutoLookup(inp, status, (res, si) => {
        App.spec.sku = res.sku || inp.value.trim();
        if (res.name) setField("name", res.name);
        if (si.onSale) {
          setField("price", si.sale);
          setField("regPrice", si.reg);
          if (t.id === "regular") {
            switchTypeKeepingSpec("sale");
            const st = $("#editorFields .lookup-status");
            if (st) {
              st.className = "lookup-status ok";
              st.innerHTML = `✓ ${esc(res.name || res.sku)} <span class="sale-flag">On Sale</span> — switched to a Sale sign <span class="diag-link" onclick="showDiagnostics()">details</span>`;
            }
          }
        } else {
          if (res.price) setField("price", res.price);
          else if (res.listPrice) setField("price", res.listPrice);
          // a fresh non-sale lookup means any earlier reg price is stale
          if (t.fields.some((x) => x.key === "regPrice") && t.id !== "was_now") setField("regPrice", "");
        }
        if (res.imageUrl) { App.spec.image = res.imageUrl; refreshImageDrop(); }
        schedulePreview();
      });
      host.appendChild(inp);
      host.appendChild(status);
      continue;
    }
    if (f.kind === "image") {
      host.appendChild(labelEl(f.label));
      const drop = el("div", "img-drop");
      drop.id = "imgDrop";
      drop.innerHTML = `<img id="imgPrev" style="display:none"><div class="img-note" id="imgNote">Auto-fetched on SKU lookup.<br>Click to use your own photo, or drag one here.</div><button class="img-clear" id="imgClear" title="Remove photo" style="display:none">✕</button>`;
      const file = el("input");
      file.type = "file";
      file.accept = "image/*";
      file.style.display = "none";
      drop.appendChild(file);
      drop.onclick = (e) => { if (e.target.id !== "imgClear") file.click(); };
      file.onchange = () => {
        const fl = file.files && file.files[0];
        if (!fl) return;
        const r = new FileReader();
        r.onload = () => { App.spec.image = r.result; App.spec._customImage = true; refreshImageDrop(); schedulePreview(); };
        r.readAsDataURL(fl);
        file.value = "";
      };
      drop.addEventListener("dragover", (e) => { e.preventDefault(); });
      drop.addEventListener("drop", (e) => {
        e.preventDefault();
        const fl = e.dataTransfer.files && e.dataTransfer.files[0];
        if (!fl || !/^image\//.test(fl.type)) return;
        const r = new FileReader();
        r.onload = () => { App.spec.image = r.result; App.spec._customImage = true; refreshImageDrop(); schedulePreview(); };
        r.readAsDataURL(fl);
      });
      host.appendChild(drop);
      setTimeout(refreshImageDrop, 0);
      $("#imgDrop").querySelector("#imgClear").onclick = () => { App.spec.image = null; App.spec._customImage = false; refreshImageDrop(); schedulePreview(); };
      continue;
    }
    if (f.kind === "dates") {
      host.appendChild(labelEl("Sale dates (prints as a red pill — leave blank for none)"));
      const row = el("div", "f-row");
      const s = inputEl("date", App.spec.startDate || "");
      const e2 = inputEl("date", App.spec.endDate || "");
      const clr = el("button", "btn btn-ghost btn-sm", "Clear");
      s.onchange = () => {
        App.spec.startDate = s.value;
        if (s.value && (!e2.value || e2.value < s.value)) { e2.value = plusDaysISO(s.value, 7); App.spec.endDate = e2.value; }
        App.batchStart = s.value; App.batchEnd = e2.value;
        schedulePreview();
      };
      e2.onchange = () => { App.spec.endDate = e2.value; App.batchEnd = e2.value; schedulePreview(); };
      clr.onclick = () => { s.value = ""; e2.value = ""; App.spec.startDate = ""; App.spec.endDate = ""; schedulePreview(); };
      row.appendChild(s); row.appendChild(e2); row.appendChild(clr);
      host.appendChild(row);
      continue;
    }
    if (f.kind === "check") {
      const lab = el("label", "f-check");
      const cb = el("input");
      cb.type = "checkbox";
      if (App.spec[f.key] == null && f.def != null) App.spec[f.key] = f.def;
      cb.checked = !!App.spec[f.key];
      cb.onchange = () => { App.spec[f.key] = cb.checked; schedulePreview(); };
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(f.label));
      host.appendChild(lab);
      continue;
    }
    host.appendChild(labelEl(f.label));
    let wrap = null, inp;
    if (f.kind === "money") {
      wrap = el("div", "prefix-wrap");
      wrap.dataset.prefix = "$";
      inp = inputEl("text", App.spec[f.key] != null ? App.spec[f.key] : (f.def != null ? f.def : ""));
    } else if (f.kind === "percent") {
      wrap = el("div", "suffix-wrap");
      wrap.dataset.suffix = "%";
      inp = inputEl("text", App.spec[f.key] || "");
    } else if (f.kind === "int") {
      inp = inputEl("number", App.spec[f.key] != null ? App.spec[f.key] : f.def || 2);
      inp.min = "2"; inp.max = "9";
    } else if (f.kind === "textarea") {
      inp = el("textarea", "f-textarea");
      inp.value = App.spec[f.key] || "";
    } else {
      if (App.spec[f.key] == null && f.def != null) App.spec[f.key] = f.def;
      inp = inputEl("text", App.spec[f.key] || "");
    }
    inp.dataset.field = f.key;
    inp.addEventListener("input", () => { App.spec[f.key] = inp.value; schedulePreview(); });
    if (wrap) { wrap.appendChild(inp); host.appendChild(wrap); }
    else host.appendChild(inp);
  }
  buildToggleChips(t, host);
}

function buildToggleChips(t, host) {
  const toggles = togglesForType(t);
  if (!toggles.length) return;
  let wrap = $("#toggleWrap", host);
  if (!wrap) {
    wrap = el("div");
    wrap.id = "toggleWrap";
    host.appendChild(wrap);
  }
  wrap.innerHTML = "";
  wrap.appendChild(labelEl("Show on sign — click to hide an element"));
  const row = el("div", "size-chips");
  if (!App.spec.hide) App.spec.hide = {};
  for (const tg of toggles) {
    const on = !App.spec.hide[tg.key];
    const c = el("button", "size-chip" + (on ? " active" : ""), (on ? "✓ " : "✕ ") + tg.label);
    c.onclick = () => {
      App.spec.hide[tg.key] = !App.spec.hide[tg.key];
      buildToggleChips(t, host);
      schedulePreview();
    };
    row.appendChild(c);
  }
  wrap.appendChild(row);
}

function labelEl(text) { return el("label", "f-label", text); }
function inputEl(type, value, placeholder) {
  const i = el("input", "f-input");
  i.type = type;
  if (value != null) i.value = value;
  if (placeholder) i.placeholder = placeholder;
  return i;
}
function onlyDigitsMaybe(v) {
  const t = String(v || "").trim();
  return /^\d+$/.test(t) ? t : t;
}
function setField(key, value) {
  App.spec[key] = value;
  const inp = $(`#editorFields [data-field="${key}"]`);
  if (inp) inp.value = value;
}
function refreshImageDrop() {
  const prev = $("#imgPrev"), note = $("#imgNote"), clear = $("#imgClear");
  if (!prev) return;
  if (App.spec.image) {
    const src = /^https?:\/\//.test(App.spec.image) ? `/api/img?u=${encodeURIComponent(App.spec.image)}` : App.spec.image;
    prev.src = src;
    prev.style.display = "";
    clear.style.display = "";
    note.innerHTML = App.spec._customImage ? "Using your custom photo." : "Photo from acehardware.com.<br>Click to replace, or drag a new one here.";
  } else {
    prev.style.display = "none";
    clear.style.display = "none";
    note.innerHTML = "Auto-fetched on SKU lookup.<br>Click to use your own photo, or drag one here.";
  }
}
function switchTypeKeepingSpec(newType) {
  const keep = App.spec;
  showEditor(newType);
  App.spec = Object.assign(App.spec, keep);
}

function showMsg(id, cls, text) {
  const m = $("#" + id);
  if (!m) return;
  m.className = `msg show ${cls}`;
  m.textContent = text;
}

/* live preview */
const schedulePreview = debounce(async () => {
  if (App.view === "editor") {
    const t = typeById(App.typeId);
    if (!t) return;
    const seq = ++App._previewSeq;
    await ensureFontsLoaded();
    const size = sizeById(App.sizeId);
    try {
      const svg = await renderSignSVG(App.typeId, currentRenderSpec(), App.sizeId);
      if (seq !== App._previewSeq) return;
      setPreviewSVG(svg, size);
    } catch (e) {
      console.error(e);
    }
  }
}, 160);

function setPreviewSVG(svg, size) {
  const holder = $("#signHolder");
  if (!holder) return;
  const stage = holder.parentElement;
  const availW = stage.clientWidth - 44;
  const availH = Math.max(300, window.innerHeight - 420);
  const scale = Math.min(availW / (size.w * PPI), availH / (size.h * PPI), 1.6);
  holder.innerHTML = svg.replace(/^<svg /, `<svg style="width:${size.w * PPI * scale}px;height:${size.h * PPI * scale}px" `);
  const meta = $("#previewMeta");
  if (meta) {
    let txt = `${size.label.replace(/"/g, "″")} — prints at exact size · shown at ${(scale * 100).toFixed(0)}%`;
    if (size.cut) txt += " · cut on the dashed line, laminate, and it fits the 8.5×11 holder";
    meta.textContent = txt;
  }
}

/* ---------------- queue rail ---------------- */
async function renderQueue() {
  const host = $("#queueItems");
  const count = $("#queueCount");
  count.textContent = String(Queue.items.length);
  if (!Queue.items.length) {
    host.innerHTML = `<div class="queue-empty">Queue is empty.<br>Build a sign and hit <b>＋ Add to Queue</b> — mix any types and sizes, then print them all at once.</div>`;
    $("#sheetPreviews").innerHTML = "";
    $("#queueStats").textContent = "";
    updateQueueButtons();
    return;
  }
  host.innerHTML = "";
  for (const q of Queue.items) {
    const item = el("div", "q-item");
    const thumb = el("div", "q-thumb");
    thumb.dataset.uid = q.uid;
    const info = el("div", "q-info");
    const size = sizeById(q.sizeId);
    info.appendChild(el("div", "q-title", queueItemTitle(q)));
    info.appendChild(el("div", "q-sub", `${typeById(q.typeId) ? typeById(q.typeId).label : q.typeId} · ${size.w}×${size.h}″`));
    const actions = el("div", "q-actions");
    const dup = el("button", "q-btn", "⧉");
    dup.title = "Duplicate";
    dup.onclick = () => Queue.duplicate(q.uid);
    const del = el("button", "q-btn", "✕");
    del.title = "Remove";
    del.onclick = () => Queue.remove(q.uid);
    actions.appendChild(dup);
    actions.appendChild(del);
    item.appendChild(thumb);
    item.appendChild(info);
    item.appendChild(actions);
    host.appendChild(item);
  }
  updateQueueButtons();
  renderSheetPreviews();
  // thumbnails (async, after list is in place)
  ensureFontsLoaded().then(async () => {
    for (const q of Queue.items) {
      const holder = $(`.q-thumb[data-uid="${q.uid}"]`);
      if (!holder || holder.firstChild) continue;
      try {
        const size = sizeById(q.sizeId);
        const svg = await renderQueueItemSVG(q);
        const scale = Math.min(62 / (size.w * PPI), 42 / (size.h * PPI));
        holder.innerHTML = svg.replace(/^<svg /, `<svg style="width:${size.w * PPI * scale}px;height:${size.h * PPI * scale}px" `);
      } catch (e) {}
    }
  });
}

function updateQueueButtons() {
  const has = Queue.items.length > 0;
  $("#printAllBtn").disabled = !has;
  $("#exportAllBtn").disabled = !has;
  $("#clearQueueBtn").disabled = !has;
}

async function renderSheetPreviews() {
  const host = $("#sheetPreviews");
  host.innerHTML = "";
  const packed = packQueue(Queue.packable(), { margin: Settings.get().margin });
  const stats = $("#queueStats");
  const nSigns = Queue.items.length;
  stats.textContent = `${nSigns} sign${nSigns === 1 ? "" : "s"} → ${packed.pages.length} sheet${packed.pages.length === 1 ? "" : "s"} (optimized layout, straight cuts)`;
  await ensureFontsLoaded();
  for (let i = 0; i < packed.pages.length && i < 8; i++) {
    const page = packed.pages[i];
    const box = el("div", "sheet-thumb");
    const { svg, pw, ph } = await composeSheetSVG(page, Settings.get().cutGuides);
    const scale = Math.min(84 / (pw * PPI), 106 / (ph * PPI));
    box.innerHTML = svg.replace(/^<svg /, `<svg style="width:${pw * PPI * scale}px;height:${ph * PPI * scale}px" `);
    box.appendChild(el("span", "pg", String(i + 1)));
    host.appendChild(box);
  }
  if (packed.pages.length > 8) {
    host.appendChild(el("div", "queue-stats", `+${packed.pages.length - 8} more sheets`));
  }
  return packed;
}

async function exportQueue(print) {
  if (!Queue.items.length) return;
  const btn = print ? $("#printAllBtn") : $("#exportAllBtn");
  const orig = btn.textContent;
  btn.disabled = true;
  try {
    const packed = packQueue(Queue.packable(), { margin: Settings.get().margin });
    btn.textContent = "Rendering…";
    const doc = await pagesToPdf(packed.pages, Settings.get().cutGuides, (i, n) => {
      btn.textContent = `Sheet ${i}/${n}…`;
    });
    if (print) printPdfDoc(doc);
    else {
      const d = new Date();
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      downloadPdfDoc(doc, `ace-signs-${stamp}.pdf`);
    }
  } catch (e) {
    alert("Export failed: " + e.message);
    console.error(e);
  } finally {
    btn.textContent = orig;
    btn.disabled = false;
  }
}

/* ---------------- bulk add ---------------- */
function initBulk() {
  const ta = $("#bulkSkus");
  const badge = $("#bulkCount");
  ta.addEventListener("input", () => {
    const n = parseBulkSkus(ta.value).length;
    badge.textContent = n ? `${n} SKU${n === 1 ? "" : "s"} detected` : "";
  });
  $("#bulkAddBtn").onclick = async () => {
    const skus = parseBulkSkus(ta.value);
    if (!skus.length) return;
    const typeId = $("#bulkType").value;
    const sizeId = $("#bulkSize").value;
    const prog = $("#bulkProgress");
    const fill = prog.querySelector("i");
    prog.classList.add("show");
    let done = 0, ok = 0;
    const CONCURRENCY = 5;
    const work = skus.slice();
    const runOne = async () => {
      const sku = work.shift();
      if (sku == null) return;
      try {
        const res = await fetch(`/api/lookup?q=${encodeURIComponent(sku)}&store=${encodeURIComponent(Settings.get().storeCode)}`).then((r) => r.json());
        if (res.ok) {
          const si = saleInfo(res);
          const spec = {
            sku: res.sku || sku,
            name: res.name || "",
            image: res.imageUrl || null,
            price: si.onSale ? si.sale : (res.price || res.listPrice || ""),
            regPrice: si.onSale ? si.reg : "",
            startDate: App.batchStart, endDate: App.batchEnd,
          };
          Queue.add(si.onSale && typeId === "regular" ? "sale" : typeId, sizeId, spec);
          ok++;
        }
      } catch (e) {}
      done++;
      fill.style.width = `${(done / skus.length) * 100}%`;
      await runOne();
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, skus.length) }, runOne));
    prog.classList.remove("show");
    fill.style.width = "0";
    badge.textContent = `Added ${ok} of ${skus.length}`;
    if (ok) ta.value = "";
  };
}

/* ---------------- settings ---------------- */
function openSettings() {
  const s = Settings.get();
  $("#setStore").value = s.storeCode;
  $("#setStoreLine").value = s.storeLine;
  $("#setPrintStoreLine").checked = !!s.printStoreLine;
  $("#setCutGuides").checked = !!s.cutGuides;
  $("#setMargin").value = String(s.margin);
  $("#setTemplateSku").value = s.templateSku || "81995";
  $("#settingsModal").classList.add("show");
  $("#settingsSave").onclick = () => {
    const prevTemplate = Settings.get().templateSku || "81995";
    Settings.set({
      storeCode: $("#setStore").value.trim() || "12180",
      storeLine: $("#setStoreLine").value.trim(),
      printStoreLine: $("#setPrintStoreLine").checked,
      cutGuides: $("#setCutGuides").checked,
      margin: Math.min(0.6, Math.max(0.25, parseFloat($("#setMargin").value) || 0.375)),
      templateSku: $("#setTemplateSku").value.trim() || "81995",
    });
    $("#settingsModal").classList.remove("show");
    $("#storeLineTop").textContent = Settings.get().storeLine || "Snyder's Ace Hardware";
    if (Settings.get().templateSku !== prevTemplate) {
      try { localStorage.removeItem("acesignstudio.template.v1"); } catch (e) {}
      loadTemplateProduct();
    }
    renderQueue();
  };
}
