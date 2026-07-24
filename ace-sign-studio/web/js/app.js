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
  editingUid: null,      // queue item being edited, or null
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
  checkForUpdate();
  $("#settingsBtn").onclick = openSettings;
  $("#homeBtn").onclick = showGallery;
  $("#clearQueueBtn").onclick = clearQueueWithUndo;
  $("#refreshPricesBtn").onclick = refreshQueuePrices;
  $("#batchesBtn").onclick = openBatches;
  $("#printAllBtn").onclick = () => exportQueue(true);
  $("#exportAllBtn").onclick = () => exportQueue(false);
  $("#storeLineTop").textContent = Settings.get().storeLine || "Snyder's Ace Hardware";
  initBulk();
  window.addEventListener("resize", () => schedulePreview()); // re-scale preview to the new window
  initSupport();
  fetch("/api/health", { cache: "no-store" }).then((r) => r.json()).then((h) => { window.__appVersion = h.version; }).catch(() => {});
  $$(".modal-back").forEach((mb) => {
    mb.addEventListener("click", (e) => { if (e.target === mb) mb.classList.remove("show"); });
  });
  $$(".modal-close").forEach((b) => (b.onclick = () => b.closest(".modal-back").classList.remove("show")));
});

function startHeartbeat() {
  setInterval(() => { fetch("/__ping").catch(() => {}); }, 2000);
}

/* ---------------- self-update ---------------- */
async function checkForUpdate() {
  let st;
  try {
    st = await fetch("/api/update/check").then((r) => r.json());
  } catch (e) { return; }
  const bar = $("#updateBar");
  if (!st || !st.available) { if (bar) bar.classList.remove("show"); return; }
  bar.querySelector("#updateText").innerHTML =
    `<b>Update available</b> — v${esc(st.latest)} is ready (you have v${esc(st.current)}).` +
    (st.notes ? ` <span class="upd-notes">${esc(st.notes)}</span>` : "");
  const btn = bar.querySelector("#updateBtn");
  if (!st.canApply) {
    btn.textContent = "Download";
    btn.onclick = () => window.open("https://github.com/codysuter/codysuter/raw/main/dist/AceSignStudio.exe", "_blank");
  } else {
    btn.textContent = "Update & Restart";
    btn.onclick = () => applyUpdate(btn, bar);
  }
  bar.querySelector("#updateDismiss").onclick = () => bar.classList.remove("show");
  bar.classList.add("show");
}

async function applyUpdate(btn, bar) {
  btn.disabled = true;
  btn.textContent = "Downloading…";
  bar.querySelector("#updateDismiss").style.display = "none";
  try {
    const res = await fetch("/api/update/apply", { method: "POST" }).then((r) => r.json());
    if (!res.ok) throw new Error(res.error || "update failed");
    bar.querySelector("#updateText").innerHTML = `<b>Updating to v${esc(res.version)}…</b> The app will reopen in a moment. You can close this window.`;
    btn.style.display = "none";
    // The backend relaunches and exits; poll until the new instance answers.
    let tries = 0;
    const poll = setInterval(async () => {
      tries++;
      try {
        const h = await fetch("/api/health", { cache: "no-store" }).then((r) => r.json());
        if (h && h.version === res.version) { clearInterval(poll); location.reload(); }
      } catch (e) { /* server restarting */ }
      if (tries > 40) clearInterval(poll);
    }, 1000);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "Retry";
    bar.querySelector("#updateText").innerHTML = `<b>Update failed:</b> ${esc(e.message)}. You can download it manually instead.`;
  }
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
  if (App.editingUid) { App.editingUid = null; renderQueue(); }
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
  // keep shared fields (sku/name/image/price) when switching types;
  // while editing a queued sign the spec is taken verbatim (no batch dates)
  const keep = App.spec || {};
  App.spec = App.editingUid ? keep : Object.assign({ startDate: App.batchStart, endDate: App.batchEnd }, keep);
  markActiveNav();

  const work = $("#work");
  work.innerHTML = `
    <div class="work-inner">
      <div class="edit-banner" id="editBanner" style="display:none">✏️ Editing a queued sign — <b>&nbsp;Update Sign&nbsp;</b> saves your changes to it.<span class="link" id="cancelEditBtn">Cancel</span></div>
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
    if (App.editingUid) {
      const updated = Queue.update(App.editingUid, t.id, App.sizeId, App.spec);
      App.editingUid = null;
      updateEditMode();
      if (updated) {
        showMsg("editorMsg", "ok", "Sign updated in the queue.");
        showToast("Sign updated.");
      } else {
        // the row was deleted while editing — keep the work, add as new
        Queue.add(t.id, App.sizeId, App.spec);
        showMsg("editorMsg", "ok", "That sign was no longer in the queue — added it as a new one.");
      }
      return;
    }
    Queue.add(t.id, App.sizeId, App.spec);
    const n = Queue.totalSigns();
    showMsg("editorMsg", "ok", `Added to queue — ${n} sign${n === 1 ? "" : "s"} queued.`);
  };
  $("#cancelEditBtn").onclick = () => {
    App.editingUid = null;
    updateEditMode();
    showMsg("editorMsg", "ok", "Edit cancelled — the button adds a new sign again.");
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
  updateEditMode();
  schedulePreview();
}

/* Reflect edit mode in the editor chrome + queue highlight. */
function updateEditMode() {
  const banner = $("#editBanner");
  if (banner) banner.style.display = App.editingUid ? "flex" : "none";
  const btn = $("#addQueueBtn");
  if (btn) btn.textContent = App.editingUid ? "✓ Update Sign" : "＋ Add to Queue";
  // re-render the rail only when the highlighted row is out of sync
  const current = $(".q-item.editing .q-thumb");
  const inSync = App.editingUid ? (current && current.dataset.uid === App.editingUid) : !current;
  if (!inSync) renderQueue();
}

/* Open a queued sign back up in the editor. */
function startEditQueueItem(uid) {
  const item = Queue.items.find((q) => q.uid === uid);
  if (!item) return;
  App.editingUid = uid;
  App.sizeId = item.sizeId;
  App.spec = JSON.parse(JSON.stringify(item.spec));
  showEditor(item.typeId);
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
      inp.addEventListener("input", () => { App.spec.sku = inp.value.trim(); });
      attachAutoLookup(inp, status, (res, si) => {
        App.spec.sku = res.sku || inp.value.trim();
        // prefer the server's fetch time — cached results carry the
        // ORIGINAL lookup time, so the stale badge stays honest
        App.spec.lookedUpAt = res.fetchedAt || new Date().toISOString();
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
/* Days since a spec's price was looked up, or null when unknown. */
function priceAgeDays(spec) {
  if (!spec || !spec.lookedUpAt || !String(spec.sku || "").trim()) return null;
  const t = Date.parse(spec.lookedUpAt);
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

async function renderQueue() {
  const host = $("#queueItems");
  const count = $("#queueCount");
  count.textContent = String(Queue.totalSigns());
  if (!Queue.items.length) {
    host.innerHTML = `<div class="queue-empty">Queue is empty.<br>Build a sign and hit <b>＋ Add to Queue</b> — mix any types and sizes, then print them all at once.</div>`;
    $("#sheetPreviews").innerHTML = "";
    $("#queueStats").textContent = "";
    updateQueueButtons();
    return;
  }
  host.innerHTML = "";
  Queue.items.forEach((q, idx) => {
    const item = el("div", "q-item" + (q.uid === App.editingUid ? " editing" : ""));
    item.title = "Click to edit this sign";
    const main = el("div", "q-main");
    const thumb = el("div", "q-thumb");
    thumb.dataset.uid = q.uid;
    const info = el("div", "q-info");
    const size = sizeById(q.sizeId);
    info.appendChild(el("div", "q-title", queueItemTitle(q)));
    const sub = el("div", "q-sub");
    sub.appendChild(document.createTextNode(`${typeById(q.typeId) ? typeById(q.typeId).label : q.typeId} · ${size.w}×${size.h}″`));
    const age = priceAgeDays(q.spec);
    if (age != null && age > 3) sub.appendChild(el("span", "q-stale", `price ${age}d old`));
    else if (age == null && PRICE_REFRESH_TYPES[q.typeId] && String(q.spec.sku || "").trim()) {
      // pre-2.1 items carry no lookup timestamp — call that out rather
      // than silently skipping the badge on the stalest signs of all
      sub.appendChild(el("span", "q-stale", "price unchecked"));
    }
    if (q.typeId === "was_now" && !String(q.spec.price || "").trim()) sub.appendChild(el("span", "q-warn", "needs Now price"));
    info.appendChild(sub);
    main.onclick = () => startEditQueueItem(q.uid);

    const actions = el("div", "q-actions");
    const btn = (label, title, fn, disabled) => {
      const b = el("button", "q-btn", label);
      b.title = title;
      b.disabled = !!disabled;
      b.onclick = (e) => { e.stopPropagation(); fn(); };
      actions.appendChild(b);
    };
    btn("▲", "Move up", () => Queue.move(q.uid, -1), idx === 0);
    btn("⧉", "Duplicate", () => Queue.duplicate(q.uid));
    btn("▼", "Move down", () => Queue.move(q.uid, 1), idx === Queue.items.length - 1);
    btn("✕", "Remove", () => {
      const rem = Queue.remove(q.uid);
      if (rem) showToast(`Removed “${queueItemTitle(rem.item)}”.`, { undo: () => Queue.restore(rem.item, rem.index) });
    });
    main.appendChild(thumb);
    main.appendChild(info);
    main.appendChild(actions);
    item.appendChild(main);

    const copies = el("div", "q-copy-row");
    copies.onclick = (e) => e.stopPropagation();
    copies.appendChild(el("span", null, "Copies"));
    const minus = el("button", "q-step", "−");
    minus.title = "One less copy";
    minus.disabled = (q.copies || 1) <= 1;
    minus.onclick = () => Queue.setCopies(q.uid, (q.copies || 1) - 1);
    const n = el("b", "q-copies", `×${q.copies || 1}`);
    const plus = el("button", "q-step", "＋");
    plus.title = "One more copy";
    plus.onclick = () => Queue.setCopies(q.uid, (q.copies || 1) + 1);
    copies.appendChild(minus);
    copies.appendChild(n);
    copies.appendChild(plus);
    item.appendChild(copies);
    host.appendChild(item);
  });
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
  $("#refreshPricesBtn").disabled = !has || _refreshingPrices;
}

function clearQueueWithUndo() {
  if (!Queue.items.length) return;
  const snap = Queue.clear();
  const n = snap.reduce((a, q) => a + (q.copies || 1), 0);
  // prepend on undo: signs added during the toast window survive
  showToast(`Queue cleared — ${n} sign${n === 1 ? "" : "s"}.`, { undo: () => Queue.replaceAll(snap.concat(Queue.items)) });
}

/* ---------------- toasts ---------------- */
let _toastTimer = null;
function showToast(text, opts) {
  const o = opts || {};
  const host = $("#toastHost");
  if (!host) return;
  clearTimeout(_toastTimer);
  host.innerHTML = "";
  const t = el("div", "toast");
  t.appendChild(el("span", "toast-text", text));
  if (o.undo) {
    const u = el("button", "toast-undo", "Undo");
    u.onclick = () => { clearTimeout(_toastTimer); host.innerHTML = ""; o.undo(); };
    t.appendChild(u);
  }
  const x = el("button", "toast-close", "✕");
  x.title = "Dismiss";
  x.onclick = () => { clearTimeout(_toastTimer); host.innerHTML = ""; };
  t.appendChild(x);
  host.appendChild(t);
  _toastTimer = setTimeout(() => { host.innerHTML = ""; }, o.ms || (o.undo ? 10000 : 5000));
}

/* ---------------- price refresh ---------------- */
/* Types whose price fields map 1:1 onto lookup results. Everything else
   (percent/BOGO/savings…) is hand-entered and left alone. */
const PRICE_REFRESH_TYPES = { regular: true, sale: true, large_text: true };
let _refreshingPrices = false;

async function refreshQueuePrices() {
  if (_refreshingPrices) return;
  const refreshable = (q) => String(q.spec.sku || "").trim() && PRICE_REFRESH_TYPES[q.typeId] && q.uid !== App.editingUid;
  const targets = Queue.items.filter(refreshable);
  const manual = Queue.items.filter((q) => !refreshable(q)).length;
  if (!targets.length) {
    showToast("Nothing to refresh — no queued Regular/Sale/Large Text signs with a SKU.");
    return;
  }
  const btn = $("#refreshPricesBtn");
  const orig = btn.textContent;
  _refreshingPrices = true;
  btn.disabled = true;
  let done = 0, changed = 0, failed = 0;
  const work = targets.slice();
  const runOne = async () => {
    const q = work.shift();
    if (!q) return;
    btn.textContent = `↻ ${++done}/${targets.length}`;
    try {
      const res = await fetch(`/api/lookup?q=${encodeURIComponent(q.spec.sku)}&refresh=1&store=${encodeURIComponent(Settings.get().storeCode)}`).then((r) => r.json());
      const si = res.ok ? saleInfo(res) : { onSale: false };
      const plain = res.ok ? (res.price || res.listPrice || "") : "";
      if (!res.ok || (!si.onSale && !plain)) {
        // a lookup with no price data must never rewrite a sign — a Sale
        // sign demoted here would print its discount as the regular price
        failed++;
      } else {
        const before = `${q.typeId}|${q.spec.price || ""}|${q.spec.regPrice || ""}`;
        if (si.onSale) {
          if (q.typeId === "regular") q.typeId = "sale";
          if (q.typeId === "sale") { q.spec.price = si.sale; q.spec.regPrice = si.reg; }
          else q.spec.price = si.sale;
        } else {
          if (q.typeId === "sale") {
            q.typeId = "regular";
            q.spec.regPrice = "";
            // the sale's date pill has no field on a Regular sign — drop it
            q.spec.startDate = "";
            q.spec.endDate = "";
          }
          q.spec.price = plain;
        }
        // photos refresh only when the sign already shows one — a hidden
        // or never-fetched photo must not reappear
        if (res.imageUrl && q.spec.image && !q.spec._customImage) q.spec.image = res.imageUrl;
        q.spec.lookedUpAt = res.fetchedAt || new Date().toISOString();
        if (before !== `${q.typeId}|${q.spec.price || ""}|${q.spec.regPrice || ""}`) changed++;
      }
    } catch (e) { failed++; }
    await runOne();
  };
  await Promise.all(Array.from({ length: Math.min(4, targets.length) }, runOne));
  btn.textContent = orig;
  _refreshingPrices = false;
  persistState();
  renderQueue();
  const okCount = targets.length - failed;
  let msg = `Refreshed ${okCount} sign${okCount === 1 ? "" : "s"} — ${changed} price change${changed === 1 ? "" : "s"}`;
  if (manual) msg += `, ${manual} sign${manual === 1 ? "" : "s"} left untouched`;
  if (failed) msg += `, ${failed} without price data (unchanged)`;
  showToast(msg + ".");
}

/* ---------------- named batches ---------------- */
function openBatches() {
  const inp = $("#batchName");
  const hint = $("#batchSaveHint");
  const n = Queue.totalSigns();
  hint.textContent = Queue.items.length
    ? `Saves the ${n} sign${n === 1 ? "" : "s"} currently in the queue under this name.`
    : "The queue is empty — build it first, then save it as a batch.";
  $("#batchSaveBtn").disabled = !Queue.items.length;
  $("#batchSaveBtn").onclick = () => {
    const name = inp.value.trim();
    if (!name || !Queue.items.length) return;
    const existed = !!Batches.data[name];
    Batches.save(name);
    inp.value = "";
    renderBatchList();
    showToast(existed ? `Batch “${name}” updated.` : `Batch “${name}” saved.`);
  };
  renderBatchList();
  $("#batchModal").classList.add("show");
}

function fmtBatchDate(iso) {
  const t = Date.parse(iso);
  if (isNaN(t)) return "—";
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function renderBatchList() {
  const host = $("#batchList");
  host.innerHTML = "";
  const names = Batches.names();
  if (!names.length) {
    host.appendChild(el("div", "queue-empty", "No saved batches yet."));
    return;
  }
  for (const name of names) {
    const b = Batches.data[name];
    const row = el("div", "batch-row");
    const info = el("div", "batch-info");
    info.appendChild(el("div", "batch-name", name));
    const n = (b.items || []).reduce((a, q) => a + (q.copies || 1), 0);
    info.appendChild(el("div", "batch-sub", `${n} sign${n === 1 ? "" : "s"} · saved ${fmtBatchDate(b.savedAt)}`));
    const load = el("button", "btn btn-secondary btn-sm", "Load");
    load.onclick = () => {
      const prev = Queue.items;
      Queue.replaceAll(b.items || []);
      const gen = Queue._gen;
      $("#batchModal").classList.remove("show");
      showToast(`Loaded batch “${name}” — replaced the queue.`, {
        undo: () => {
          // the snapshot is only safe while the queue hasn't diverged
          if (Queue._gen !== gen) return showToast("The queue changed since the batch loaded — undo unavailable.");
          Queue.replaceAll(prev);
        },
      });
    };
    const del = el("button", "q-btn", "✕");
    del.title = "Delete batch";
    del.onclick = () => {
      Batches.remove(name);
      renderBatchList();
      showToast(`Batch “${name}” deleted.`, { undo: () => { Batches.data[name] = b; persistState(); renderBatchList(); } });
    };
    row.appendChild(info);
    row.appendChild(load);
    row.appendChild(del);
    host.appendChild(row);
  }
}

let _sheetSeq = 0;
async function renderSheetPreviews() {
  const seq = ++_sheetSeq;
  const host = $("#sheetPreviews");
  host.innerHTML = "";
  const packed = packQueue(Queue.packable(), { margin: Settings.get().margin });
  const stats = $("#queueStats");
  const nSigns = Queue.totalSigns();
  const nKinds = Queue.items.length;
  const kindsNote = nSigns !== nKinds ? ` (${nKinds} unique)` : "";
  stats.textContent = `${nSigns} sign${nSigns === 1 ? "" : "s"}${kindsNote} → ${packed.pages.length} sheet${packed.pages.length === 1 ? "" : "s"} (optimized layout, straight cuts)`;
  await ensureFontsLoaded();
  for (let i = 0; i < packed.pages.length && i < 8; i++) {
    const page = packed.pages[i];
    const box = el("div", "sheet-thumb");
    const { svg, pw, ph } = await composeSheetSVG(page, Settings.get().cutGuides);
    if (seq !== _sheetSeq) return packed; // a newer run owns the host now
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
  // never print a broken sign (e.g. a bulk Was/Now still missing its
  // NOW price would render "NOW $—") — block with a pointer instead
  const bad = Queue.items.filter((q) => {
    const t = typeById(q.typeId);
    return t && validateSpec(t, q.spec);
  });
  if (bad.length) {
    const first = validateSpec(typeById(bad[0].typeId), bad[0].spec);
    showToast(`${bad.length} sign${bad.length === 1 ? " is" : "s are"} incomplete — “${queueItemTitle(bad[0])}”: ${first} Click it in the queue to fix.`, { ms: 9000 });
    return;
  }
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
    const copies = clampCopies($("#bulkCopies").value);
    const prog = $("#bulkProgress");
    const fill = prog.querySelector("i");
    prog.classList.add("show");
    $("#bulkReport").innerHTML = "";
    const failed = [];   // {sku, reason}
    const needsNow = []; // Was/Now signs added without a Now price
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
            lookedUpAt: res.fetchedAt || new Date().toISOString(),
          };
          let addType = typeId;
          if (typeId === "regular" && si.onSale) addType = "sale";
          if (typeId === "was_now") {
            // clearance: today's shelf price is the WAS; the NOW comes from
            // the sale price, or gets set by hand (click the queued sign)
            spec.regPrice = si.onSale ? si.reg : (res.price || res.listPrice || "");
            spec.price = si.onSale ? si.sale : "";
            if (!spec.price) needsNow.push(spec.sku);
          }
          Queue.add(addType, sizeId, spec, copies);
          ok++;
        } else {
          failed.push({ sku, reason: res.error || "no product data" });
        }
      } catch (e) {
        failed.push({ sku, reason: "connection failed" });
      }
      done++;
      fill.style.width = `${(done / skus.length) * 100}%`;
      await runOne();
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, skus.length) }, runOne));
    prog.classList.remove("show");
    fill.style.width = "0";
    badge.textContent = `Added ${ok} of ${skus.length}`;
    if (ok) ta.value = "";
    renderBulkReport(failed, needsNow);
  };
}

/* Per-SKU failure list + retry, and Was/Now signs still needing a price. */
function renderBulkReport(failed, needsNow) {
  const host = $("#bulkReport");
  host.innerHTML = "";
  if (failed.length) {
    const box = el("div", "bulk-fails");
    box.appendChild(el("div", "bulk-fail-head", `✗ ${failed.length} SKU${failed.length === 1 ? "" : "s"} failed`));
    for (const f of failed.slice(0, 12)) box.appendChild(el("div", "bulk-fail-row", `${f.sku} — ${f.reason}`));
    if (failed.length > 12) box.appendChild(el("div", "bulk-fail-row", `…and ${failed.length - 12} more`));
    const retry = el("button", "btn btn-secondary btn-sm", "Retry failed");
    retry.onclick = () => {
      const ta = $("#bulkSkus");
      ta.value = failed.map((f) => f.sku).join("\n");
      ta.dispatchEvent(new Event("input"));
      host.innerHTML = "";
    };
    box.appendChild(retry);
    host.appendChild(box);
  }
  if (needsNow.length) {
    host.appendChild(el("div", "bulk-warn",
      `⚠ ${needsNow.length} Was/Now sign${needsNow.length === 1 ? "" : "s"} added without a Now price — click them in the queue to set it.`));
  }
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
