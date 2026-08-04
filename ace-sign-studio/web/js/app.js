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
  // Paint the shell before waiting on state: only the queue rail depends on
  // it, and state.json can be sizeable once custom photos are in play.
  buildNav();
  showGallery();
  await restoreState();
  renderQueue();
  ensureFontsLoaded().then(() => {
    buildNavThumbs();
    buildGalleryThumbs();
  });
  // Warm the PDF font cache and libraries once the startup burst is over —
  // neither is needed until the user prints or exports.
  whenIdle(() => {
    prefetchPdfFonts().catch(() => {});
    ensurePdfLibs().catch(() => {});
  });
  loadTemplateProduct();
  checkForUpdate();
  scanBatchPricesAtLaunch();
  $("#settingsBtn").onclick = openSettings;
  $("#homeBtn").onclick = showGallery;
  $("#clearQueueBtn").onclick = clearQueueWithUndo;
  $("#refreshPricesBtn").onclick = refreshQueuePrices;
  $("#batchesBtn").onclick = openBatches;
  $("#historyBtn").onclick = openHistory;
  $("#printAllBtn").onclick = () => exportQueue(true);
  $("#exportAllBtn").onclick = () => exportQueue(false);
  $("#storeLineTop").textContent = Settings.get().storeLine || "Snyder's Ace Hardware";
  initBulk();
  window.addEventListener("resize", () => schedulePreview()); // re-scale preview to the new window
  initSupport();
  fetch("/api/health", { cache: "no-store" }).then((r) => r.json()).then((h) => { window.__appVersion = h.version; window.__appHost = h.host; }).catch(() => {});
  Sync.start();
  $$(".modal-back").forEach((mb) => {
    mb.addEventListener("click", (e) => { if (e.target === mb) mb.classList.remove("show"); });
  });
  $$(".modal-close").forEach((b) => (b.onclick = () => b.closest(".modal-back").classList.remove("show")));
});

/* Heartbeat: tells the backend the window is still open. Chrome throttles
   main-thread timers in minimized/hidden windows to as little as once per
   minute — long enough that the backend's watchdog would conclude the window
   was closed and exit, leaving every later click failing with "Failed to
   fetch". Worker timers are exempt from that throttling, so the ping loop
   runs in a tiny inline worker (main-thread interval only as a fallback).
   Repeated ping failures surface a "relaunch the app" banner instead of
   letting the user discover the dead backend through cryptic errors. */
let _connFails = 0;
function reportPing(ok) {
  _connFails = ok ? 0 : _connFails + 1;
  const bar = $("#connBar");
  if (!bar) return;
  if (ok) bar.classList.remove("show");
  else if (_connFails >= 3) bar.classList.add("show");
}

function startHeartbeat() {
  // The watchdog exits after 90s of total silence, so a 20s beat leaves room
  // for several missed pings while costing a thirtieth of the old 2s loop
  // (~2,900 round trips a day instead of ~43,000). A failed ping retries
  // quickly so the "lost connection" banner still appears within seconds.
  const PING_MS = 20000;
  const RETRY_MS = 2000;
  const pingURL = location.origin + "/__ping";
  const pingNow = () => fetch(pingURL, { cache: "no-store" }).then(() => reportPing(true)).catch(() => reportPing(false));
  try {
    // Self-rescheduling rather than setInterval so a failure can retry
    // sooner; every path must re-arm or the app loses its liveness signal.
    const src = `const PING_MS = ${PING_MS}, RETRY_MS = ${RETRY_MS};
      let timer = null;
      const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(beat, ms); };
      function beat() {
        try {
          fetch(${JSON.stringify(pingURL)}, { cache: "no-store" })
            .then(() => { postMessage(true); schedule(PING_MS); })
            .catch(() => { postMessage(false); schedule(RETRY_MS); });
        } catch (e) { postMessage(false); schedule(RETRY_MS); }
      }
      beat();`;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    w.onmessage = (e) => reportPing(!!e.data);
    w.onerror = () => { try { w.terminate(); } catch (_) {} setInterval(pingNow, PING_MS); };
  } catch (e) {
    setInterval(pingNow, PING_MS);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pingNow(); });
}

/* ---------------- self-update ---------------- */
async function checkForUpdate() {
  let st;
  try {
    st = await fetch("/api/update/check").then((r) => r.json());
  } catch (e) { return; }
  renderUpdateBar(st);
}

/* Show/hide the top "Update available" banner for a /api/update/check
   result. Shared by the launch check and Settings → Check for updates. */
function renderUpdateBar(st) {
  const bar = $("#updateBar");
  if (!st || !st.available) { if (bar) bar.classList.remove("show"); return; }
  bar.querySelector("#updateText").innerHTML =
    `<b>Update available</b> — v${esc(st.latest)} is ready (you have v${esc(st.current)}).` +
    (st.notes ? ` <span class="upd-notes">${esc(st.notes)}</span>` : "");
  const btn = bar.querySelector("#updateBtn");
  if (!st.canApply) {
    btn.textContent = "Download";
    btn.onclick = () => window.open("https://github.com/codysuter/codysuter/releases/download/ace-sign-studio-windows/AceSignStudio.exe", "_blank");
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
/* The gallery previews only need a plausible product; re-checking its price
   at every launch bought nothing but a headless-browser spawn during the
   startup burst. A cached template is trusted for a day. */
const TEMPLATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

async function loadTemplateProduct() {
  const sku = (Settings.get().templateSku || "81995").trim();
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem("acesignstudio.template.v1") || "null"); } catch (e) {}
  const cachedOK = cached && cached.sku === sku && cached.image;
  if (cachedOK) {
    applyTemplateProduct(cached);
    refreshTypeThumbs();
    const age = Date.now() - (Date.parse(cached.cachedAt) || 0);
    if (age >= 0 && age < TEMPLATE_MAX_AGE_MS) return; // still fresh — no lookup
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
        cachedAt: new Date().toISOString(),
      };
      // Re-rendering all 28 thumbnails is only worth it if something the
      // previews actually show has changed.
      const same = cachedOK && cached.name === t.name && cached.price === t.price &&
        cached.salePrice === t.salePrice && cached.image === t.image;
      try { localStorage.setItem("acesignstudio.template.v1", JSON.stringify(t)); } catch (e) {}
      if (!same) {
        applyTemplateProduct(t);
        refreshTypeThumbs();
      }
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
      History.record("print", [editorHistoryItem(t)]);
      showMsg("editorMsg", "ok", "Sent to the print dialog.");
    } catch (e) { showMsg("editorMsg", "err", "Print failed: " + friendlyError(e) + "."); }
  };
  $("#pdfOneBtn").onclick = async () => {
    const err = validateSpec(t, App.spec);
    if (err) return showMsg("editorMsg", "err", err);
    showMsg("editorMsg", "ok", "Building PDF…");
    try {
      const doc = await signToPdf({ typeId: t.id, sizeId: App.sizeId, spec: currentRenderSpec() });
      downloadPdfDoc(doc, sanitizeFilename(queueItemTitle({ typeId: t.id, spec: App.spec })) + ".pdf");
      History.record("pdf", [editorHistoryItem(t)]);
      showMsg("editorMsg", "ok", "PDF saved.");
    } catch (e) { showMsg("editorMsg", "err", "PDF failed: " + friendlyError(e) + "."); }
  };
  updateEditMode();
  schedulePreview();
}

/* A history row for a sign printed straight from the editor: the raw spec
   (hides intact) so a restore is fully editable. */
function editorHistoryItem(t) {
  return {
    uid: "hist-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
    typeId: t.id,
    sizeId: App.sizeId,
    spec: App.spec,
    copies: 1,
  };
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
        maybeResetScaleForNewSku(App.spec.sku, t, host);
        if (res.productUrl) App.spec.productUrl = res.productUrl; // QR target
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
        acceptCustomPhoto(fl);
        file.value = "";
      };
      drop.addEventListener("dragover", (e) => { e.preventDefault(); });
      drop.addEventListener("drop", (e) => {
        e.preventDefault();
        const fl = e.dataTransfer.files && e.dataTransfer.files[0];
        if (!fl || !/^image\//.test(fl.type)) return;
        acceptCustomPhoto(fl);
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
  buildScaleSliders(t, host);
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
      buildScaleSliders(t, host); // hidden elements gray out their slider
      schedulePreview();
    };
    row.appendChild(c);
  }
  wrap.appendChild(row);
}

/* Element size sliders — writes spec.scale.{key} (0.5–1.6, 1 = automatic).
   The renderers re-balance the layout around whatever is boosted, so
   growing the photo shrinks the name/price to fit instead of colliding. */
function buildScaleSliders(t, host) {
  const defs = scalablesForType(t);
  if (!defs.length) return;
  let wrap = $("#scaleWrap", host);
  if (!wrap) {
    wrap = el("div");
    wrap.id = "scaleWrap";
    host.appendChild(wrap);
  }
  wrap.innerHTML = "";
  const sc = App.spec.scale || (App.spec.scale = {});
  const head = el("div", "scale-head");
  head.appendChild(labelEl("Element sizes — the sign re-fits itself around your changes"));
  const reset = el("button", "btn btn-ghost btn-sm", "Reset");
  reset.title = "Back to the automatic layout";
  const updateReset = () => {
    reset.disabled = !defs.some((d) => sc[d.key] && sc[d.key] !== 1);
  };
  reset.onclick = () => {
    App.spec.scale = {};
    buildScaleSliders(t, host);
    schedulePreview();
  };
  head.appendChild(reset);
  wrap.appendChild(head);
  for (const d of defs) {
    const row = el("div", "scale-row");
    const hidden = !!(App.spec.hide && App.spec.hide[d.key]);
    if (hidden) row.classList.add("off");
    row.appendChild(el("span", "scale-name", d.label));
    const slider = el("input", "scale-slider");
    slider.type = "range";
    slider.min = "50";
    slider.max = "160";
    slider.step = "5";
    slider.value = String(Math.round((sc[d.key] || 1) * 100));
    slider.dataset.scaleKey = d.key; // lets preview drags sync this row
    slider.disabled = hidden;
    slider.title = "Double-click to reset to 100%";
    const val = el("span", "scale-val", hidden ? "hidden" : slider.value + "%");
    slider.addEventListener("input", () => {
      sc[d.key] = parseInt(slider.value, 10) / 100;
      // remember which product these sizes were tuned for, so a new
      // SKU's lookup knows whether to keep or reset them
      App.spec._scaleSku = String(App.spec.sku || "");
      val.textContent = slider.value + "%";
      updateReset();
      schedulePreview();
    });
    slider.addEventListener("dblclick", () => {
      slider.value = "100";
      slider.dispatchEvent(new Event("input"));
    });
    row.appendChild(slider);
    row.appendChild(val);
    wrap.appendChild(row);
  }
  updateReset();
  const keep = el("label", "f-check");
  const cb = el("input");
  cb.type = "checkbox";
  cb.checked = !!Settings.get().keepScaleOnLookup;
  cb.onchange = () => Settings.set({ keepScaleOnLookup: cb.checked });
  keep.appendChild(cb);
  keep.appendChild(document.createTextNode("Keep these sizes when a new SKU is looked up"));
  keep.title = "Off: a new product goes back to the automatic layout. On: your slider settings carry over.";
  wrap.appendChild(keep);
}

/* A different product usually wants the automatic layout back: unless the
   keep toggle is on, slider adjustments tuned for a previous SKU are
   cleared when a new SKU's lookup lands. Re-looking-up the same SKU
   (blur, price refresh) never clears them. */
function maybeResetScaleForNewSku(newSku, t, host) {
  const sc = App.spec.scale;
  const tuned = sc && Object.keys(sc).some((k) => sc[k] && sc[k] !== 1);
  if (!tuned || Settings.get().keepScaleOnLookup) return;
  if (App.spec._scaleSku != null && String(newSku) === App.spec._scaleSku) return;
  App.spec.scale = {};
  delete App.spec._scaleSku;
  buildScaleSliders(t, host);
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
/* Take a user-supplied photo into the editor spec. A phone photo is often
   3-5 MB, and spec.image is persisted verbatim into state.json AND into
   every saved batch snapshot — so it is bounded here, at the one point it
   enters the app, rather than everywhere it is later copied. 1600px is far
   beyond what a full-page sign photo needs at print resolution. */
const CUSTOM_PHOTO_MAX_EDGE = 1600;
function acceptCustomPhoto(fileObj) {
  const r = new FileReader();
  r.onload = async () => {
    App.spec.image = await downscaleDataURL(r.result, CUSTOM_PHOTO_MAX_EDGE, 0.85);
    App.spec._customImage = true;
    refreshImageDrop();
    schedulePreview();
  };
  r.readAsDataURL(fileObj);
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
  attachPreviewDrag(holder);
  const meta = $("#previewMeta");
  if (meta) {
    let txt = `${size.label.replace(/"/g, "″")} — prints at exact size · shown at ${(scale * 100).toFixed(0)}%`;
    if (size.cut) txt += " · cut on the dashed line, laminate, and it fits the 8.5×11 holder";
    if (!_elemDrag) txt += " · drag any element to resize it";
    meta.textContent = txt;
  }
}

/* ---------------- drag-to-resize in the preview ----------------
   Every scalable element renders inside a g[data-elem] group. Dragging
   one up/down feeds the same spec.scale factor as its slider (snapped to
   the slider's 5% steps), and the auto-fit layout re-balances live. The
   preview re-renders during the drag (replacing the SVG), so the drag
   listens on the window, not on the group being replaced. */
let _elemDrag = null; // {key, label, startY, start} while dragging

function attachPreviewDrag(holder) {
  const svg = holder.querySelector("svg");
  if (!svg || App.view !== "editor") return;
  const t = typeById(App.typeId);
  if (!t) return;
  const defs = scalablesForType(t);
  const byKey = Object.fromEntries(defs.map((d) => [d.key, d]));
  for (const g of svg.querySelectorAll("g[data-elem]")) {
    const d = byKey[g.dataset.elem];
    if (!d) continue;
    g.style.cursor = "ns-resize";
    g.addEventListener("pointerenter", () => { if (!_elemDrag) showDragHint(svg, g, d.label); });
    g.addEventListener("pointerleave", () => hideDragHint());
    g.addEventListener("pointerdown", (e) => startElemDrag(e, d));
  }
  // mid-drag re-render: keep the hint on the (new) group being dragged
  if (_elemDrag) {
    const g = svg.querySelector(`g[data-elem="${_elemDrag.key}"]`);
    if (g) showDragHint(svg, g, _elemDrag.label);
  }
}

let _dragHintEl = null;
function showDragHint(svg, g, label) {
  hideDragHint();
  try {
    const bb = g.getBBox();
    const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    const pad = 5;
    r.setAttribute("x", bb.x - pad);
    r.setAttribute("y", bb.y - pad);
    r.setAttribute("width", bb.width + 2 * pad);
    r.setAttribute("height", bb.height + 2 * pad);
    r.setAttribute("rx", "4");
    r.setAttribute("fill", "none");
    r.setAttribute("stroke", "#D40029");
    r.setAttribute("stroke-width", "1.6");
    r.setAttribute("stroke-dasharray", "6 4");
    r.setAttribute("pointer-events", "none");
    svg.appendChild(r);
    _dragHintEl = r;
  } catch (e) { /* getBBox on a detached/empty group — no hint */ }
}
function hideDragHint() {
  if (_dragHintEl) { try { _dragHintEl.remove(); } catch (e) {} _dragHintEl = null; }
}

function startElemDrag(e, d) {
  if (e.button !== 0) return;
  e.preventDefault();
  if (!App.spec.scale) App.spec.scale = {};
  _elemDrag = { key: d.key, label: d.label, startY: e.clientY, start: App.spec.scale[d.key] || 1 };
  const badge = el("div", "drag-badge");
  const place = (ev) => {
    badge.textContent = `${d.label} ${Math.round((App.spec.scale[d.key] || 1) * 100)}%`;
    badge.style.left = ev.clientX + 14 + "px";
    badge.style.top = ev.clientY - 10 + "px";
  };
  place(e);
  document.body.appendChild(badge);
  const move = (ev) => {
    // 220px of drag spans roughly the whole 50–160% slider range
    const raw = _elemDrag.start + (_elemDrag.startY - ev.clientY) / 220;
    const snapped = Math.round(Math.min(1.6, Math.max(0.5, raw)) * 20) / 20;
    if (App.spec.scale[_elemDrag.key] !== snapped) {
      App.spec.scale[_elemDrag.key] = snapped;
      App.spec._scaleSku = String(App.spec.sku || "");
      syncScaleSliders();
      schedulePreview();
    }
    place(ev);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    _elemDrag = null;
    badge.remove();
    hideDragHint();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
}

/* Push spec.scale back into the slider row that matches each key. */
function syncScaleSliders() {
  const sc = App.spec.scale || {};
  $$("#scaleWrap .scale-slider").forEach((s) => {
    const key = s.dataset.scaleKey;
    if (!key) return;
    const pct = Math.round((sc[key] || 1) * 100);
    s.value = String(pct);
    const val = s.parentElement.querySelector(".scale-val");
    if (val && !s.disabled) val.textContent = pct + "%";
  });
  const reset = $("#scaleWrap .btn");
  if (reset) reset.disabled = !Object.keys(sc).some((k) => sc[k] && sc[k] !== 1);
}

/* ---------------- queue rail ---------------- */
/* Days since a spec's price was looked up, or null when unknown. */
function priceAgeDays(spec) {
  if (!spec || !spec.lookedUpAt || !String(spec.sku || "").trim()) return null;
  const t = Date.parse(spec.lookedUpAt);
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

/* Coalesce the *expensive* half of a queue render. The rows themselves are
   cheap text/button DOM and stay synchronous, so the count badge and row
   order are correct the instant a mutation happens. Thumbnails and sheet
   previews are full sign renders plus a re-pack — during a 100-SKU bulk add
   that was thousands of redundant renders, since every add re-rendered
   everything already in the rail. Batching them to one pass per frame
   collapses a burst into a single pass. */
let _visualsPending = false;
function scheduleQueueVisuals() {
  if (_visualsPending) return;
  _visualsPending = true;
  requestAnimationFrame(() => {
    _visualsPending = false;
    renderQueueVisuals();
  });
}

let _queueSeq = 0;
function renderQueueVisuals() {
  const seq = ++_queueSeq;
  if (!Queue.items.length) { // emptied before this pass ran — nothing to draw
    $("#sheetPreviews").innerHTML = "";
    $("#queueStats").textContent = "";
    return;
  }
  renderSheetPreviews();
  ensureFontsLoaded().then(async () => {
    for (const q of Queue.items) {
      if (seq !== _queueSeq) return; // a newer render owns the rail now
      const holder = $(`.q-thumb[data-uid="${q.uid}"]`);
      if (!holder || holder.firstChild) continue;
      try {
        const size = sizeById(q.sizeId);
        const svg = await renderQueueItemSVG(q);
        if (seq !== _queueSeq) return;
        const scale = Math.min(62 / (size.w * PPI), 42 / (size.h * PPI));
        holder.innerHTML = svg.replace(/^<svg /, `<svg style="width:${size.w * PPI * scale}px;height:${size.h * PPI * scale}px" `);
      } catch (e) {}
    }
  });
}

function renderQueue() {
  const host = $("#queueItems");
  const count = $("#queueCount");
  count.textContent = String(Queue.totalSigns());
  if (!Queue.items.length) {
    _queueSeq++; // cancel any in-flight thumbnail pass for the old contents
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
  scheduleQueueVisuals(); // thumbnails + sheet previews, batched to one pass
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

/* Apply a lookup result to a sign item ({typeId, spec}) — the shared rules
   behind the queue's ↻ Prices button and the launch batch scan. Returns
   null when the lookup carried no price data (the sign must never be
   rewritten from nothing — a Sale sign demoted that way would print its
   discount as the regular price), else whether type/prices changed. */
function applyPriceResult(q, res) {
  const si = res.ok ? saleInfo(res) : { onSale: false };
  const plain = res.ok ? (res.price || res.listPrice || "") : "";
  if (!res.ok || (!si.onSale && !plain)) return null;
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
  if (res.productUrl) q.spec.productUrl = res.productUrl; // keep the QR target fresh
  q.spec.lookedUpAt = res.fetchedAt || new Date().toISOString();
  return before !== `${q.typeId}|${q.spec.price || ""}|${q.spec.regPrice || ""}`;
}

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
      const r = applyPriceResult(q, res);
      if (r == null) failed++;
      else {
        Queue._bumpRev(q); // spec mutated in place — drop its cached SVG
        if (r) changed++;
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
      showToast(`Batch “${name}” deleted.`, { undo: () => {
        // fresh savedAt so the undo outranks the delete's tombstone when
        // another computer merges — else sync would re-delete it
        Batches.data[name] = Object.assign({}, b, { savedAt: new Date().toISOString() });
        persistState();
        renderBatchList();
      } });
    };
    row.appendChild(info);
    row.appendChild(load);
    row.appendChild(del);
    host.appendChild(row);
  }
}

/* ---------------- launch batch scan: prices + ended sales ----------------
   At launch, every saved batch is checked two ways:
   1. Price changes on Regular/Sale/Large Text signs with a SKU (the same
      set the queue's ↻ Prices button refreshes). Accepting the offer
      queues replacements AND writes the new prices back into the batch.
   2. Ended promos — any sign whose sale end date has passed. Promo signs
      with a SKU (percent off, BOGO, …) get a regular-price replacement
      built from the current shelf price; the batch itself is left alone
      (it still describes the promo) but the item is stamped so the same
      offer doesn't repeat after it's accepted. Ended promos without a
      SKU can't be rebuilt automatically and are only mentioned. */
const BATCH_SCAN_KEY = "acesignstudio.batchscan.v1";

function todayISO() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function scanBatchPricesAtLaunch() {
  if (!Settings.get().batchPriceCheck) return;
  const today = todayISO();
  // ended = the sale ran out before today; a sale ending today still counts
  const isEnded = (q) =>
    /^\d{4}-\d{2}-\d{2}$/.test(String(q.spec.endDate || "")) &&
    q.spec.endDate < today && !q.spec._endedOffered;
  const priceTargets = [], endedTargets = [], endedNoSku = [];
  for (const name of Batches.names()) {
    for (const q of Batches.data[name].items || []) {
      if (!q.spec) continue;
      const sku = String(q.spec.sku || "").trim();
      if (sku && PRICE_REFRESH_TYPES[q.typeId]) priceTargets.push({ name, q });
      else if (isEnded(q)) (sku ? endedTargets : endedNoSku).push({ name, q });
    }
  }
  if (!priceTargets.length && !endedTargets.length) return;
  // a crash-loop / quick relaunch shouldn't hammer acehardware.com —
  // skip only if a scan finished within the last 30 minutes
  try {
    const last = Date.parse(localStorage.getItem(BATCH_SCAN_KEY) || "");
    if (!isNaN(last) && Date.now() - last < 30 * 60000) return;
  } catch (e) {}

  const skus = [...new Set(priceTargets.concat(endedTargets).map((t) => String(t.q.spec.sku).trim()))];
  const bySku = new Map();
  const work = skus.slice();
  const runOne = async () => {
    const sku = work.shift();
    if (sku == null) return;
    try {
      const res = await fetch(`/api/lookup?q=${encodeURIComponent(sku)}&refresh=1&store=${encodeURIComponent(Settings.get().storeCode)}`).then((r) => r.json());
      if (res.ok) bySku.set(sku, res);
    } catch (e) { /* offline / backend gone — just no offer this launch */ }
    await runOne();
  };
  await Promise.all(Array.from({ length: Math.min(3, skus.length) }, runOne));
  if (!bySku.size) return;
  try { localStorage.setItem(BATCH_SCAN_KEY, new Date().toISOString()); } catch (e) {}

  // apply to copies first — the stored batches only change if the user accepts
  const changed = []; // {name, stored, updated} — price moved, batch gets the update
  const ended = [];   // {name, stored, updated} — promo over, replacement queued only
  for (const t of priceTargets) {
    const res = bySku.get(String(t.q.spec.sku).trim());
    if (!res) continue;
    const updated = JSON.parse(JSON.stringify(t.q));
    if (applyPriceResult(updated, res)) {
      changed.push({ name: t.name, stored: t.q, updated });
    } else if (isEnded(t.q)) {
      // price still right, but the sign shows a sale-date pill that's over
      updated.spec.startDate = "";
      updated.spec.endDate = "";
      ended.push({ name: t.name, stored: t.q, updated });
    }
  }
  for (const t of endedTargets) {
    const res = bySku.get(String(t.q.spec.sku).trim());
    const si = res ? saleInfo(res) : { onSale: false };
    const price = res ? (si.onSale ? si.sale : (res.price || res.listPrice || "")) : "";
    if (!price) { endedNoSku.push(t); continue; } // no price data — mention only
    const src = t.q.spec;
    const spec = {
      sku: src.sku,
      name: src.name || res.name || "",
      detail: src.detail || "",
      image: src.image || res.imageUrl || null,
      price,
      regPrice: si.onSale ? si.reg : "",
      barcode: src.barcode,
      qr: src.qr,
      scale: src.scale, // element-size sliders carry over
      hide: src.hide && src.hide.logo ? { logo: true } : {}, // promo hides don't map to a price sign
      lookedUpAt: (res && res.fetchedAt) || new Date().toISOString(),
    };
    if (res && res.productUrl) spec.productUrl = res.productUrl;
    ended.push({
      name: t.name,
      stored: t.q,
      updated: { typeId: si.onSale ? "sale" : "regular", sizeId: t.q.sizeId, spec, copies: t.q.copies },
    });
  }
  if (changed.length || ended.length) showBatchPriceBar(changed, ended, endedNoSku.length);
}

function showBatchPriceBar(changed, ended, endedNoSkuCount) {
  const bar = $("#batchPriceBar");
  if (!bar) return;
  ended = ended || [];
  const all = changed.concat(ended);
  const batches = [...new Set(all.map((c) => c.name))];
  const bList = batches.slice(0, 3).map((b) => `“${b}”`).join(", ") + (batches.length > 3 ? ` +${batches.length - 3} more` : "");
  // a sign saved in several batches counts (and prints) once
  const uniq = (list) => new Set(list.map((c) => `${c.updated.typeId}|${c.updated.sizeId}|${c.updated.spec.sku}`)).size;
  const nChanged = uniq(changed), nEnded = uniq(ended);
  const parts = [];
  if (nChanged) parts.push(`${nChanged} sign${nChanged === 1 ? "" : "s"} no longer match${nChanged === 1 ? "es" : ""} the shelf price`);
  if (nEnded) parts.push(`${nEnded} sale${nEnded === 1 ? " has" : "s have"} ended and can go back to regular price`);
  let txt = `<b>Saved batches need attention</b> — in ${bList}: ${parts.join(", and ")}. ` +
    `Queue them to print replacements${nChanged ? " — price changes update the batches too" : ""}.`;
  if (endedNoSkuCount) {
    txt += ` ${endedNoSkuCount} more ended promo${endedNoSkuCount === 1 ? " has" : "s have"} no SKU — open their batch to rebuild by hand.`;
  }
  $("#batchPriceText").innerHTML = txt;
  $("#batchPriceQueueBtn").onclick = () => {
    const seen = new Set();
    let added = 0;
    const queueOnce = (u) => {
      const key = `${u.typeId}|${u.sizeId}|${u.spec.sku}`;
      if (seen.has(key)) return;
      seen.add(key);
      Queue.add(u.typeId, u.sizeId, u.spec, u.copies || 1);
      added++;
    };
    for (const c of changed) {
      // write the new price/type into the stored batch item; the rev bump
      // keeps a later "Load batch" from serving the old price out of the
      // rendered-SVG cache (batch items keep their uid when reloaded)
      c.stored.typeId = c.updated.typeId;
      c.stored.spec = c.updated.spec;
      Queue._bumpRev(c.stored);
      queueOnce(c.updated);
    }
    for (const c of ended) {
      // the batch keeps the promo sign (it may run again) — just remember
      // the offer was taken so it doesn't repeat every launch
      c.stored.spec._endedOffered = todayISO();
      queueOnce(c.updated);
    }
    persistState();
    bar.classList.remove("show");
    const notes = [];
    if (changed.length) notes.push("the batches now carry the new prices");
    if (ended.length) notes.push("ended promos stay in their batches for next time");
    showToast(`Queued ${added} replacement sign${added === 1 ? "" : "s"} — ${notes.join("; ")}.`);
  };
  $("#batchPriceDismiss").onclick = () => bar.classList.remove("show");
  bar.classList.add("show");
}

/* ---------------- print history ---------------- */
function fmtHistDate(iso) {
  const t = Date.parse(iso);
  if (isNaN(t)) return "—";
  const d = new Date(t);
  const hh = d.getHours() % 12 || 12;
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${hh}:${String(d.getMinutes()).padStart(2, "0")}${d.getHours() < 12 ? "am" : "pm"}`;
}

function openHistory() {
  renderHistoryList();
  $("#historyModal").classList.add("show");
}

function renderHistoryList() {
  const host = $("#historyList");
  host.innerHTML = "";
  if (!History.data.length) {
    host.appendChild(el("div", "queue-empty", "Nothing printed yet — Print All, Save PDF, and single-sign prints will appear here."));
    return;
  }
  for (const h of History.data) {
    const row = el("div", "batch-row");
    const info = el("div", "batch-info");
    const names = (h.items || []).map((q) => queueItemTitle(q)).filter(Boolean);
    info.appendChild(el("div", "batch-name", `${h.kind === "pdf" ? "PDF" : "🖨 Print"} · ${fmtHistDate(h.at)}${h.by ? ` · ${h.by}` : ""}`));
    info.appendChild(el("div", "batch-sub",
      `${h.signs} sign${h.signs === 1 ? "" : "s"} — ${names.slice(0, 3).join(", ")}${names.length > 3 ? `, +${names.length - 3} more` : ""}`));
    const load = el("button", "btn btn-secondary btn-sm", "Restore");
    load.title = "Put this exact set back in the print queue";
    load.onclick = () => {
      const prev = Queue.items;
      Queue.replaceAll(h.items || []);
      const gen = Queue._gen;
      $("#historyModal").classList.remove("show");
      showToast(`Restored ${h.signs} sign${h.signs === 1 ? "" : "s"} from ${fmtHistDate(h.at)} — replaced the queue.`, {
        undo: () => {
          // the snapshot is only safe while the queue hasn't diverged
          if (Queue._gen !== gen) return showToast("The queue changed since the restore — undo unavailable.");
          Queue.replaceAll(prev);
        },
      });
    };
    row.appendChild(info);
    row.appendChild(load);
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

/* Price age past which a queued sign is worth re-checking before it goes on
   a shelf — same threshold as the amber badge on the queue row. */
const STALE_PRICE_DAYS = 3;

/* Queued signs whose price is stale or was never checked. Limited to the
   types "↻ Prices" can refresh; everything else is hand-entered and has no
   SKU to look up. */
function stalePricedItems() {
  return Queue.items.filter((q) => {
    if (!PRICE_REFRESH_TYPES[q.typeId] || !String(q.spec.sku || "").trim()) return false;
    const age = priceAgeDays(q.spec);
    return age == null || age > STALE_PRICE_DAYS;
  });
}

/* Last stop before an out-of-date price reaches a shelf. The queue persists
   for weeks and batches get reloaded months later, so "load last spring's
   sale, hit Print All" is one distracted click — and a wrong shelf price is
   the most expensive mistake this app can make. Offers the fix (refresh
   first) rather than just blocking. */
function promptStalePrices(stale, print) {
  const modal = $("#stalePriceModal");
  const never = stale.filter((q) => priceAgeDays(q.spec) == null).length;
  const ages = stale.map((q) => priceAgeDays(q.spec)).filter((d) => d != null);
  const oldest = ages.length ? Math.max(...ages) : null;

  const bits = [`<b>${stale.length} sign${stale.length === 1 ? "" : "s"}</b> in this queue `
    + `${stale.length === 1 ? "has a price" : "have prices"} that ${stale.length === 1 ? "hasn't" : "haven't"} been checked recently`];
  if (oldest != null) bits.push(`the oldest is <b>${oldest} days</b> old`);
  if (never) bits.push(`${never} ${never === 1 ? "has" : "have"} never been checked`);
  $("#staleIntro").innerHTML = bits.join(" — ") + ".";

  const list = $("#staleList");
  list.innerHTML = "";
  for (const q of stale.slice(0, 12)) {
    const row = el("div", "stale-row");
    row.appendChild(el("span", "sr-name", queueItemTitle(q)));
    const age = priceAgeDays(q.spec);
    row.appendChild(el("span", "q-stale sr-age", age == null ? "never checked" : `${age}d old`));
    list.appendChild(row);
  }
  if (stale.length > 12) list.appendChild(el("div", "stale-row", `…and ${stale.length - 12} more`));

  $("#staleRefreshBtn").onclick = async () => {
    modal.classList.remove("show");
    await refreshQueuePrices();
    exportQueue(print, { skipStaleCheck: true });
  };
  $("#staleProceedBtn").onclick = () => {
    modal.classList.remove("show");
    exportQueue(print, { skipStaleCheck: true });
  };
  modal.classList.add("show");
}

async function exportQueue(print, opts) {
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
  if (!(opts && opts.skipStaleCheck)) {
    const stale = stalePricedItems();
    if (stale.length) {
      promptStalePrices(stale, print);
      return;
    }
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
    History.record(print ? "print" : "pdf", Queue.items);
  } catch (e) {
    alert("Export failed: " + friendlyError(e) + ".");
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
            productUrl: res.productUrl || undefined,
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
  $("#setBatchPriceCheck").checked = !!s.batchPriceCheck;
  $("#setSyncRepo").value = s.syncRepo || "";
  $("#setSyncToken").value = s.syncToken || "";
  $("#setSyncName").value = s.syncName || "";
  if (window.__appHost) $("#setSyncName").placeholder = `This computer's name (e.g. ${window.__appHost})`;
  syncStatusUI();
  $("#setMargin").value = String(s.margin);
  $("#setTemplateSku").value = s.templateSku || "81995";
  initSettingsUpdates();
  $("#settingsModal").classList.add("show");
  $("#settingsSave").onclick = () => {
    const prevTemplate = Settings.get().templateSku || "81995";
    Settings.set({
      storeCode: $("#setStore").value.trim() || "12180",
      storeLine: $("#setStoreLine").value.trim(),
      printStoreLine: $("#setPrintStoreLine").checked,
      cutGuides: $("#setCutGuides").checked,
      batchPriceCheck: $("#setBatchPriceCheck").checked,
      syncRepo: $("#setSyncRepo").value.trim() || "codysuter/ace-sign-sync",
      syncToken: $("#setSyncToken").value.trim(),
      syncName: $("#setSyncName").value.trim(),
      margin: Math.min(0.6, Math.max(0.25, parseFloat($("#setMargin").value) || 0.375)),
      templateSku: $("#setTemplateSku").value.trim() || "81995",
    });
    $("#settingsModal").classList.remove("show");
    $("#storeLineTop").textContent = Settings.get().storeLine || "Snyder's Ace Hardware";
    if (Settings.get().templateSku !== prevTemplate) {
      try { localStorage.removeItem("acesignstudio.template.v1"); } catch (e) {}
      loadTemplateProduct();
    }
    Sync.start(); // pick up sync repo/token changes immediately
    renderQueue();
  };
}

/* Settings → Updates: on-demand update check + the version history. */
function initSettingsUpdates() {
  const status = $("#settingsUpdateStatus");
  const btn = $("#settingsUpdateBtn");
  if (!status || !btn) return;
  status.textContent = window.__appVersion ? `You have v${window.__appVersion}.` : "";
  btn.disabled = false;
  btn.onclick = async () => {
    btn.disabled = true;
    status.textContent = "Checking…";
    try {
      const st = await fetch("/api/update/check", { cache: "no-store" }).then((r) => r.json());
      if (st.available) {
        status.textContent = `v${st.latest} is available — close Settings and use the “${st.canApply ? "Update & Restart" : "Download"}” banner at the top.`;
      } else if (st.error) {
        status.textContent = `Couldn't check for updates: ${st.error}. Are you online?`;
      } else {
        status.textContent = `You're up to date — v${st.current} is the latest.`;
      }
      if (!st.error) renderUpdateBar(st); // also hides a stale banner on "up to date"
    } catch (e) {
      status.textContent = "Couldn't check for updates: " + friendlyError(e) + ".";
    } finally {
      btn.disabled = false;
    }
  };

  // Version history (rebuilt each open: the current-version tag depends on
  // __appVersion, which arrives async at boot).
  const list = $("#changelogList");
  if (!list || typeof CHANGELOG === "undefined") return;
  list.innerHTML = "";
  for (const entry of CHANGELOG) {
    const head = el("div", "cl-head");
    head.appendChild(el("span", "cl-version", "v" + entry.version));
    if (entry.version === window.__appVersion) head.appendChild(el("span", "cl-current", "installed"));
    if (entry.date) head.appendChild(el("span", "cl-date", entry.date));
    list.appendChild(head);
    const ul = el("ul", "cl-notes");
    for (const n of entry.notes) ul.appendChild(el("li", null, n));
    list.appendChild(ul);
  }
}
