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
  refreshFavStrip(); // favorites arrive with the saved state, after first paint
  ensureFontsLoaded().then(() => {
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
  initNavDrawer();
  $("#clearQueueBtn").onclick = clearQueueWithUndo;
  $("#refreshPricesBtn").onclick = refreshQueuePrices;
  $("#batchesBtn").onclick = openBatches;
  $("#historyBtn").onclick = openHistory;
  $("#priceCheckBtn").onclick = runPriceCheckReport;
  initDiagnostics();
  $("#printAllBtn").onclick = () => exportQueue(true);
  $("#exportAllBtn").onclick = () => exportQueue(false);
  $("#sheetBox").addEventListener("toggle", () => { if ($("#sheetBox").open) renderSheetPreviews(); });
  $("#selClearBtn").onclick = clearQueueSelection;
  $("#storeLineTop").textContent = Settings.get().storeLine || "Snyder's Ace Hardware";
  initBulk();
  initBackup();
  window.addEventListener("resize", () => schedulePreview()); // re-scale preview to the new window
  document.addEventListener("keydown", editorShortcuts);
  // fold-out sections animate only when someone opens one, not every
  // time the editor rebuilds them already open
  document.addEventListener("click", (e) => {
    const sum = e.target.closest && e.target.closest("summary");
    const box = sum && sum.parentElement;
    if (!box || box.open || !box.matches(".ed-section, .sheet-box, .fine-tune, .mp-extras, .mp-paste")) return;
    box.classList.add("opening");
    setTimeout(() => box.classList.remove("opening"), 260);
  }, true);
  fetch("/api/health", { cache: "no-store" }).then((r) => r.json()).then((h) => {
    window.__appVersion = h.version;
    window.__appHost = h.host;
    window.__builtinSync = !!h.builtinSync;
    maybeOfferSync();
  }).catch(() => {});
  Sync.start();
  $$(".modal-back").forEach((mb) => {
    mb.addEventListener("click", (e) => { if (e.target === mb) mb.classList.remove("show"); });
  });
  $$(".modal-close").forEach((b) => (b.onclick = () => b.closest(".modal-back").classList.remove("show")));
  initModalKeys();
  initPickFeedback();
});

/* Dialogs: Esc closes the one on top; focus moves into a dialog when it
   opens ([data-autofocus] field, else the dialog box) and back to whatever
   opened it when it closes. One observer per dialog covers every place
   that opens or closes one, without touching them. */
function initModalKeys() {
  const openers = new Map();
  for (const mb of $$(".modal-back")) {
    const box = mb.querySelector(".modal");
    if (box && !box.hasAttribute("tabindex")) box.tabIndex = -1;
    new MutationObserver(() => {
      const open = mb.classList.contains("show");
      if (open && !openers.has(mb)) {
        openers.set(mb, document.activeElement);
        if (mb.contains(document.activeElement)) return; // the dialog focused its own field
        const f = mb.querySelector("[data-autofocus]") || box;
        if (f) f.focus({ preventScroll: true });
      } else if (!open && openers.has(mb)) {
        const back = openers.get(mb);
        openers.delete(mb);
        const ae = document.activeElement;
        const lost = !ae || ae === document.body || mb.contains(ae);
        if (back && back !== document.body && back.isConnected && lost) back.focus({ preventScroll: true });
      }
    }).observe(mb, { attributes: true, attributeFilter: ["class"] });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    const open = $$(".modal-back.show");
    if (open.length) {
      // the topmost dialog closes (Price check sits over Saved batches)
      const z = (m) => parseInt(getComputedStyle(m).zIndex, 10) || 0;
      open.reduce((a, b) => (z(b) >= z(a) ? b : a)).classList.remove("show");
      e.preventDefault();
    } else if (document.body.classList.contains("nav-open")) {
      setNavOpen(false);
      $("#navToggleBtn").focus({ preventScroll: true });
    }
  });
}

/* "It took": most picks in the form (style buttons, show-on-sign chips,
   color swatches) rebuild the form, so the clicked button is replaced
   and CSS can't ease it. After the click, find the button that took its
   place, keep keyboard focus on it and give it a short settle. */
function initPickFeedback() {
  const PICK_SEL = ".seg-btn, .size-chip, .swatch:not(.swatch-custom), .quick-chip";
  const scoped = PICK_SEL.split(", ").map((x) => "#editorFields " + x).join(", ");
  const pickLabel = (b) => (b.title || b.textContent).replace(/^[✓✕] /, "");
  let pick = null;
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(PICK_SEL);
    const host = b && b.closest("#editorFields");
    pick = host ? { b, i: $$(scoped).indexOf(b), label: pickLabel(b), wasFocused: document.activeElement === b } : null;
  }, true);
  document.addEventListener("click", () => { // after the button's own handler (and its rebuild)
    const p = pick;
    pick = null;
    if (!p) return;
    let nb = p.b.isConnected ? p.b : null;
    if (!nb) {
      const c = $$(scoped)[p.i];
      if (c && pickLabel(c) === p.label) nb = c;
    }
    if (!nb) return;
    if (p.wasFocused && nb !== document.activeElement) nb.focus({ preventScroll: true });
    if (!previewMotionOK()) return;
    nb.classList.remove("just-picked");
    void nb.offsetWidth;
    nb.classList.add("just-picked");
    nb.addEventListener("animationend", () => nb.classList.remove("just-picked"), { once: true });
  });
}

/* Editor keyboard shortcuts: Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) undo and
   redo, Ctrl+Enter adds the sign to the queue. Off while a dialog or
   menu is open so they never act on something hidden behind it. */
function editorShortcuts(e) {
  if (App.view !== "editor" || !(e.ctrlKey || e.metaKey) || e.altKey) return;
  if ($(".modal-back.show") || (typeof _pickMenuEl !== "undefined" && _pickMenuEl && _pickMenuEl.isConnected)) return;
  const k = e.key.toLowerCase();
  if (k === "enter") {
    e.preventDefault();
    const b = $("#addQueueBtn");
    if (b) b.click();
  } else if (k === "z" && !e.shiftKey) {
    e.preventDefault();
    editorUndo(-1);
  } else if (k === "y" || (k === "z" && e.shiftKey)) {
    e.preventDefault();
    editorUndo(1);
  }
}

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
  btn.classList.add("busy");
  btn.innerHTML = '<span class="spin"></span> Downloading…';
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
    btn.classList.remove("busy");
    btn.textContent = "Retry";
    bar.querySelector("#updateText").innerHTML = `<b>Update failed:</b> ${esc(e.message)}. You can download it manually instead.`;
  }
}

/* ---------------- nav ----------------
   Compact text list. The home gallery is the illustrated menu (big cards
   with live previews); repeating thumbnails and descriptions here just
   duplicated it in miniature and ate a third of the window's width. */
function buildNav() {
  const nav = $("#nav");
  nav.innerHTML = "";
  const groups = [...new Set(menuTypes().map((t) => t.group))];
  const sec = (title) => {
    const s = el("div", "nav-section");
    s.appendChild(el("div", "nav-head", title));
    nav.appendChild(s);
    return s;
  };
  const home = sec("Ace Sign Studio");
  const homeBtn = el("button", "nav-item", "⌂ All sign types");
  homeBtn.title = "Gallery & previews";
  homeBtn.onclick = showGallery;
  homeBtn.id = "nav-home";
  home.appendChild(homeBtn);

  for (const g of groups) {
    const s = sec(g);
    for (const t of menuTypes().filter((x) => x.group === g)) {
      const b = el("button", "nav-item", menuLabel(t));
      b.dataset.type = t.id;
      if (t.family) b.dataset.family = t.family;
      b.title = menuNote(t) || "";
      // a family entry reopens the member last used this session
      b.onclick = () => showEditor(t.family ? (App._familyLast && App._familyLast[t.family]) || t.id : t.id);
      s.appendChild(b);
    }
  }
}

function markActiveNav() {
  $$(".nav-item").forEach((b) => b.classList.remove("active"));
  if (App.view === "gallery") $("#nav-home") && $("#nav-home").classList.add("active");
  else if (App.typeId) {
    const cur = typeById(App.typeId);
    const b = cur && cur.family ? $(`.nav-item[data-family="${cur.family}"]`) : $(`.nav-item[data-type="${App.typeId}"]`);
    b && b.classList.add("active");
  }
  moveNavIndicator();
}

/* One red "you are here" bar for the whole list that glides to the picked
   sign type instead of blinking from row to row. Purely visual: it never
   takes clicks. Jumps (no glide) on first draw and with motion turned off. */
function moveNavIndicator() {
  const nav = $("#nav");
  if (!nav) return;
  let ind = nav.querySelector(":scope > .nav-indicator");
  const fresh = !ind;
  if (fresh) {
    ind = el("div", "nav-indicator");
    ind.setAttribute("aria-hidden", "true");
    nav.prepend(ind);
    nav.classList.add("has-indicator");
  }
  const a = nav.querySelector(".nav-item.active");
  if (!a || !a.offsetHeight) { ind.style.opacity = "0"; return; }
  const jump = fresh || ind.style.opacity !== "1" || !previewMotionOK();
  if (jump) ind.style.transition = "none";
  ind.style.transform = `translateY(${a.offsetTop + 5}px)`;
  ind.style.height = Math.max(8, a.offsetHeight - 10) + "px";
  ind.style.opacity = "1";
  if (jump) { void ind.offsetWidth; ind.style.transition = ""; }
}

/* Narrow windows (under 1400px): while a sign is open, the sign-type list
   folds away so the preview gets its width, and comes back as a drawer
   from the "☰ Sign types" button. Picking a type closes the drawer. */
function navCompact() {
  return App.view === "editor" && window.innerWidth < 1400;
}
function applyNavMode() {
  const was = document.body.classList.contains("nav-compact");
  const now = navCompact();
  document.body.classList.toggle("nav-compact", now);
  if (!now) setNavOpen(false);
  // leaving drawer mode (editor -> gallery on a narrow screen): the rail
  // slides back in instead of popping
  if (was && !now && previewMotionOK()) {
    const nav = $("#nav");
    nav.classList.remove("nav-return");
    void nav.offsetWidth;
    nav.classList.add("nav-return");
    setTimeout(() => nav.classList.remove("nav-return"), 260);
  }
  if (was !== now) moveNavIndicator(); // the rail changed width
}
/* The drawer's open state lives on <body>; the toggle mirrors it for
   screen readers (and looks pressed while the drawer is out). */
function setNavOpen(open) {
  document.body.classList.toggle("nav-open", open);
  const b = $("#navToggleBtn");
  if (b) b.setAttribute("aria-expanded", String(open));
}
function initNavDrawer() {
  $("#navToggleBtn").onclick = (e) => {
    e.stopPropagation();
    const open = !document.body.classList.contains("nav-open");
    setNavOpen(open);
    if (!open) return;
    // the current sign type is in view when the drawer opens
    const nav = $("#nav");
    const a = $("#nav .nav-item.active") || $("#nav .nav-item[data-type]");
    if (!a) return;
    if (a.offsetTop < nav.scrollTop || a.offsetTop + a.offsetHeight > nav.scrollTop + nav.clientHeight)
      nav.scrollTop = Math.max(0, a.offsetTop - nav.clientHeight / 3);
    if (e.detail === 0) a.focus({ preventScroll: true }); // opened from the keyboard
  };
  $("#nav").addEventListener("click", (e) => {
    if (e.target.closest(".nav-item")) setNavOpen(false);
  });
  document.addEventListener("click", (e) => {
    if (document.body.classList.contains("nav-open") && !e.target.closest("#nav")) setNavOpen(false);
  });
  window.addEventListener("resize", applyNavMode);
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

/* Gallery thumbnails, kept so a trip back Home shows every sample at once
   instead of redrawing them one by one (gallery only, never printed). */
const _thumbCache = new Map(); // typeId -> thumbnail SVG markup
function refreshTypeThumbs() {
  _thumbCache.clear();
  ensureFontsLoaded().then(async () => {
    for (const t of SIGN_TYPES) {
      const g = $(`#g-prev-${t.id}`);
      if (!g) continue;
      const s = await typeThumbSVG(t, 190, 100);
      if (s) _thumbCache.set(t.id, s);
      if (g.isConnected) g.innerHTML = s;
    }
  });
}

/* ---------------- gallery ---------------- */
function showGallery() {
  const work = $("#work");
  // keyboard users land back on the sign type they just left; the gallery
  // comes back scrolled to where it was
  const cameFrom = App.view === "editor" ? typeById(App.typeId) : null;
  const keepScroll = App.view === "gallery" ? work.scrollTop : (App._galleryScroll || 0);
  const again = !!App._galleryShown;
  App._galleryShown = true;
  App.view = "gallery";
  App._fieldBaseline = null;
  if (App.editingUid) { App.editingUid = null; renderQueue(); }
  markActiveNav();
  applyNavMode();
  work.innerHTML = `
    <div class="work-inner work-gallery">
      <div class="gallery-head">
        <h2>What are we making today?</h2>
        <p>Pick a sign type — live pricing fills in automatically from acehardware.com for store #${esc(Settings.get().storeCode)}. Every sign can go to the print queue.</p>
      </div>
      <div id="favStrip"></div>
      <div class="gallery${again ? " again" : ""}" id="gallery"></div>
    </div>`;
  buildFavoritesStrip($("#favStrip"));
  $("#favStrip").dataset.sig = favStripSig();
  const g = $("#gallery");
  menuTypes().forEach((t, i) => {
    const card = el("button", "g-card");
    card.style.setProperty("--i", String(Math.min(i, 10)));
    card.innerHTML = `<div class="g-prev" id="g-prev-${t.id}"></div><div class="g-label">${esc(menuLabel(t))}</div><div class="g-note">${esc(menuNote(t) || "")}</div>`;
    const cached = _thumbCache.get(t.id);
    if (cached) card.querySelector(".g-prev").innerHTML = cached;
    card.onclick = (e) => {
      // the picked sample flies onto the editor's preview spot (overlay only)
      const th = card.querySelector(".g-prev svg");
      const r = th && th.getBoundingClientRect();
      App._flyer = r && r.width && previewMotionOK() ? { html: th.outerHTML, from: r, at: performance.now() } : null;
      showEditor(t.id);
      // Enter/Space on the card: carry on typing in the first box (the SKU)
      if (e.detail === 0) { const f = $("#editorFields input.f-input"); if (f) f.focus({ preventScroll: true }); }
    };
    g.appendChild(card);
    if (cameFrom && (t.id === cameFrom.id || (cameFrom.family && t.family === cameFrom.family))) card.focus({ preventScroll: true });
  });
  work.scrollTop = keepScroll; // card heights are fixed, so this lands exactly
  buildGalleryThumbs();
}

async function buildGalleryThumbs() {
  if (App.view !== "gallery") return;
  await ensureFontsLoaded();
  for (const t of SIGN_TYPES) {
    const holder = $(`#g-prev-${t.id}`);
    if (!holder || holder.firstChild) continue;
    const s = _thumbCache.get(t.id) || await typeThumbSVG(t, 190, 100);
    if (s) _thumbCache.set(t.id, s);
    if (holder.isConnected && !holder.firstChild) holder.innerHTML = s;
  }
}

/* ---------------- Ace editor ---------------- */
function showEditor(typeId, opts) {
  const o = opts || {};
  const t = typeById(typeId);
  if (!t) return;
  const prevTypeId = App.typeId;
  const wasEditor = App.view === "editor"; // editor -> editor: same screen, new sign
  if (!wasEditor) {
    App._galleryScroll = $("#work").scrollTop;
    App._msgMemo = {}; // a fresh sign's first notes still ease in
  }
  App.view = "editor";
  App.typeId = typeId;
  App.userPickedType = true;
  if (!t.sizes && !SIZES.some((s) => s.id === App.sizeId)) App.sizeId = "letter-l";
  if (t.sizes && !t.sizes.includes(App.sizeId)) App.sizeId = t.defaultSize;
  // keep shared fields (sku/name/image/price) when switching types;
  // while editing a queued sign the spec is taken verbatim (no batch dates)
  const keep = App.spec || {};
  App.spec = App.editingUid ? keep : Object.assign({ startDate: App.batchStart, endDate: App.batchEnd }, keep);
  if (!App.editingUid) {
    if (t.id === "multi") {
      // A multi spec holds only its products. Arriving from a single sign
      // with something typed in it, that sign becomes product 1 — the same
      // "keep your work when switching types" courtesy the shared fields
      // get. Products parked when the user last left the Multi editor come
      // back too.
      let products = Array.isArray(keep.products) && keep.products.length ? keep.products : null;
      if (!products && Array.isArray(App._multiParked) && App._multiParked.length) products = App._multiParked;
      if (!products) {
        const single = Object.assign({}, keep);
        delete single.products;
        const carried = prevTypeId && prevTypeId !== "multi" && typeById(prevTypeId) &&
          (String(single.sku || "").trim() || String(single.name || "").trim());
        products = carried ? [{ typeId: prevTypeId, spec: single }] : [];
      }
      App._multiParked = null;
      App.spec = { products };
    } else if (App.spec.products) {
      // leaving Multi: park the products so coming back restores them, and
      // keep that payload (photos included) off every single sign built
      // in between
      App._multiParked = App.spec.products;
      delete App.spec.products;
    }
  }
  if (t.family) (App._familyLast || (App._familyLast = {}))[t.family] = t.id;
  markActiveNav();
  applyNavMode();

  const work = $("#work");
  // Editor -> editor keeps the old drawing on screen until the new one
  // lands (it cross-fades, see setPreviewSVG), so the preview never blanks.
  const oldHolder = wasEditor ? $("#signHolder") : null;
  const carrySvg = oldHolder && oldHolder.querySelector("svg");
  const carryKey = oldHolder && oldHolder._signKey;
  const stay = wasEditor ? (typeId !== prevTypeId ? " stay retype" : " stay") : "";
  work.innerHTML = `
    <div class="work-inner work-editor${stay}">
      <div class="edit-banner" id="editBanner" style="display:none">✏️ Editing a queued sign — <b>&nbsp;Update Sign&nbsp;</b> saves your changes to it.<span class="link" id="cancelEditBtn">Cancel</span></div>
      <div class="editor-grid">
        <div class="card">
          <div class="card-head editor-head">
            <div class="editor-title"><h2>${esc(menuLabel(t))}</h2><span class="hint">${esc(menuNote(t) || "")}</span></div>
            <div class="editor-tools">
              <button class="btn btn-ghost btn-sm tool-btn" id="undoBtn" title="Undo (Ctrl+Z)" disabled>↶ Undo</button>
              <button class="btn btn-ghost btn-sm tool-btn" id="redoBtn" title="Redo (Ctrl+Y)" disabled>↷ Redo</button>
              <button class="btn btn-ghost btn-sm tool-btn" id="favBtn" title="Save this sign's look, or use a saved one">★ Favorites</button>
              <button class="btn btn-ghost btn-sm tool-btn" id="startOverBtn" title="Clear this sign and start a new one">New sign</button>
            </div>
          </div>
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
              <button class="btn btn-primary" id="addQueueBtn" title="Ctrl+Enter">＋ Add to Queue</button>
              <button class="btn btn-ghost" id="editorMoreBtn" title="Print or save just this sign">⋯</button>
            </div>
            <div class="msg" id="editorMsg"></div>
          </div>
        </div>
      </div>
    </div>`;
  if (carrySvg) {
    const h = $("#signHolder");
    carrySvg.style.pointerEvents = "none"; // its click handlers belong to the old sign
    h.appendChild(carrySvg);
    h._signKey = carryKey; // _markup stays unset, so the next render always swaps
  }
  // a new sign opens at its first field (a type switch mid-form keeps its place)
  if (!o.keepPlace) work.scrollTop = 0;
  buildSizeChips(t);
  buildEditorFields(t);
  // Add / Print are never blocked: the sign goes out exactly as the
  // preview shows it. Unfinished-looking fields are only marked, with a
  // heads-up next to the confirmation.
  $("#addQueueBtn").onclick = () => {
    const note = markProblems(t);
    if (App.editingUid) {
      const uid = App.editingUid;
      // the updated row flashes once on the final redraw (after edit mode ends)
      _qFlash.add(uid);
      const updated = Queue.update(uid, t.id, App.sizeId, App.spec);
      App.editingUid = null;
      updateEditMode();
      _qFlash.clear();
      pulseDone($("#addQueueBtn"));
      if (updated) {
        showMsg("editorMsg", note ? "warn" : "ok", "Sign updated in the queue." + note);
        showToast("Sign updated.", { kind: "ok" });
      } else {
        // the row was deleted while editing — keep the work, add as new
        flyToQueue();
        Queue.add(t.id, App.sizeId, App.spec);
        showMsg("editorMsg", note ? "warn" : "ok", "That sign was no longer in the queue — added it as a new one." + note);
      }
      return;
    }
    flyToQueue(); // decoration only: the sign is queued right here, at once
    Queue.add(t.id, App.sizeId, App.spec);
    pulseDone($("#addQueueBtn"));
    const n = Queue.totalSigns();
    showMsg("editorMsg", note ? "warn" : "ok", `Added to queue — ${n} sign${n === 1 ? "" : "s"} queued.` + note);
  };
  $("#cancelEditBtn").onclick = () => {
    App.editingUid = null;
    updateEditMode();
    showMsg("editorMsg", "ok", "Edit cancelled — the button adds a new sign again.");
  };
  // Printing lives in the queue — one pathway, one primary action per
  // panel. The single-sign shortcuts stay reachable behind ⋯ for the
  // "just this one, right now" case.
  // while a print or PDF is being built: a neutral busy line with a
  // spinner, and a progress cursor on ⋯ (it stays clickable)
  const busyMore = (on) => {
    const more = $("#editorMoreBtn");
    if (!more) return;
    if (on) more.setAttribute("aria-busy", "true");
    else more.removeAttribute("aria-busy");
  };
  const printOne = async () => {
    markProblems(t);
    showMsg("editorMsg", "busy", "Preparing print…");
    busyMore(true);
    try {
      const doc = await signToPdf({ typeId: t.id, sizeId: App.sizeId, spec: currentRenderSpec() });
      printPdfDoc(doc);
      History.record("print", [editorHistoryItem(t)]);
      showMsg("editorMsg", "ok", "Sent to the print dialog.");
    } catch (e) { showMsg("editorMsg", "err", "Print failed: " + friendlyError(e) + "."); }
    finally { busyMore(false); }
  };
  const pdfOne = async () => {
    markProblems(t);
    showMsg("editorMsg", "busy", "Building PDF…");
    busyMore(true);
    try {
      const doc = await signToPdf({ typeId: t.id, sizeId: App.sizeId, spec: currentRenderSpec() });
      downloadPdfDoc(doc, sanitizeFilename(queueItemTitle({ typeId: t.id, spec: App.spec })) + ".pdf");
      History.record("pdf", [editorHistoryItem(t)]);
      showMsg("editorMsg", "ok", "PDF saved.");
    } catch (e) { showMsg("editorMsg", "err", "PDF failed: " + friendlyError(e) + "."); }
    finally { busyMore(false); }
  };
  $("#editorMoreBtn").onclick = (e) => {
    e.stopPropagation();
    const anchor = $("#editorMoreBtn");
    // a second click on ⋯ closes its menu instead of rebuilding it
    if (_pickMenuEl && _pickMenuEl.isConnected && _pickMenuEl._anchor === anchor) { closeBatchPickMenu(); return; }
    closeBatchPickMenu();
    const menu = el("div", "pick-menu");
    const entry = (label, fn) => {
      const b = el("button", "pick-item", label);
      b.onclick = (ev) => { ev.stopPropagation(); closeBatchPickMenu(); fn(); };
      menu.appendChild(b);
    };
    entry("🖨 Print just this sign", printOne);
    entry("Save this sign as a PDF", pdfOne);
    document.body.appendChild(menu);
    _pickMenuEl = menu;
    markMenuAnchor(menu, anchor);
    const r = anchor.getBoundingClientRect();
    menu.style.top = Math.max(8, Math.min(window.innerHeight - menu.offsetHeight - 8, r.bottom + 4)) + "px";
    menu.style.left = Math.max(8, r.right - menu.offsetWidth) + "px";
    // opened from the keyboard: land on the first choice
    if (e.detail === 0) { const first = menu.querySelector(".pick-item"); if (first) first.focus(); }
    setTimeout(() => document.addEventListener("click", closeBatchPickMenu, { once: true }), 0);
  };
  $("#undoBtn").onclick = () => editorUndo(-1);
  $("#redoBtn").onclick = () => editorUndo(1);
  $("#startOverBtn").onclick = () => startOverSign(t);
  $("#favBtn").onclick = (e) => { e.stopPropagation(); showFavoritesMenu($("#favBtn")); };
  App._showErrors = false;
  updateEditMode();
  EditorHistory.reset();
  schedulePreview();
}

/* On Add/Print: mark every field that looks unfinished in red with its
   own note (the marks clear live as they're filled in). Never blocks —
   returns a short heads-up to append to the confirmation, or "". */
function markProblems(t) {
  const err = validateSpec(t, App.spec);
  App._showErrors = !!err;
  paintAllFieldMessages();
  if (!err) return "";
  // draw the eye to the first unfinished field (brought into view if it
  // is off-screen) with one short red pulse
  const firstBad = $("#editorFields .f-field.has-error");
  if (firstBad && previewMotionOK()) {
    firstBad.scrollIntoView({ block: "nearest", behavior: "smooth" });
    firstBad.classList.remove("just-flagged");
    void firstBad.offsetWidth;
    firstBad.classList.add("just-flagged");
    setTimeout(() => firstBad.classList.remove("just-flagged"), 340);
  }
  const n = $$("#editorFields .f-field.has-error").length;
  return n > 1
    ? ` Heads-up: ${n} fields look unfinished (marked in red) — it was added just as the preview shows.`
    : ` Heads-up: ${err.replace(/\.$/, "")} — it was added just as the preview shows.`;
}

function paintAllFieldMessages() {
  if (App.view !== "editor") return;
  const t = typeById(App.typeId);
  if (!t) return;
  const host = $("#editorFields");
  if (!host) return;
  if (t.id === "multi") {
    for (const card of $$("#multiProducts .mp-card")) {
      const p = App.spec.products && App.spec.products[+card.dataset.product];
      const st = p && typeById(p.typeId);
      if (st) paintFieldMessages(card, st, p.spec, App._showErrors);
      const sum = card.querySelector(".mp-summary");
      if (sum && p) sum.textContent = productSummary(p);
      // a product with a problem never hides it behind a fold
      if (p && card.querySelector(".f-field.has-error") && card.classList.contains("folded")) setCardFolded(card, p, false);
    }
  } else {
    paintFieldMessages(host, t, App.spec, App._showErrors);
  }
  if (App._showErrors && !validateSpec(t, App.spec)) {
    App._showErrors = false;
    const m = $("#editorMsg");
    if (m && m.classList.contains("warn")) m.className = "msg";
  }
}

/* Undo/redo: restore the snapshot, then rebuild the form around it,
   keeping the cursor in the field it was in. */
function editorUndo(delta) {
  const t = typeById(App.typeId);
  if (!t || App.view !== "editor") return;
  closeInlineEdit();
  const ae = document.activeElement;
  const focusKey = ae && ae.dataset ? ae.dataset.field : null;
  const prev = JSON.parse(JSON.stringify(App.spec));
  if (!EditorHistory.go(delta)) return;
  buildSizeChips(t);
  buildEditorFields(t);
  schedulePreview();
  if (focusKey) {
    const inp = $(`#editorFields [data-field="${focusKey}"]`);
    if (inp) inp.focus({ preventScroll: true });
  }
  flashUndone(prev);
}

/* After Undo/Redo: the fields that came back get a short neutral flash,
   so staff can see what changed. Things that aren't a text box flash
   their section instead. */
function flashUndone(prev) {
  const host = $("#editorFields");
  if (!host || !previewMotionOK() || App.typeId === "multi") return;
  const SECTION = { scale: "#scaleWrap", hide: "#toggleWrap", arrange: "#secLayout > summary", style: "#secLayout > summary", nudge: "#secLayout > summary", extras: "#secExtras > summary", image: ".img-drop" };
  const hits = [];
  for (const k of new Set([...Object.keys(prev), ...Object.keys(App.spec)])) {
    if (k.startsWith("_") || JSON.stringify(prev[k]) === JSON.stringify(App.spec[k])) continue;
    const x = host.querySelector(SECTION[k] || `[data-field="${k}"]`);
    if (x && !hits.includes(x)) hits.push(x);
  }
  flashEls(hits.slice(0, 6), "neutral");
}

/* New sign: wipe the form (the sale dates stay, they're usually the same
   for the whole batch), with Undo in the toast. */
function startOverSign(t) {
  const before = JSON.parse(JSON.stringify(App.spec));
  App.spec = t.id === "multi" ? { products: [] } : { startDate: App.batchStart, endDate: App.batchEnd };
  App._showErrors = false;
  App._crossfadeNext = true; // the filled sign fades to the empty one
  buildEditorFields(t);
  schedulePreview();
  const f = $("#editorFields");
  if (f && previewMotionOK()) { f.classList.remove("form-in"); void f.offsetWidth; f.classList.add("form-in"); }
  const m = $("#editorMsg");
  if (m) m.className = "msg";
  const first = $("#editorFields input.f-input");
  if (first) first.focus();
  showToast("Started a new sign.", { undo: () => { App.spec = before; App._crossfadeNext = true; buildEditorFields(t); schedulePreview(); } });
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
  App._crossfadeNext = true; // a different product cross-fades instead of gliding
  showEditor(item.typeId);
}

function currentRenderSpec() {
  const spec = Object.assign({}, App.spec);
  const hide = spec.hide;
  delete spec.hide;
  return applyHiddenFields(spec, hide);
}

function validateSpec(t, spec) {
  // required fields, in form order (see specProblems in editor-assist.js)
  const problems = specProblems(t, spec);
  if (problems.length) return problems[0].msg;
  if (t.id === "multi") {
    // every product is validated by its own type's rules, named by slot
    // so the message points at the card to fix
    const products = Array.isArray(spec.products) ? spec.products : [];
    if (products.length < MULTI_MIN_PRODUCTS) return `Add at least ${MULTI_MIN_PRODUCTS} products.`;
    if (products.length > MULTI_MAX_PRODUCTS) return `A Multi Product sign holds at most ${MULTI_MAX_PRODUCTS} products.`;
    for (let i = 0; i < products.length; i++) {
      const p = products[i] || {};
      const st = typeById(p.typeId);
      if (!st || st.id === "multi") return `Product ${i + 1}: pick a sign style.`;
      const err = validateSpec(st, p.spec || {});
      if (err) return `Product ${i + 1}: ${err}`;
    }
  }
  return null;
}

/* One dropdown instead of nine chips wrapping into three rows — the chips
   spent most of the preview header on the eight sizes NOT in use. */
function buildSizeChips(t) {
  const wrap = $("#sizeChips");
  wrap.innerHTML = "";
  const sizes = sizesForType(t);
  if (!sizes.some((s) => s.id === App.sizeId)) App.sizeId = sizes[0].id;
  const sel = el("select", "f-select size-select");
  sel.id = "sizeSelect";
  sel.title = "Physical sign size — the preview is print-exact";
  for (const s of sizes) {
    const o = el("option", null, s.label.replace(/"$/, "″"));
    o.value = s.id;
    if (s.id === App.sizeId) o.selected = true;
    sel.appendChild(o);
  }
  sel.onchange = () => { App.sizeId = sel.value; schedulePreview(); };
  wrap.appendChild(sel);
}

/* Which fields were on screen before this click. Several rebuilds in one
   action (a type switch runs two) all compare to the same baseline, which
   only moves on the next frame. Fields that weren't there ease in; the
   ones the user was looking at stay perfectly still. */
function fieldKeys(host) {
  return new Set($$(".f-field[data-key]", host).map((b) => b.dataset.key));
}
function markNewFields(host, baseline) {
  if (baseline && baseline.size && previewMotionOK()) {
    for (const b of $$(".f-field[data-key]", host)) if (!baseline.has(b.dataset.key)) b.classList.add("f-new");
  }
  if (!App._baselineArmed) {
    App._baselineArmed = true;
    requestAnimationFrame(() => {
      App._baselineArmed = false;
      const h = $("#editorFields");
      App._fieldBaseline = h && App.view === "editor" ? fieldKeys(h) : null;
    });
  }
}

/* What had focus in the editor, described so it can be found again after
   the form (or the whole editor) is rebuilt. */
function captureEditorFocus() {
  const ae = document.activeElement;
  if (!ae || !ae.closest || !ae.closest("#work")) return null;
  const box = ae.closest(".f-field");
  const card = ae.closest(".mp-card");
  return {
    id: ae.id || null,
    field: (ae.dataset && ae.dataset.field) || null,
    key: box ? box.dataset.key : null,
    product: card ? card.dataset.product : null,
    idx: ae.classList.contains("seg-btn") ? [...ae.parentElement.children].indexOf(ae) : -1,
    sel: typeof ae.selectionStart === "number" ? [ae.selectionStart, ae.selectionEnd] : null,
  };
}
function restoreEditorFocus(f) {
  if (!f) return;
  // never back into a rebuilt SKU box: its fresh lookup would re-run on
  // blur and put the looked-up name/price back over later edits
  if (f.field === "sku") return;
  const scope = f.product != null ? $(`#multiProducts .mp-card[data-product="${f.product}"]`) : $("#editorFields");
  let n = null;
  if (f.field && scope) n = scope.querySelector(`[data-field="${f.field}"]`);
  else if (f.key && f.idx >= 0 && scope) { const row = scope.querySelector(`.f-field[data-key="${f.key}"] .seg`); n = row && row.children[f.idx]; }
  else if (f.id) n = document.getElementById(f.id);
  if (!n || n === document.activeElement) return;
  n.focus({ preventScroll: true });
  if (f.sel && n.setSelectionRange) { try { n.setSelectionRange(f.sel[0], f.sel[1]); } catch (e) {} }
}

function buildEditorFields(t) {
  const host = $("#editorFields");
  const baseline = App._fieldBaseline;
  host.innerHTML = "";
  // Progressive disclosure: the daily flow is SKU → price fills in → Add to
  // Queue. Power controls (unit, barcode/QR, show-on-sign toggles, element
  // sliders) live in one collapsed section that remembers whether the user
  // works with it open.
  const fine = el("details", "fine-tune");
  fine.id = "fineTune";
  try { fine.open = localStorage.getItem("acesignstudio.finetune") === "open"; } catch (e) {}
  fine.addEventListener("toggle", () => {
    try { localStorage.setItem("acesignstudio.finetune", fine.open ? "open" : ""); } catch (e) {}
  });
  fine.appendChild(el("summary", null, "Sizes, hide parts, barcode & QR"));
  const fineBody = el("div", "fine-body");
  fine.appendChild(fineBody);
  const FINE_KEYS = { unit: 1, barcode: 1, qr: 1 };
  // One wrapper per field: its label, input(s), help and the live
  // message line (problem / check / info) painted by paintFieldMessages.
  const fieldBox = (f, dest) => {
    const box = el("div", "f-field");
    box.dataset.key = f.key;
    dest.appendChild(box);
    return box;
  };
  const help = (box, f) => { if (f.help) box.appendChild(el("div", "f-help", f.help)); };
  // Every typed change goes through here: derived values (Instant
  // Savings) follow, then the preview.
  const edited = (key) => {
    for (const k of applyDerived(t, App.spec, key)) {
      const x = $(`#editorFields [data-field="${k}"]`);
      if (x && x !== document.activeElement) x.value = App.spec[k];
    }
    schedulePreview();
  };
  if (t.family) {
    // One sign, several types underneath (the arrows): a picker that
    // switches type and keeps everything typed so far.
    const fam = SIGN_FAMILIES[t.family];
    const box = el("div", "f-field");
    box.dataset.key = "_family";
    box.appendChild(labelEl(fam.pick));
    const row = el("div", "seg");
    for (const [id, label] of fam.members) {
      const b = el("button", "seg-btn" + (id === t.id ? " active" : ""), label);
      b.dataset.member = id;
      b.onclick = () => { if (id !== t.id) switchTypeKeepingSpec(id); };
      row.appendChild(b);
    }
    box.appendChild(row);
    host.appendChild(box);
  }
  for (const f of t.fields) {
    // Fields tagged with `modes` only appear in the matching style (see the
    // Big Text sign's "mode" selector).
    if (f.modes && !f.modes.includes(App.spec.mode)) continue;
    if (f.kind === "products") { buildProductsEditor(t, host); continue; }
    const dest = FINE_KEYS[f.key] ? fineBody : host;
    if (f.kind === "seg") {
      // Segmented style picker; changing it re-filters the fields above.
      if (App.spec[f.key] == null) App.spec[f.key] = f.def;
      const box = fieldBox(f, host);
      box.appendChild(labelEl(f.label));
      const row = el("div", "seg");
      for (const opt of f.options) {
        const b = el("button", "seg-btn" + (App.spec[f.key] === opt.value ? " active" : ""), opt.label);
        b.onclick = () => {
          if (App.spec[f.key] === opt.value) return;
          App.spec[f.key] = opt.value;
          const rf = captureEditorFocus();
          buildEditorFields(t);
          restoreEditorFocus(rf);
          schedulePreview();
        };
        row.appendChild(b);
      }
      box.appendChild(row);
      continue;
    }
    if (f.kind === "sku") {
      const box = fieldBox(f, host);
      box.appendChild(labelEl(f.label));
      const inp = inputEl("text", App.spec.sku || "", "e.g. 7135975 — or paste a product URL");
      inp.dataset.field = "sku";
      const status = el("div", "lookup-status");
      inp.addEventListener("input", () => { App.spec.sku = inp.value.trim(); });
      attachAutoLookup(inp, status, (res, si) => {
        const before = snapFields($("#editorFields"));
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
            switchTypeKeepingSpec("sale", { fromLookup: true });
            const st = $("#editorFields .lookup-status");
            if (st) {
              st.className = "lookup-status ok";
              st.innerHTML = `<span class="lk-ico">✓</span> ${esc(res.name || res.sku)} <span class="sale-flag">On Sale</span> — switched to a Sale sign <button type="button" class="diag-link" onclick="showDiagnostics()">details</button>`;
              const si2 = $("#editorFields [data-field=\"sku\"]");
              if (si2) si2.dataset.lookup = "ok";
            }
          } else if (!t.fields.some((x) => x.key === "regPrice")) {
            // a sign with no regular-price spot: say so, offer the Sale sign
            const hint = el("div", "sale-hint");
            hint.innerHTML = `This item is on sale: <b>$${esc(si.sale)}</b> (reg. $${esc(si.reg)}). The sale price is filled in above.`;
            const sw = el("button", "btn btn-ghost btn-sm", "Use a Sale sign instead");
            sw.onclick = () => switchTypeKeepingSpec("sale");
            hint.appendChild(sw);
            status.appendChild(hint);
          }
        } else {
          if (res.price) setField("price", res.price);
          else if (res.listPrice) setField("price", res.listPrice);
          // a fresh non-sale lookup means any earlier reg price is stale
          if (t.fields.some((x) => x.key === "regPrice") && t.id !== "was_now") setField("regPrice", "");
        }
        if (res.imageUrl) { App.spec.image = res.imageUrl; refreshImageDrop(); }
        const cur = typeById(App.typeId) || t;
        for (const k of applyDerived(cur, App.spec, "*")) setField(k, App.spec[k]);
        App._lookupGlide = performance.now(); // the next redraw glides the sign into its filled-in state
        schedulePreview();
        // re-queried: a switch to a Sale sign rebuilt the form
        flashFilled($("#editorFields"), before);
      });
      box.appendChild(skuWrap(inp));
      box.appendChild(status);
      continue;
    }
    if (f.kind === "image") {
      const box = fieldBox(f, host);
      box.appendChild(labelEl(f.label));
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
      wireDropZone(drop, file);
      box.appendChild(drop);
      setTimeout(refreshImageDrop, 0);
      $("#imgDrop").querySelector("#imgClear").onclick = () => { App.spec.image = null; App.spec._customImage = false; refreshImageDrop(); schedulePreview(); };
      continue;
    }
    if (f.kind === "dates") {
      const box = fieldBox(f, host);
      box.appendChild(labelEl(f.label));
      const row = el("div", "f-row");
      const s = inputEl("date", App.spec.startDate || "");
      const e2 = inputEl("date", App.spec.endDate || "");
      s.title = "First day";
      e2.title = "Last day";
      const clr = el("button", "btn btn-ghost btn-sm", "Clear");
      s.onchange = () => {
        App.spec.startDate = s.value;
        if (s.value && (!e2.value || e2.value < s.value)) { e2.value = plusDaysISO(s.value, 7); App.spec.endDate = e2.value; }
        App.batchStart = s.value; App.batchEnd = e2.value;
        schedulePreview();
      };
      e2.onchange = () => { App.spec.endDate = e2.value; App.batchEnd = e2.value; schedulePreview(); };
      clr.onclick = () => { s.value = ""; e2.value = ""; App.spec.startDate = ""; App.spec.endDate = ""; App.batchStart = ""; App.batchEnd = ""; schedulePreview(); };
      row.appendChild(s); row.appendChild(e2); row.appendChild(clr);
      box.appendChild(row);
      addDatePicks(box, s, e2);
      help(box, f);
      continue;
    }
    if (f.kind === "check") {
      const box = fieldBox(f, dest);
      const lab = el("label", "f-check");
      const cb = el("input");
      cb.type = "checkbox";
      if (App.spec[f.key] == null && f.def != null) App.spec[f.key] = f.def;
      cb.checked = !!App.spec[f.key];
      cb.onchange = () => { App.spec[f.key] = cb.checked; schedulePreview(); };
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(f.label));
      box.appendChild(lab);
      continue;
    }
    const box = fieldBox(f, dest);
    box.appendChild(labelEl(f.label));
    let wrap = null, inp;
    if (f.kind === "money") {
      wrap = el("div", "prefix-wrap");
      wrap.dataset.prefix = "$";
      inp = inputEl("text", App.spec[f.key] != null ? App.spec[f.key] : (f.def != null ? f.def : ""));
      inp.inputMode = "decimal";
    } else if (f.kind === "percent") {
      wrap = el("div", "suffix-wrap");
      wrap.dataset.suffix = "%";
      inp = inputEl("text", App.spec[f.key] || "");
      inp.inputMode = "numeric";
    } else if (f.kind === "int") {
      inp = inputEl("number", App.spec[f.key] != null ? App.spec[f.key] : f.def || 2);
      inp.min = "2"; inp.max = "9";
    } else if (f.kind === "textarea") {
      inp = el("textarea", "f-textarea");
      inp.value = App.spec[f.key] || "";
    } else if (f.multiline) {
      inp = multilineInput(App.spec[f.key] || "");
    } else {
      if (App.spec[f.key] == null && f.def != null) App.spec[f.key] = f.def;
      inp = inputEl("text", App.spec[f.key] || "");
    }
    inp.dataset.field = f.key;
    inp.addEventListener("input", () => { App.spec[f.key] = inp.value; edited(f.key); });
    if (wrap) { wrap.appendChild(inp); box.appendChild(wrap); }
    else box.appendChild(inp);
    if (f.kind === "percent") addQuickChips(box, inp, [10, 15, 20, 25, 30, 40, 50], "%");
    if (f.multiline && !f.help) box.appendChild(el("div", "f-help", "Press Enter to start a new line on the sign."));
    help(box, f);
  }
  buildToggleChips(t, fineBody);
  buildScaleSliders(t, fineBody);
  buildLayoutSection(t, host);
  buildExtrasSection(t, host);
  // Only offer the section when it has something in it (e.g. Text Only has
  // no toggles, sliders, or extras).
  if (fineBody.childNodes.length) host.appendChild(fine);
  markNewFields(host, baseline);
  paintAllFieldMessages();
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
  wrap.appendChild(labelEl("Show on sign"));
  wrap.appendChild(el("div", "f-help", "Click a part to hide it; click again to bring it back."));
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
  head.appendChild(labelEl("Element sizes"));
  const presets = el("button", "btn btn-ghost btn-sm", "Presets ▾");
  presets.title = "Save this layout, or apply a saved one";
  presets.onclick = (e) => { e.stopPropagation(); showPresetMenu(presets, t, host); };
  head.appendChild(presets);
  const reset = el("button", "btn btn-ghost btn-sm", "Reset");
  reset.id = "scaleResetBtn"; // distinct from the Presets button for lookups
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
  wrap.appendChild(el("div", "f-help", "Make a part bigger or smaller; the rest of the sign re-fits around it. You can also drag a part up or down on the preview."));
  for (const d of defs) {
    const row = el("div", "scale-row");
    const hidden = !!(App.spec.hide && App.spec.hide[d.key]);
    if (hidden) row.classList.add("off");
    row.appendChild(el("span", "scale-name", d.label));
    const slider = el("input", "scale-slider");
    slider.type = "range";
    slider.min = String(Math.round(SCALE_MIN * 100));
    slider.max = String(Math.round(SCALE_MAX * 100));
    slider.step = "5";
    slider.value = String(Math.round((sc[d.key] || 1) * 100));
    slider.dataset.scaleKey = d.key; // lets preview drags sync this row
    slider.disabled = hidden;
    slider.title = "Double-click to reset to 100%";
    const val = el("span", "scale-val", hidden ? "hidden" : slider.value + "%");
    val.classList.toggle("tuned", !hidden && slider.value !== "100"); // a changed size reads red
    slider.addEventListener("input", () => {
      sc[d.key] = parseInt(slider.value, 10) / 100;
      // remember which product these sizes were tuned for, so a new
      // SKU's lookup knows whether to keep or reset them
      App.spec._scaleSku = String(App.spec.sku || "");
      val.textContent = slider.value + "%";
      val.classList.toggle("tuned", slider.value !== "100");
      updateReset();
      schedulePreview();
    });
    slider.addEventListener("dblclick", () => {
      slider.value = "100";
      slider.dispatchEvent(new Event("input"));
    });
    const step = (dir) => {
      slider.value = String(Math.max(+slider.min, Math.min(+slider.max, +slider.value + dir * 5)));
      slider.dispatchEvent(new Event("input"));
    };
    const minus = el("button", "nudge-btn scale-step", "−");
    minus.type = "button";
    minus.title = `Make ${d.label.toLowerCase()} smaller`;
    minus.disabled = hidden;
    minus.onclick = () => step(-1);
    const plus = el("button", "nudge-btn scale-step", "+");
    plus.type = "button";
    plus.title = `Make ${d.label.toLowerCase()} bigger`;
    plus.disabled = hidden;
    plus.onclick = () => step(1);
    row.appendChild(minus);
    row.appendChild(slider);
    row.appendChild(plus);
    row.appendChild(val);
    wrap.appendChild(row);
  }
  updateReset();
  // the keep-on-new-SKU choice only means something on a sign with a SKU
  if (!t.fields.some((f) => f.kind === "sku")) return;
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

/* Layout presets: named Element-sizes arrangements ("big photo layout"),
   saved in Settings and applicable to any sign. The menu lists saved
   presets (click to apply, ✕ to delete) with a save row at the bottom. */
function showPresetMenu(anchor, t, host) {
  closeBatchPickMenu(); // shares the pick-menu chrome and singleton
  const menu = el("div", "pick-menu");
  menu.onclick = (e) => e.stopPropagation();
  menu.appendChild(el("div", "pick-head", "Layout presets"));
  const names = Object.keys(Settings.get().sizePresets || {}).sort();
  if (!names.length) menu.appendChild(el("div", "pick-empty", "No presets yet — set the sliders, then save the layout below."));
  for (const n of names) {
    const row = el("div", "pick-row");
    const b = el("button", "pick-item", n);
    b.onclick = () => {
      App.spec.scale = Object.assign({}, Settings.get().sizePresets[n]);
      App.spec._scaleSku = String(App.spec.sku || "");
      closeBatchPickMenu();
      buildScaleSliders(t, host);
      schedulePreview();
      showToast(`Applied layout “${n}”.`, { kind: "ok" });
    };
    const del = el("button", "q-btn", "✕");
    del.title = "Delete this preset";
    del.onclick = () => {
      const presets = Object.assign({}, Settings.get().sizePresets);
      delete presets[n];
      Settings.set({ sizePresets: presets });
      showPresetMenu(anchor, t, host);
    };
    row.appendChild(b);
    row.appendChild(del);
    menu.appendChild(row);
  }
  const saveRow = el("div", "pick-save");
  const inp = el("input", "f-input");
  inp.placeholder = "Save current as…";
  const save = el("button", "btn btn-primary btn-sm", "Save");
  save.onclick = () => {
    const n = inp.value.trim();
    if (!n) return;
    const presets = Object.assign({}, Settings.get().sizePresets);
    presets[n] = Object.assign({}, App.spec.scale || {});
    Settings.set({ sizePresets: presets });
    closeBatchPickMenu();
    showToast(`Layout “${n}” saved — apply it to any sign from Presets.`, { kind: "ok" });
  };
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") save.onclick(); });
  saveRow.appendChild(inp);
  saveRow.appendChild(save);
  menu.appendChild(saveRow);
  document.body.appendChild(menu);
  _pickMenuEl = menu;
  const r = anchor.getBoundingClientRect();
  menu.style.top = Math.max(8, Math.min(window.innerHeight - menu.offsetHeight - 8, r.bottom + 4)) + "px";
  menu.style.left = Math.max(8, r.right - menu.offsetWidth) + "px";
  setTimeout(() => document.addEventListener("click", closeBatchPickMenu, { once: true }), 0);
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
/* A text box that looks like a one-line input but takes Enter as a line
   break on the sign, growing as lines are added. */
function multilineInput(value) {
  const ta = el("textarea", "f-input f-autogrow");
  ta.rows = 1;
  ta.value = value;
  const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight + 3) + "px"; };
  ta.addEventListener("input", grow);
  setTimeout(grow, 0);
  return ta;
}
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

/* The SKU box sits in a small wrapper that draws the lookup's spinner,
   then its check mark, at the right edge (CSS, from data-lookup). */
function skuWrap(inp) {
  const w = el("div", "sku-wrap");
  w.appendChild(inp);
  return w;
}

/* "It filled in": after a SKU lookup, each box it changed lights up pale
   green one after another (name, then price, then reg. price…) so the eye
   follows the sign filling in. Cosmetic only — values are already set. */
function snapFields(root) {
  const m = {};
  if (!root) return m;
  for (const x of root.querySelectorAll("[data-field]")) m[x.dataset.field] = x.value;
  const img = root.querySelector(".img-drop img");
  m._img = img ? img.getAttribute("src") || "" : "";
  return m;
}
function flashFilled(root, before) {
  if (!root || !before || !previewMotionOK()) return;
  const hits = [];
  for (const x of root.querySelectorAll("[data-field]")) {
    const k = x.dataset.field;
    if (k === "sku" || !x.value || x.value === before[k]) continue;
    if (x.closest(".mp-card") !== root.closest(".mp-card") && !root.matches(".mp-card")) continue;
    hits.push(x);
  }
  const drop = root.querySelector(".img-drop");
  const img = drop && drop.querySelector("img");
  if (img && img.getAttribute("src") && img.getAttribute("src") !== before._img) hits.push(drop);
  flashEls(hits);
}
function flashEls(els, tone) {
  if (!previewMotionOK()) return;
  let i = 0;
  for (const x of els) {
    if (!x || !x.isConnected) continue;
    x.classList.remove("just-filled", "just-changed");
    x.style.setProperty("--fill-i", String(Math.min(i++, 5)));
    void x.offsetWidth; // restart if it was mid-flash
    x.classList.add(tone === "neutral" ? "just-changed" : "just-filled");
    const done = (e) => {
      if (e.target !== x) return; // a child's own animation bubbling up
      x.removeEventListener("animationend", done);
      x.classList.remove("just-filled", "just-changed");
    };
    x.addEventListener("animationend", done);
  }
}

/* Photo boxes: keyboard-reachable (Enter/Space picks a file) and light up
   while a photo is dragged over them. */
function wireDropZone(drop, file) {
  drop.tabIndex = 0;
  drop.setAttribute("role", "button");
  drop.setAttribute("aria-label", "Choose a photo");
  drop.addEventListener("keydown", (e) => {
    if (e.target !== drop || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    file.click();
  });
  const on = () => drop.classList.add("drag-over");
  const off = () => drop.classList.remove("drag-over");
  drop.addEventListener("dragenter", (e) => { e.preventDefault(); on(); });
  drop.addEventListener("dragover", on);
  drop.addEventListener("dragleave", (e) => { if (!drop.contains(e.relatedTarget)) off(); });
  drop.addEventListener("drop", off);
}

/* A photo thumbnail fades in once it has actually loaded (a repeat of
   the same photo doesn't replay). */
function showThumb(prev, src) {
  if (prev.getAttribute("src") === src) return;
  prev.classList.remove("img-in");
  if (previewMotionOK()) prev.classList.add("img-wait");
  prev.onload = () => {
    prev.classList.remove("img-wait");
    if (previewMotionOK()) { void prev.offsetWidth; prev.classList.add("img-in"); }
  };
  prev.onerror = () => prev.classList.remove("img-wait");
  prev.src = src;
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
    showThumb(prev, src);
    prev.style.display = "";
    clear.style.display = "";
    note.innerHTML = App.spec._customImage ? "Using your custom photo." : "Photo from acehardware.com.<br>Click to replace, or drag a new one here.";
  } else {
    prev.style.display = "none";
    clear.style.display = "none";
    note.innerHTML = "Auto-fetched on SKU lookup.<br>Click to use your own photo, or drag one here.";
  }
}
/* Same screen, different sign style (arrow direction, the lookup's switch
   to a Sale sign): the page stays put and keeps its place and focus; only
   the title, the preview and any new fields move. */
function switchTypeKeepingSpec(newType, opts) {
  const o = opts || {};
  const keep = App.spec;
  const refocus = captureEditorFocus();
  showEditor(newType, { keepPlace: true });
  App.spec = Object.assign(App.spec, keep);
  buildEditorFields(typeById(newType));
  restoreEditorFocus(refocus);
  if (o.fromLookup) App._lookupGlide = performance.now();
  schedulePreview();
  EditorHistory.reset();
}

/* ---------------- Multi Product editor ----------------
   spec.products = [{typeId, spec}] — each product is a complete standard
   sign edited in its own card: a style picker plus that style's own fields
   (SKU lookup included). Cards write straight into their product's spec
   and the preview re-renders the whole sheet. The field kinds mirror the
   single-sign form, but every DOM lookup is scoped to the card — four
   products mean four "price" inputs on one form. */
function newMultiProduct(typeId) {
  return { typeId: typeId || "regular", spec: { startDate: App.batchStart || "", endDate: App.batchEnd || "" } };
}

function buildProductsEditor(t, host) {
  if (!Array.isArray(App.spec.products)) App.spec.products = [];
  const products = App.spec.products;
  while (products.length < MULTI_MIN_PRODUCTS) products.push(newMultiProduct("regular"));
  if (products.length > MULTI_MAX_PRODUCTS) products.length = MULTI_MAX_PRODUCTS;
  // Paste a list of SKUs to fill the sign in one go (empty slots first,
  // then new products up to the cap) — the multi answer to Bulk add.
  const paste = el("details", "mp-paste");
  paste.id = "mpPaste";
  paste.open = _mpPasteOpen;
  paste.addEventListener("toggle", () => { _mpPasteOpen = paste.open; });
  paste.appendChild(el("summary", null, "Paste SKUs to fill the sign"));
  const pb = el("div", "mp-paste-body");
  const ta = el("textarea", "f-textarea");
  ta.id = "mpPasteSkus";
  ta.rows = 4;
  ta.placeholder = `One SKU per line — up to ${MULTI_MAX_PRODUCTS}\n7135975\n2837301`;
  const pbtn = el("button", "btn btn-primary btn-sm", "Fill products from these SKUs");
  pbtn.id = "mpPasteBtn";
  const pstat = el("div", "lookup-status");
  pstat.id = "mpPasteStatus";
  pbtn.onclick = () => fillProductsFromSkus(t, ta.value, pstat, pbtn);
  pb.appendChild(ta);
  pb.appendChild(pbtn);
  pb.appendChild(pstat);
  paste.appendChild(pb);
  host.appendChild(paste);
  const wrap = el("div", "mp-list");
  wrap.id = "multiProducts";
  products.forEach((p, i) => wrap.appendChild(buildProductCard(t, p, i)));
  host.appendChild(wrap);
  if (products.length < MULTI_MAX_PRODUCTS) {
    const add = el("button", "btn btn-ghost mp-add", `＋ Add a product (${products.length} of ${MULTI_MAX_PRODUCTS})`);
    add.id = "mpAddBtn";
    add.onclick = () => {
      products.push(newMultiProduct("regular"));
      buildEditorFields(t);
      schedulePreview();
    };
    host.appendChild(add);
  }
  host.appendChild(el("div", "mp-help", "2 or 3 products stand side by side; 4 to 8 fill two rows under one Ace logo. Each product is its own sign — style, price, photo and all. Drag a product onto another in the preview to swap them, or use ▲▼."));
}

/* Fold state per product object (not saved with the sign): a filled-in
   product starts folded to one summary line so a 6-product sign stays
   scannable; an empty one starts open. Click the card's head to toggle. */
const _mpFold = new WeakMap();
function productFilled(p) {
  return !!String(p.spec.name || "").trim();
}
function productSummary(p) {
  const st = typeById(p.typeId);
  const bits = [st ? st.label : p.typeId];
  bits.push(String(p.spec.name || "").trim() || (p.spec.sku ? "SKU " + p.spec.sku : "Not filled in yet"));
  if (String(p.spec.price || "").trim()) bits.push(fmtMoney(p.spec.price));
  else if (String(p.spec.percent || "").trim()) bits.push(p.spec.percent + "% off");
  return bits.join(" · ");
}
function setCardFolded(card, p, folded) {
  _mpFold.set(p, folded);
  card.classList.toggle("folded", folded);
  const sum = card.querySelector(".mp-summary");
  if (sum) sum.textContent = productSummary(p);
  const tg = card.querySelector(".mp-fold");
  if (tg) { tg.textContent = folded ? "Edit ▾" : "Done ▴"; tg.title = folded ? "Show this product's fields" : "Fold this product to one line"; }
}

function buildProductCard(t, p, i) {
  const products = App.spec.products;
  if (!typeById(p.typeId) || p.typeId === "multi") p.typeId = "regular";
  if (!p.spec || typeof p.spec !== "object") p.spec = {};
  const st = typeById(p.typeId);
  const card = el("div", "mp-card");
  card.dataset.product = String(i);
  const head = el("div", "mp-head");
  head.appendChild(el("span", "mp-title", `Product ${i + 1}`));
  const summary = el("div", "mp-summary", "");
  summary.onclick = () => setCardFolded(card, p, false);
  const sel = el("select", "f-select mp-type");
  sel.title = "Sign style for this product";
  const groups = {};
  for (const ct of multiChildTypes()) (groups[ct.group] = groups[ct.group] || []).push(ct);
  for (const g of Object.keys(groups)) {
    const og = el("optgroup");
    og.label = g;
    for (const ct of groups[g]) {
      const o = el("option", null, ct.label);
      o.value = ct.id;
      if (ct.id === p.typeId) o.selected = true;
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
  sel.onchange = () => { p.typeId = sel.value; rebuildProductCard(t, p, i); schedulePreview(); };
  head.appendChild(sel);
  const up = el("button", "q-btn mp-move mp-up", "▲");
  up.title = "Move this product earlier";
  up.disabled = i === 0;
  up.onclick = () => moveProduct(t, i, i - 1);
  const down = el("button", "q-btn mp-move mp-down", "▼");
  down.title = "Move this product later";
  down.disabled = i === products.length - 1;
  down.onclick = () => moveProduct(t, i, i + 1);
  head.appendChild(up);
  head.appendChild(down);
  if (products.length > MULTI_MIN_PRODUCTS) {
    const rm = el("button", "q-btn mp-remove", "✕");
    rm.title = "Remove this product";
    rm.onclick = () => { products.splice(i, 1); buildEditorFields(t); schedulePreview(); };
    head.appendChild(rm);
  }
  const fold = el("button", "btn btn-ghost btn-sm mp-fold", "");
  fold.onclick = () => { markUnfolding(card); setCardFolded(card, p, !card.classList.contains("folded")); };
  summary.onclick = () => { markUnfolding(card); setCardFolded(card, p, false); };
  head.appendChild(fold);
  card.appendChild(head);
  card.appendChild(summary);
  const body = el("div", "mp-body");
  // the single form's fine-tune extras (unit, barcode, QR) fold into a
  // small per-card disclosure so four cards stay scannable
  const extras = el("details", "mp-extras");
  extras.appendChild(el("summary", null, "Extras — unit, barcode, QR"));
  const extrasBody = el("div", "mp-extras-body");
  extras.appendChild(extrasBody);
  const FINE_KEYS = { unit: 1, barcode: 1, qr: 1 };
  for (const f of st.fields) {
    if (f.modes && !f.modes.includes(p.spec.mode)) continue;
    buildProductField(t, p, i, st, f, FINE_KEYS[f.key] ? extrasBody : body, card);
  }
  card.appendChild(body);
  if (extrasBody.childNodes.length) card.appendChild(extras);
  setCardFolded(card, p, _mpFold.has(p) ? _mpFold.get(p) : productFilled(p));
  return card;
}

/* Folding or unfolding a product card by a click eases its fields (or its
   one-line summary) in; a rebuild that arrives already open or already
   folded never animates, since it carries no .unfolding class. */
function markUnfolding(card) {
  if (!previewMotionOK()) return;
  card.classList.add("unfolding");
  setTimeout(() => card.classList.remove("unfolding"), 260);
}

/* ▲▼ and drag-to-swap: the cards glide to their new places instead of
   jumping, and the moved one gets a brief ring. Keyed on the product
   objects, which keep their identity through the reorder. */
function rebuildProductsFlip(t, mutate, focusSel) {
  const products = App.spec.products;
  const old = new Map();
  if (previewMotionOK()) {
    for (const c of $$("#multiProducts .mp-card")) {
      const p = products[+c.dataset.product];
      if (p) old.set(p, c.getBoundingClientRect().top);
    }
  }
  mutate();
  buildEditorFields(t);
  for (const c of $$("#multiProducts .mp-card")) {
    const top0 = old.get(products[+c.dataset.product]);
    if (top0 == null) continue;
    const dy = top0 - c.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) continue;
    c.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 220, easing: "cubic-bezier(.22,.8,.24,1)" });
    c.classList.add("just-moved");
    c.addEventListener("animationend", (e) => { if (e.target === c) c.classList.remove("just-moved"); });
  }
  // keyboard users can press the same arrow again
  if (focusSel) { const f = $(focusSel); if (f && !f.disabled) f.focus({ preventScroll: true }); }
}

function rebuildProductCard(t, p, i) {
  const old = $(`#multiProducts .mp-card[data-product="${i}"]`);
  const fresh = buildProductCard(t, p, i);
  if (old) old.replaceWith(fresh);
  return fresh;
}

/* Apply a lookup result to a product — the one set of rules behind a
   card's SKU field and the paste-to-fill box. Returns whether the product
   switched Regular → Sale (an on-sale item gets the markdown shown, the
   same courtesy a single sign gets). */
function applyLookupToProduct(p, res, si) {
  const spec = p.spec;
  const st = typeById(p.typeId);
  if (res.sku) spec.sku = res.sku;
  if (res.productUrl) spec.productUrl = res.productUrl; // QR target
  spec.lookedUpAt = res.fetchedAt || new Date().toISOString();
  if (res.name) spec.name = res.name;
  let switched = false;
  if (si.onSale) {
    spec.price = si.sale;
    spec.regPrice = si.reg;
    if (p.typeId === "regular") { p.typeId = "sale"; switched = true; }
  } else {
    if (res.price) spec.price = res.price;
    else if (res.listPrice) spec.price = res.listPrice;
    // a fresh non-sale lookup means any earlier reg price is stale
    if (st && st.fields.some((x) => x.key === "regPrice") && p.typeId !== "was_now") spec.regPrice = "";
  }
  if (res.imageUrl) spec.image = res.imageUrl;
  return switched;
}

function moveProduct(t, from, to) {
  const products = App.spec.products;
  if (to < 0 || to >= products.length || from === to) return;
  const ae = document.activeElement;
  const wasFocused = ae && ae.classList && ae.classList.contains("mp-move");
  const dir = to < from ? ".mp-up" : ".mp-down";
  rebuildProductsFlip(t, () => {
    const [p] = products.splice(from, 1);
    products.splice(to, 0, p);
  }, wasFocused ? `#multiProducts .mp-card[data-product="${to}"] ${dir}` : null);
  schedulePreview();
}

function swapProducts(t, i, j) {
  const products = App.spec.products;
  if (i === j || !products[i] || !products[j]) return;
  rebuildProductsFlip(t, () => { [products[i], products[j]] = [products[j], products[i]]; });
  schedulePreview();
  showToast(`Swapped products ${i + 1} and ${j + 1}.`, { kind: "ok" });
}

/* Paste-to-fill: SKUs from the box (one per line; the same detection as
   Bulk add) go into empty slots first, then new products up to the cap.
   Each is looked up with the card rules; misses stay in the box to fix by
   hand, and anything past the cap is reported rather than dropped
   silently. */
let _mpPasteOpen = false;
async function fillProductsFromSkus(t, text, status, btn) {
  const skus = [...new Set(parseBulkSkus(text))];
  if (!skus.length) {
    status.className = "lookup-status err";
    status.textContent = "✗ No SKUs found — paste one per line.";
    return;
  }
  const products = App.spec.products;
  const isEmpty = (p) => !String(p.spec.sku || "").trim() && !String(p.spec.name || "").trim();
  const slots = [];
  for (let i = 0; i < products.length && slots.length < skus.length; i++) if (isEmpty(products[i])) slots.push(i);
  while (slots.length < skus.length && products.length < MULTI_MAX_PRODUCTS) {
    products.push(newMultiProduct("regular"));
    slots.push(products.length - 1);
  }
  const extra = skus.length - slots.length;
  const work = skus.slice(0, slots.length).map((sku, k) => ({ sku, p: products[slots[k]] }));
  btn.disabled = true;
  status.className = "lookup-status busy";
  status.innerHTML = `<span class="spin"></span> Looking up ${work.length} SKU${work.length === 1 ? "" : "s"}…`;
  lookupBusy(1);
  const failed = [];
  let done = 0;
  const queue = work.slice();
  const runOne = async () => {
    const w = queue.shift();
    if (!w) return;
    w.p.spec.sku = w.sku;
    try {
      const res = await fetch(`/api/lookup?q=${encodeURIComponent(w.sku)}&store=${encodeURIComponent(Settings.get().storeCode || "12180")}`).then((r) => r.json());
      if (res.ok) applyLookupToProduct(w.p, res, saleInfo(res));
      else failed.push(w.sku);
    } catch (e) { failed.push(w.sku); }
    status.innerHTML = `<span class="spin"></span> Looking up ${++done}/${work.length}…`;
    await runOne();
  };
  try { await Promise.all(Array.from({ length: Math.min(3, work.length) }, runOne)); }
  finally { lookupBusy(-1); }
  _mpPasteOpen = failed.length > 0 || extra > 0; // keep the box open when there's something to read
  buildEditorFields(t);
  App._lookupGlide = performance.now();
  schedulePreview();
  // each filled card glows green, one after another
  if (previewMotionOK()) {
    work.forEach((w, k) => {
      if (failed.includes(w.sku)) return;
      const c = $(`#multiProducts .mp-card[data-product="${slots[k]}"]`);
      if (c) setTimeout(() => flashCard(c), Math.min(k, 7) * 60);
    });
  }
  const st = $("#mpPasteStatus");
  const filled = work.length - failed.length;
  if (st) {
    const bits = [`✓ Filled ${filled} product${filled === 1 ? "" : "s"}`];
    if (failed.length) bits.push(`${failed.length} not found: ${failed.join(", ")} — fill by hand`);
    if (extra > 0) bits.push(`${extra} left off — the sign holds ${MULTI_MAX_PRODUCTS}`);
    st.className = "lookup-status " + (failed.length ? "err" : "ok");
    st.textContent = bits.join(" · ");
    const ta = $("#mpPasteSkus");
    if (ta) ta.value = failed.join("\n");
  }
  showToast(`Filled ${filled} product${filled === 1 ? "" : "s"} from SKUs${failed.length ? ` — ${failed.length} not found` : ""}.`, { kind: failed.length ? "warn" : "ok" });
}

/* A product card that a lookup just filled glows green for a moment. */
function flashCard(c) {
  if (!c || !c.isConnected || !previewMotionOK()) return;
  c.classList.remove("mp-filled");
  void c.offsetWidth;
  c.classList.add("mp-filled");
  setTimeout(() => c.classList.remove("mp-filled"), 420);
}

function refreshProductImage(host, spec) {
  const drop = host.classList && host.classList.contains("img-drop") ? host : host.querySelector(".img-drop");
  if (!drop) return;
  const prev = drop.querySelector("img"), note = drop.querySelector(".img-note"), clear = drop.querySelector(".img-clear");
  if (spec.image) {
    showThumb(prev, /^https?:\/\//.test(spec.image) ? `/api/img?u=${encodeURIComponent(spec.image)}` : spec.image);
    prev.style.display = "";
    clear.style.display = "";
    note.innerHTML = spec._customImage ? "Using your custom photo." : "Photo from acehardware.com.<br>Click to replace, or drag a new one here.";
  } else {
    prev.style.display = "none";
    clear.style.display = "none";
    note.innerHTML = "Auto-fetched on SKU lookup.<br>Click to use your own photo, or drag one here.";
  }
}

function buildProductField(t, p, i, st, f, destOuter, card) {
  const spec = p.spec;
  // same per-field wrapper as the single form, so messages paint per card
  const dest = el("div", "f-field");
  dest.dataset.key = f.key;
  destOuter.appendChild(dest);
  const help = () => { if (f.help) dest.appendChild(el("div", "f-help", f.help)); };
  if (f.kind === "seg") {
    if (spec[f.key] == null) spec[f.key] = f.def;
    dest.appendChild(labelEl(f.label));
    const row = el("div", "seg");
    for (const opt of f.options) {
      const b = el("button", "seg-btn" + (spec[f.key] === opt.value ? " active" : ""), opt.label);
      b.onclick = () => {
        if (spec[f.key] === opt.value) return;
        spec[f.key] = opt.value;
        rebuildProductCard(t, p, i);
        schedulePreview();
      };
      row.appendChild(b);
    }
    dest.appendChild(row);
    return;
  }
  if (f.kind === "sku") {
    dest.appendChild(labelEl(f.label));
    const inp = inputEl("text", spec.sku || "", "e.g. 7135975 — or paste a product URL");
    inp.dataset.field = "sku";
    const status = el("div", "lookup-status");
    inp.addEventListener("input", () => { spec.sku = inp.value.trim(); });
    attachAutoLookup(inp, status, (res, si) => {
      const before = snapFields(card);
      const switched = applyLookupToProduct(p, res, si);
      // reflect what the lookup filled in without rebuilding the card
      for (const k of ["name", "price", "regPrice"]) {
        const x = card.querySelector(`[data-field="${k}"]`);
        if (x) x.value = spec[k] != null ? spec[k] : "";
      }
      refreshProductImage(card, spec);
      for (const k of applyDerived(typeById(p.typeId) || st, spec, "*")) {
        const x = card.querySelector(`[data-field="${k}"]`);
        if (x) x.value = spec[k];
      }
      let fresh = null;
      if (switched) {
        fresh = rebuildProductCard(t, p, i);
        const s2 = fresh.querySelector(".lookup-status");
        if (s2) {
          s2.className = "lookup-status ok";
          s2.innerHTML = `<span class="lk-ico">✓</span> ${esc(res.name || res.sku)} <span class="sale-flag">On Sale</span> — switched to a Sale style <button type="button" class="diag-link" onclick="showDiagnostics()">details</button>`;
        }
        const s3 = fresh.querySelector('[data-field="sku"]');
        if (s3) s3.dataset.lookup = "ok";
      }
      App._lookupGlide = performance.now();
      schedulePreview();
      const c = fresh || card;
      flashFilled(c, before);
      flashCard(c);
    });
    dest.appendChild(skuWrap(inp));
    dest.appendChild(status);
    return;
  }
  if (f.kind === "image") {
    dest.appendChild(labelEl(f.label));
    const drop = el("div", "img-drop mp-img");
    drop.innerHTML = `<img style="display:none"><div class="img-note"></div><button class="img-clear" title="Remove photo" style="display:none">✕</button>`;
    const file = el("input");
    file.type = "file";
    file.accept = "image/*";
    file.style.display = "none";
    drop.appendChild(file);
    drop.onclick = (e) => { if (!e.target.classList.contains("img-clear")) file.click(); };
    const accept = (fl) => {
      const r = new FileReader();
      r.onload = async () => {
        spec.image = await downscaleDataURL(r.result, CUSTOM_PHOTO_MAX_EDGE, 0.85);
        spec._customImage = true;
        refreshProductImage(drop, spec);
        schedulePreview();
      };
      r.readAsDataURL(fl);
    };
    file.onchange = () => {
      const fl = file.files && file.files[0];
      if (fl) accept(fl);
      file.value = "";
    };
    drop.addEventListener("dragover", (e) => { e.preventDefault(); });
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      const fl = e.dataTransfer.files && e.dataTransfer.files[0];
      if (fl && /^image\//.test(fl.type)) accept(fl);
    });
    wireDropZone(drop, file);
    drop.querySelector(".img-clear").onclick = () => { spec.image = null; spec._customImage = false; refreshProductImage(drop, spec); schedulePreview(); };
    dest.appendChild(drop);
    refreshProductImage(drop, spec);
    return;
  }
  if (f.kind === "dates") {
    dest.appendChild(labelEl(f.label));
    const row = el("div", "f-row");
    const s = inputEl("date", spec.startDate || "");
    const e2 = inputEl("date", spec.endDate || "");
    const clr = el("button", "btn btn-ghost btn-sm", "Clear");
    s.onchange = () => {
      spec.startDate = s.value;
      if (s.value && (!e2.value || e2.value < s.value)) { e2.value = plusDaysISO(s.value, 7); spec.endDate = e2.value; }
      schedulePreview();
    };
    e2.onchange = () => { spec.endDate = e2.value; schedulePreview(); };
    clr.onclick = () => { s.value = ""; e2.value = ""; spec.startDate = ""; spec.endDate = ""; schedulePreview(); };
    row.appendChild(s); row.appendChild(e2); row.appendChild(clr);
    dest.appendChild(row);
    addDatePicks(dest, s, e2);
    help();
    return;
  }
  if (f.kind === "check") {
    const lab = el("label", "f-check");
    const cb = el("input");
    cb.type = "checkbox";
    if (spec[f.key] == null && f.def != null) spec[f.key] = f.def;
    cb.checked = !!spec[f.key];
    cb.onchange = () => { spec[f.key] = cb.checked; schedulePreview(); };
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(f.label));
    dest.appendChild(lab);
    return;
  }
  dest.appendChild(labelEl(f.label));
  let wrap = null, inp;
  if (f.kind === "money") {
    wrap = el("div", "prefix-wrap");
    wrap.dataset.prefix = "$";
    inp = inputEl("text", spec[f.key] != null ? spec[f.key] : (f.def != null ? f.def : ""));
  } else if (f.kind === "percent") {
    wrap = el("div", "suffix-wrap");
    wrap.dataset.suffix = "%";
    inp = inputEl("text", spec[f.key] || "");
  } else if (f.kind === "int") {
    inp = inputEl("number", spec[f.key] != null ? spec[f.key] : f.def || 2);
    inp.min = "2"; inp.max = "9";
  } else if (f.kind === "textarea") {
    inp = el("textarea", "f-textarea");
    inp.value = spec[f.key] || "";
  } else if (f.multiline) {
    inp = multilineInput(spec[f.key] || "");
  } else {
    if (spec[f.key] == null && f.def != null) spec[f.key] = f.def;
    inp = inputEl("text", spec[f.key] || "");
  }
  inp.dataset.field = f.key;
  inp.addEventListener("input", () => {
    spec[f.key] = inp.value;
    for (const k of applyDerived(st, spec, f.key)) {
      const x = card.querySelector(`[data-field="${k}"]`);
      if (x && x !== document.activeElement) x.value = spec[k];
    }
    schedulePreview();
  });
  if (wrap) { wrap.appendChild(inp); dest.appendChild(wrap); }
  else dest.appendChild(inp);
  if (f.kind === "percent") addQuickChips(dest, inp, [10, 15, 20, 25, 30, 40, 50], "%");
  help();
}

function showMsg(id, cls, text) {
  const m = $("#" + id);
  if (!m) return;
  m.className = "msg";
  void m.offsetWidth; // replay the rise-in, so a second "Added…" is noticed too
  m.className = `msg show ${cls}`;
  m.textContent = text;
  if (cls === "busy") m.insertBefore(el("span", "spin"), m.firstChild);
}

/* "It worked" on a button: one ring spreads out from it. */
function pulseDone(btn, cls) {
  const c = cls || "did-ok";
  if (!btn || !previewMotionOK()) return;
  btn.classList.remove(c);
  void btn.offsetWidth;
  btn.classList.add(c);
  setTimeout(() => btn.classList.remove(c), 320);
}

/* Add to Queue: a small copy of the sign glides into the queue count,
   which bumps as it lands. Decoration only — the sign is already queued,
   and the copy never takes clicks. */
let _bumpAt = 0; // while a sign is flying in, the badge bumps when it lands
function flyToQueue() {
  if (!previewMotionOK()) return; // WAAPI ignores the CSS reduce-motion rule
  const src = $("#signHolder svg"), dst = $("#queueCount");
  if (!src || !dst) return;
  const a = src.getBoundingClientRect(), b = dst.getBoundingClientRect();
  if (!a.width || !b.width || a.bottom < 0 || a.top > innerHeight) return;
  const c = src.cloneNode(true);
  c.removeAttribute("id");
  for (const n of c.querySelectorAll("*")) {
    n.removeAttribute("id");
    for (const at of [...n.attributes]) if (at.name.startsWith("data-")) n.removeAttribute(at.name);
  }
  const ghost = el("div", "fly-ghost");
  ghost.setAttribute("aria-hidden", "true");
  ghost.appendChild(c);
  Object.assign(ghost.style, { left: a.left + "px", top: a.top + "px", width: a.width + "px", height: a.height + "px" });
  document.body.appendChild(ghost);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const s = Math.max(0.04, 26 / Math.max(a.width, a.height));
  _bumpAt = performance.now() + 300;
  const land = () => {
    if (!ghost.isConnected) return;
    ghost.remove();
    const q = $("#queueCount");
    if (q) { q.classList.remove("bump"); void q.offsetWidth; q.classList.add("bump"); }
  };
  const anim = ghost.animate([
    { transform: "none", opacity: 0.95 },
    { transform: `translate(${dx}px,${dy}px) scale(${s})`, opacity: 0.3 },
  ], { duration: 300, easing: "cubic-bezier(.22,.8,.24,1)" });
  anim.onfinish = land;
  anim.oncancel = () => ghost.remove();
  setTimeout(land, 450); // safety net: never leave a copy behind
}

/* live preview
   A render costs a millisecond or two, so the preview redraws on the very
   next animation frame instead of after a fixed delay: sliders, drags and
   typing all follow the hand. Many calls inside one frame collapse into a
   single render; one already in flight is followed by exactly one more. */
let _previewFrame = 0;
let _previewBusy = false;
let _previewAgain = false;
function schedulePreview() {
  if (_previewFrame) return;
  _previewFrame = requestAnimationFrame(() => { _previewFrame = 0; runPreview(); });
}
async function runPreview() {
  if (_previewBusy) { _previewAgain = true; return; }
  if (App.view !== "editor") return;
  const t = typeById(App.typeId);
  if (!t) return;
  _previewBusy = true;
  try {
    paintAllFieldMessages();
    recordEditorHistory();
    const seq = ++App._previewSeq;
    await ensureFontsLoaded();
    const size = sizeById(App.sizeId);
    const svg = await renderSignSVG(App.typeId, currentRenderSpec(), App.sizeId);
    if (seq === App._previewSeq) setPreviewSVG(svg, size);
  } catch (e) {
    console.error(e);
  } finally {
    _previewBusy = false;
    if (_previewAgain) { _previewAgain = false; schedulePreview(); }
  }
}

/* ---------------- smooth preview motion ----------------
   Each redraw replaces the whole SVG, which on its own makes a resized
   part jump straight to its new size. To make it glide, the parts of the
   old drawing are measured just before the swap, and each matching part
   of the new drawing starts out transformed back onto its old spot, then
   eases to where it belongs (the "FLIP" technique: First, Last, Invert,
   Play). Measuring the on-screen box catches a part mid-glide, so a fast
   drag keeps flowing instead of restarting. It only touches the preview
   on screen — print, PDF and thumbnails are rendered separately. */
const PREVIEW_GLIDE_MS = 190;
let _glides = [];
function previewMotionOK() {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function previewPartKey(g) {
  const cell = g.parentElement && g.parentElement.closest("g[data-product]");
  const pre = cell ? "p" + cell.dataset.product + ":" : "";
  if (g.hasAttribute("data-extra")) return pre + "x" + g.dataset.extra;
  if (g.hasAttribute("data-elem")) return pre + "e" + g.dataset.elem;
  return "o";
}
function previewParts(svg) {
  const all = [...svg.querySelectorAll("g[data-elem], g[data-extra]")];
  const set = new Set(all);
  // outermost parts only: a part inside a moving part rides along with it
  return all.filter((g) => {
    for (let a = g.parentElement; a && a !== svg; a = a.parentElement) {
      if (set.has(a)) return false;
    }
    return true;
  });
}
function measureParts(svg) {
  const out = new Map();
  if (!svg) return out;
  for (const g of previewParts(svg)) {
    const r = g.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) out.set(previewPartKey(g), r);
  }
  return out;
}
function stopGlides() {
  for (const gl of _glides) cancelAnimationFrame(gl.raf);
  _glides = [];
}
function glideParts(svg, before) {
  stopGlides();
  const ease = (p) => 1 - Math.pow(1 - p, 3);
  for (const g of previewParts(svg)) {
    const key = previewPartKey(g);
    const was = before.get(key);
    const now = g.getBoundingClientRect();
    if (!now.width || !now.height) continue;
    // a brand-new part (just switched on, or a photo a lookup brought)
    // fades in instead; the photo also grows in slightly
    if (!was) {
      if (before.size) {
        const photo = /^(p\d+:)?eimage$/.test(key);
        if (photo) { g.style.transformBox = "fill-box"; g.style.transformOrigin = "50% 50%"; }
        g.animate(photo ? [{ opacity: 0, transform: "scale(.94)" }, { opacity: 1, transform: "none" }] : [{ opacity: 0 }, { opacity: 1 }],
          { duration: photo ? 260 : PREVIEW_GLIDE_MS, easing: "cubic-bezier(.22,.8,.24,1)" });
      }
      continue;
    }
    if (Math.abs(was.left - now.left) < 0.5 && Math.abs(was.top - now.top) < 0.5 &&
        Math.abs(was.width - now.width) < 0.5 && Math.abs(was.height - now.height) < 0.5) continue;
    const ctm = g.parentNode.getScreenCTM && g.parentNode.getScreenCTM();
    if (!ctm || !ctm.a || !ctm.d) continue;
    // screen px -> the part's own drawing units
    const ux = (x) => (x - ctm.e) / ctm.a, uy = (y) => (y - ctm.f) / ctm.d;
    const nx = ux(now.left), ny = uy(now.top);
    const ox = ux(was.left), oy = uy(was.top);
    const kx = was.width / now.width, ky = was.height / now.height;
    // wrap the part so its own transform (if any) stays untouched
    const wrap = document.createElementNS("http://www.w3.org/2000/svg", "g");
    wrap.setAttribute("class", "glide");
    g.parentNode.insertBefore(wrap, g);
    wrap.appendChild(g);
    const set = (q) => {
      const tx = nx + (ox - nx) * q, ty = ny + (oy - ny) * q;
      const sx = 1 + (kx - 1) * q, sy = 1 + (ky - 1) * q;
      wrap.setAttribute("transform", `translate(${tx} ${ty}) scale(${sx} ${sy}) translate(${-nx} ${-ny})`);
    };
    set(1);
    const gl = { raf: 0 };
    const t0 = performance.now();
    const step = (ts) => {
      const p = Math.min(1, (ts - t0) / PREVIEW_GLIDE_MS);
      if (p >= 1) { wrap.removeAttribute("transform"); return; }
      set(1 - ease(p));
      gl.raf = requestAnimationFrame(step);
    };
    gl.raf = requestAnimationFrame(step);
    _glides.push(gl);
  }
}

function setPreviewSVG(svg, size) {
  const holder = $("#signHolder");
  if (!holder) return;
  const stage = holder.parentElement;
  const availW = stage.clientWidth - 44;
  // The preview card sticks to the top of the work area while the form
  // scrolls, so it may use the window's full height minus the card's own
  // header, notes and buttons (measured, not guessed).
  const card = stage.closest(".preview-card");
  const chrome = card ? card.offsetHeight - stage.offsetHeight : 240;
  const stacked = window.matchMedia("(max-width: 1250px)").matches;
  const availH = Math.max(260, (stacked ? window.innerHeight * 0.55 : window.innerHeight - 56 - 36) - chrome - 28);
  const scale = Math.min(availW / (size.w * PPI), availH / (size.h * PPI), 1.6);
  const markup = svg.replace(/^<svg /, `<svg style="width:${size.w * PPI * scale}px;height:${size.h * PPI * scale}px" `);
  // one-shot flags: a fresh start / queued sign cross-fades; a SKU lookup
  // that just landed glides even though the SKU box still has focus. Read
  // and cleared before the "nothing changed" check, so a flag whose redraw
  // turned out identical never leaks onto a later, unrelated redraw.
  const fade = !!App._crossfadeNext;
  App._crossfadeNext = false;
  const lookupFill = !!App._lookupGlide && performance.now() - App._lookupGlide < 4000;
  App._lookupGlide = 0;
  if (markup === holder._markup && holder.firstElementChild) return; // nothing changed
  // Glide parts to their new size when the same sign is redrawn at the
  // same size — but not while typing (text reflows on every key) or while
  // a picture/text box is being dragged (it already follows the pointer).
  const oldSvg = holder.querySelector("svg");
  const oldRect = oldSvg ? oldSvg.getBoundingClientRect() : null;
  const sameSign = oldSvg && holder._signKey === App.typeId + "|" + App.sizeId &&
    Math.abs(oldRect.width - size.w * PPI * scale) < 1;
  const act = document.activeElement;
  const typing = act && (act.tagName === "TEXTAREA" || (act.tagName === "INPUT" && !/^(range|checkbox|radio|button|color|file)$/.test(act.type)));
  const glide = sameSign && !fade && (!typing || lookupFill) && !App._extraDragging && previewMotionOK();
  const before = glide ? measureParts(oldSvg) : null;
  stopGlides();
  holder.innerHTML = markup;
  holder._markup = markup;
  const newSign = holder._signKey !== App.typeId + "|" + App.sizeId;
  holder._signKey = App.typeId + "|" + App.sizeId;
  if (before && before.size) glideParts(holder.querySelector("svg"), before);
  else if ((newSign || fade) && oldSvg && oldRect.width && previewMotionOK()) crossfadePreview(holder, oldSvg, oldRect);
  else if (!oldSvg) flyThumbIntoPreview(holder);
  if (lookupFill && oldSvg && previewMotionOK()) {
    // the sign just filled itself in: one soft ring spreads from it
    holder.classList.remove("lk-landed");
    void holder.offsetWidth;
    holder.classList.add("lk-landed");
    setTimeout(() => holder.classList.remove("lk-landed"), 340);
  }
  attachPreviewDrag(holder);
  const meta = $("#previewMeta");
  if (meta) {
    let txt = `${size.label.replace(/"/g, "″")} — prints at exact size · shown at ${(scale * 100).toFixed(0)}%`;
    if (size.cut) txt += ` · cut on the dashed line, laminate, and it fits the ${size.w}×${size.h}″ holder`;
    if (!_elemDrag) {
      txt += App.typeId === "multi"
        ? " · click any text to edit it · drag a product onto another to swap them"
        : " · click any text to edit it · drag any element to resize it";
    }
    meta.textContent = txt;
  }
}

/* Different sign, size or a fresh start: the old drawing stays where it
   was and fades out over the new one, so the preview never blanks or
   jumps in height. Preview only: never printed. */
function crossfadePreview(holder, oldSvg, oldRect) {
  const stage = holder.parentElement;
  stage.querySelectorAll(".preview-ghost").forEach((g) => g.remove());
  const sr = stage.getBoundingClientRect();
  const layer = el("div", "preview-ghost");
  layer.setAttribute("aria-hidden", "true");
  const sheet = el("div", "preview-ghost-sign");
  sheet.style.left = (oldRect.left - sr.left + stage.scrollLeft) + "px";
  sheet.style.top = (oldRect.top - sr.top + stage.scrollTop) + "px";
  sheet.appendChild(oldSvg);
  layer.appendChild(sheet);
  stage.appendChild(layer); // after #signHolder: its clip-path ids never shadow the new sign's
  // The old sign leaves first (quick, easing in, shrinking a touch) and the
  // new one comes in just behind it, so two readable layouts barely
  // overlap: the eye reads "old out, new in", not one double exposure.
  const out = sheet.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.985)" }], { duration: 100, easing: "ease-in", fill: "forwards" });
  out.onfinish = out.oncancel = () => layer.remove();
  setTimeout(() => layer.remove(), 400);
  holder.animate([{ opacity: 0 }, { opacity: 0, offset: 0.3, easing: "cubic-bezier(.22,.8,.24,1)" }, { opacity: 1 }], { duration: 200 });
}

/* Gallery -> editor: the picked card's sample flies onto the preview spot
   and hands over to the real sign. An overlay only (no pointer events). */
function flyThumbIntoPreview(holder) {
  const f = App._flyer;
  App._flyer = null;
  if (!f || performance.now() - f.at > 800 || !previewMotionOK()) return;
  const to = holder.getBoundingClientRect();
  if (!to.width || !to.height) return;
  const fly = el("div", "thumb-flyer");
  fly.setAttribute("aria-hidden", "true");
  fly.innerHTML = f.html;
  Object.assign(fly.style, { left: f.from.left + "px", top: f.from.top + "px", width: f.from.width + "px", height: f.from.height + "px" });
  document.body.appendChild(fly);
  // The sample shows the template product, which the new sign does not
  // have: its drawing fades out early in the flight, so what lands on the
  // preview is a plain sheet that dissolves into the real (empty) sign.
  const ink = fly.firstElementChild;
  if (ink) ink.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 70, easing: "cubic-bezier(.22,.8,.24,1)", fill: "forwards" });
  const s = Math.min(to.width / f.from.width, to.height / f.from.height);
  const dx = to.left + (to.width - f.from.width * s) / 2 - f.from.left;
  const dy = to.top + (to.height - f.from.height * s) / 2 - f.from.top;
  const a = fly.animate([
    { transform: "none", opacity: 1 },
    { opacity: 1, offset: 0.55 },
    { transform: `translate(${dx}px,${dy}px) scale(${s})`, opacity: 0 },
  ], { duration: 240, easing: "cubic-bezier(.22,.8,.24,1)", fill: "forwards" });
  a.onfinish = a.oncancel = () => fly.remove();
  setTimeout(() => fly.remove(), 600);
  holder.animate([{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }], { duration: 240, easing: "ease-out" });
}

/* ---------------- drag-to-resize in the preview ----------------
   Every scalable element renders inside a g[data-elem] group. Dragging
   one up/down feeds the same spec.scale factor as its slider (snapped to
   the slider's 5% steps), and the auto-fit layout re-balances live. The
   preview re-renders during the drag (replacing the SVG), so the drag
   listens on the window, not on the group being replaced. */
/* ---------------- click-to-edit in the preview ----------------
   Renderers tag every text drawn from a spec field with data-field. A
   click on one opens a small editor right over the preview, bound to that
   field — on a Multi Product sign, to that product's field. The editor
   drives the matching form input (value + input event), so the form's own
   listeners keep the spec, the preview and any SKU lookup in step. */
let _inlineEdit = null;
let _swallowClick = false; // set by a drag that moved, so its click is ignored
const INLINE_EDIT_KINDS = { text: 1, money: 1, percent: 1, int: 1, textarea: 1, sku: 1 };

function inlineTargetFor(textEl) {
  const key = textEl.dataset.field;
  const cellG = textEl.closest("g[data-product]");
  if (cellG) {
    const pi = parseInt(cellG.dataset.product, 10);
    const p = App.spec.products && App.spec.products[pi];
    const st = p && typeById(p.typeId);
    if (!st) return null;
    return { key, pi, spec: p.spec, type: st, input: $(`#multiProducts .mp-card[data-product="${pi}"] [data-field="${key}"]`) };
  }
  const t = typeById(App.typeId);
  if (!t) return null;
  return { key, pi: -1, spec: App.spec, type: t, input: $(`#editorFields [data-field="${key}"]`) };
}

function openInlineEdit(textEl) {
  const tgt = inlineTargetFor(textEl);
  if (!tgt) return;
  const f = tgt.type.fields.find((x) => x.key === tgt.key);
  if (!f || !INLINE_EDIT_KINDS[f.kind]) return;
  closeInlineEdit();
  const rect = textEl.getBoundingClientRect();
  const box = el("div", "inline-edit");
  box.appendChild(el("div", "inline-edit-label", (tgt.pi >= 0 ? `Product ${tgt.pi + 1} · ` : "") + f.label));
  let inp;
  const multi = f.kind === "textarea" || f.multiline;
  if (multi) inp = el("textarea", "f-textarea");
  else { inp = el("input", "f-input"); inp.type = f.kind === "int" ? "number" : "text"; }
  inp.value = tgt.spec[tgt.key] != null ? tgt.spec[tgt.key] : "";
  const original = inp.value;
  let wrap = inp;
  if (f.kind === "money") { wrap = el("div", "prefix-wrap"); wrap.dataset.prefix = "$"; wrap.appendChild(inp); }
  else if (f.kind === "percent") { wrap = el("div", "suffix-wrap"); wrap.dataset.suffix = "%"; wrap.appendChild(inp); }
  box.appendChild(wrap);
  box.appendChild(el("div", "inline-edit-hint", f.kind === "sku" ? "Enter to look it up · Esc to undo" : multi ? "Enter for a new line · click away when done · Esc to undo" : "Enter to save · Esc to undo"));
  const push = (v) => {
    if (tgt.input) {
      // the form input's own listener writes the spec, re-renders, and
      // (for a SKU) arms the lookup — one code path for both ways in
      tgt.input.value = v;
      tgt.input.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      tgt.spec[tgt.key] = f.kind === "sku" ? v.trim() : v;
      schedulePreview();
    }
  };
  inp.addEventListener("input", () => push(inp.value));
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !multi) {
      e.preventDefault();
      if (f.kind === "sku" && tgt.input) tgt.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      closeInlineEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      push(original);
      closeInlineEdit();
    }
  });
  inp.addEventListener("blur", () => setTimeout(() => { if (_inlineEdit && _inlineEdit.inp === inp) closeInlineEdit(); }, 120));
  document.body.appendChild(box);
  // sit just under the clicked text, kept on screen
  box.style.left = Math.max(8, Math.min(window.innerWidth - box.offsetWidth - 8, rect.left)) + "px";
  box.style.top = Math.max(8, Math.min(window.innerHeight - box.offsetHeight - 8, rect.bottom + 8)) + "px";
  _inlineEdit = { box, inp, key: tgt.key, pi: tgt.pi };
  inp.focus();
  inp.select();
  if (tgt.input) {
    // point to the form field: a short neutral flash, timed to land once
    // the smooth scroll has brought it into view
    const r = tgt.input.getBoundingClientRect();
    const onScreen = r.top >= 0 && r.bottom <= window.innerHeight;
    tgt.input.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const input = tgt.input;
    let fired = false;
    const go = () => { if (!fired) { fired = true; flashEls([input], "neutral"); } };
    if (onScreen) go();
    else setTimeout(go, 320);
  }
}

function closeInlineEdit() {
  if (_inlineEdit) { _inlineEdit.box.remove(); _inlineEdit = null; }
}

/* ---------------- Multi Product: position by dragging ----------------
   In the editor every product cell shows its slot number and can be
   dragged onto another cell to swap the two (▲▼ on the cards reorder).
   Badges, ghost and target hint live only in the preview DOM — never in
   the rendered SVG — so nothing prints. */
const SVG_NS = "http://www.w3.org/2000/svg";
function cellRectOf(g) {
  const [x, y, w, h] = (g.dataset.cell || "0,0,0,0").split(",").map(Number);
  return { x, y, w, h };
}

function attachProductDrag(svg) {
  const cells = Array.from(svg.querySelectorAll("g[data-product]"));
  const vb = svg.viewBox.baseVal;
  const shown = svg.getBoundingClientRect().width || 1;
  const k = vb && vb.width ? vb.width / shown : 1; // svg units per screen px
  for (const g of cells) {
    const i = parseInt(g.dataset.product, 10);
    const r = cellRectOf(g);
    const badge = document.createElementNS(SVG_NS, "g");
    badge.setAttribute("class", "mp-slot");
    badge.setAttribute("pointer-events", "none");
    const rad = 11 * k;
    const cxb = r.x + 14 * k, cyb = r.y + 14 * k;
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("cx", cxb); c.setAttribute("cy", cyb); c.setAttribute("r", rad);
    c.setAttribute("fill", "#D40029"); c.setAttribute("stroke", "#fff"); c.setAttribute("stroke-width", 2 * k);
    const tx = document.createElementNS(SVG_NS, "text");
    tx.setAttribute("x", cxb); tx.setAttribute("y", cyb + 4.5 * k);
    tx.setAttribute("text-anchor", "middle"); tx.setAttribute("font-size", 13 * k);
    tx.setAttribute("font-family", "Roboto, sans-serif"); tx.setAttribute("font-weight", "900"); tx.setAttribute("fill", "#fff");
    tx.textContent = String(i + 1);
    badge.appendChild(c); badge.appendChild(tx);
    svg.appendChild(badge);
    g.style.cursor = "grab";
    g.addEventListener("pointerdown", (e) => startProductDrag(e, svg, g, i));
  }
}

function startProductDrag(e, svg, g, i) {
  if (e.button !== 0) return;
  // a text click must still open its editor — only a real move drags
  const start = { x: e.clientX, y: e.clientY };
  const cells = Array.from(svg.querySelectorAll("g[data-product]"));
  const r = cellRectOf(g);
  let ghost = null, hint = null, target = -1, moved = false;
  const toSvg = (cx, cy) => {
    const m = svg.getScreenCTM();
    const pt = new DOMPoint(cx, cy);
    return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
  };
  const cellAt = (p) => cells.findIndex((c) => {
    const cr = cellRectOf(c);
    return p.x >= cr.x && p.x <= cr.x + cr.w && p.y >= cr.y && p.y <= cr.y + cr.h;
  });
  const move = (ev) => {
    if (!moved) {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
      moved = true;
      ghost = g.cloneNode(true);
      ghost.removeAttribute("data-product");
      ghost.setAttribute("opacity", "0.55");
      ghost.setAttribute("pointer-events", "none");
      svg.appendChild(ghost);
      hint = document.createElementNS(SVG_NS, "rect");
      hint.setAttribute("fill", "rgba(212,0,41,0.08)");
      hint.setAttribute("stroke", "#D40029");
      hint.setAttribute("stroke-width", "3");
      hint.setAttribute("stroke-dasharray", "10 6");
      hint.setAttribute("pointer-events", "none");
      hint.style.display = "none";
      svg.appendChild(hint);
      g.setAttribute("opacity", "0.35");
      document.body.style.cursor = "grabbing";
    }
    const p0 = toSvg(start.x, start.y), p1 = toSvg(ev.clientX, ev.clientY);
    ghost.setAttribute("transform", `translate(${(r.x + p1.x - p0.x).toFixed(1)},${(r.y + p1.y - p0.y).toFixed(1)})`);
    target = cellAt(p1);
    if (target >= 0 && target !== i) {
      const tr = cellRectOf(cells[target]);
      hint.setAttribute("x", tr.x); hint.setAttribute("y", tr.y);
      hint.setAttribute("width", tr.w); hint.setAttribute("height", tr.h);
      hint.style.display = "";
    } else {
      hint.style.display = "none";
    }
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    document.body.style.cursor = "";
    if (!moved) return;
    _swallowClick = true;
    setTimeout(() => { _swallowClick = false; }, 0);
    if (ghost) ghost.remove();
    if (hint) hint.remove();
    g.removeAttribute("opacity");
    const t = typeById(App.typeId);
    if (t && t.id === "multi" && target >= 0 && target !== i) swapProducts(t, i, target);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
  window.addEventListener("pointercancel", up, { once: true });
}

let _elemDrag = null; // {key, label, startY, start} while dragging

function attachPreviewDrag(holder) {
  const svg = holder.querySelector("svg");
  if (!svg || App.view !== "editor") return;
  const t = typeById(App.typeId);
  if (!t) return;
  const defs = scalablesForType(t);
  const byKey = Object.fromEntries(defs.map((d) => [d.key, d]));
  // click-to-edit: every text a renderer drew from a spec field
  for (const tx of svg.querySelectorAll("text[data-field]")) {
    tx.style.cursor = "text";
    tx.addEventListener("click", (e) => {
      if (_swallowClick) { _swallowClick = false; return; }
      e.stopPropagation();
      openInlineEdit(tx);
    });
  }
  if (t.id === "multi") attachProductDrag(svg);
  attachExtrasDrag(svg);
  for (const g of svg.querySelectorAll("g[data-elem]")) {
    const d = byKey[g.dataset.elem];
    if (!d) continue;
    g.style.cursor = "ns-resize";
    if (!g.querySelector(":scope > title")) {
      const tip = document.createElementNS("http://www.w3.org/2000/svg", "title");
      tip.textContent = `${d.label}: drag up to make it bigger, down to make it smaller`;
      g.insertBefore(tip, g.firstChild);
    }
    g.addEventListener("pointerenter", () => { if (!_elemDrag) showDragHint(svg, g, d.label); });
    g.addEventListener("pointerleave", () => { if (!_elemDrag) hideDragHint(); });
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
    // eases in on hover; solid with a faint tint while dragging (no replay
    // on the redraws a drag causes)
    r.setAttribute("class", "drag-hint " + (_elemDrag ? "live" : "enter"));
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
  document.body.classList.add("elem-dragging");
  if (_dragHintEl) _dragHintEl.setAttribute("class", "drag-hint live");
  const badge = el("div", "drag-badge");
  const place = (ev) => {
    const v = App.spec.scale[d.key] || 1;
    // at the limit the badge says why the part stopped growing
    const lim = v >= SCALE_MAX ? " (max)" : v <= SCALE_MIN ? " (min)" : "";
    badge.textContent = `${d.label} ${Math.round(v * 100)}%${lim}`;
    badge.classList.toggle("at-limit", !!lim);
    badge.style.left = ev.clientX + 14 + "px";
    badge.style.top = ev.clientY - 10 + "px";
  };
  place(e);
  document.body.appendChild(badge);
  const move = (ev) => {
    if (Math.abs(ev.clientY - _elemDrag.startY) > 3) _elemDrag.moved = true;
    // 220px of drag spans roughly 110% of size
    const raw = _elemDrag.start + (_elemDrag.startY - ev.clientY) / 220;
    const snapped = Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, raw)) * 20) / 20;
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
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    // a drag that moved must not also count as a click on the text under it
    _swallowClick = !!_elemDrag.moved;
    setTimeout(() => { _swallowClick = false; }, 0);
    _elemDrag = null;
    document.body.classList.remove("elem-dragging");
    badge.remove();
    hideDragHint();
  };
  window.addEventListener("pointermove", move);
  // pointercancel too: a touch/pen interruption never delivers pointerup,
  // which would leave the badge stuck and this pointermove handler attached
  // (still resizing elements on every cursor move) forever.
  window.addEventListener("pointerup", up, { once: true });
  window.addEventListener("pointercancel", up, { once: true });
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
  const reset = $("#scaleResetBtn");
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

/* The sign "units" a lookup can re-price inside a queue/batch item: the
   item itself for a single sign, each product of a Multi Product sign.
   Units are live {typeId, spec} references — applyPriceResult rewrites
   them in place, and a product's typeId/spec are its own. */
function priceUnits(q) {
  if (!q || !q.spec) return [];
  const refreshable = (u) => u && u.spec && String(u.spec.sku || "").trim() && PRICE_REFRESH_TYPES[u.typeId];
  if (q.typeId === "multi") {
    return (Array.isArray(q.spec.products) ? q.spec.products : []).filter((p) => p && typeById(p.typeId) && refreshable(p));
  }
  return refreshable(q) ? [q] : [];
}

/* Every SKU an item carries — a multi sign has one per product. */
function itemSkus(q) {
  if (q.typeId === "multi") {
    return (Array.isArray(q.spec.products) ? q.spec.products : [])
      .map((p) => String((p && p.spec && p.spec.sku) || "").trim())
      .filter(Boolean);
  }
  const s = String(q.spec.sku || "").trim();
  return s ? [s] : [];
}

/* Identity of a sign for "queue it once" dedupe across batches. */
function itemSignKey(u) {
  return `${u.typeId}|${u.sizeId}|${itemSkus(u).join(",")}`;
}

/* Price-check state of an item: null when nothing on it is refreshable,
   else {age} — the oldest lookup in days, or null when any unit was never
   checked. A multi sign is only as fresh as its stalest product. */
function itemPriceAge(q) {
  const units = priceUnits(q);
  if (!units.length) return null;
  let worst = 0;
  for (const u of units) {
    const a = priceAgeDays(u.spec);
    if (a == null) return { age: null };
    if (a > worst) worst = a;
  }
  return { age: worst };
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

/* Multi-select: tick signs in the queue to print/save just those. Lives
   only in memory — a reload or batch load starts unselected. */
const _qSel = new Set();
function selectedQueueItems() {
  return Queue.items.filter((q) => _qSel.has(q.uid));
}

/* Queue rows are rebuilt on every change, so motion is added back the
   same FLIP way as the preview: remember where each row (by its uid) sat,
   rebuild, then let each kept row glide from its old spot. Rows that
   weren't there before slide in. */
let _queueKnown = null; // uids drawn last time (null = first draw: no slide-ins)
const _qFlash = new Set(); // uids to flash green once on the next rail draw ("it worked")
let _qPrev = new Map();    // uid -> {copies, badge} as last drawn (pops only what changed)
let _lastEditUid = null;   // the ring tightens onto a row only when editing starts
let _dragFrom = -1;        // row index being dragged, for the drop line's side
function queueRowRects(host) {
  const m = new Map();
  for (const r of host.querySelectorAll(".q-item[data-uid]")) m.set(r.dataset.uid, r.getBoundingClientRect().top);
  return m;
}
function animateQueueRows(host, before) {
  const known = _queueKnown;
  _queueKnown = new Set(Queue.items.map((q) => q.uid));
  const motion = previewMotionOK();
  // a sign added below the fold of the rail scrolls into view, so staff
  // see it arrive (smoothly; instantly with motion off)
  if (known) {
    const firstNew = [...host.querySelectorAll(".q-item[data-uid]")].find((r) => !known.has(r.dataset.uid));
    if (firstNew) firstNew.scrollIntoView({ block: "nearest", behavior: motion ? "smooth" : "auto" });
  }
  if (!motion) return;
  for (const r of host.querySelectorAll(".q-item[data-uid]")) {
    const uid = r.dataset.uid;
    if (known && !known.has(uid)) { r.classList.add("q-new"); continue; }
    const was = before.get(uid);
    if (was == null) continue;
    const dy = was - r.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) continue;
    r.style.transition = "none";
    r.style.transform = `translateY(${dy}px)`;
    requestAnimationFrame(() => {
      r.style.transition = "transform 200ms cubic-bezier(.22,.8,.24,1)";
      r.style.transform = "";
      setTimeout(() => { r.style.transition = ""; }, 220);
    });
  }
}

function renderQueue() {
  const host = $("#queueItems");
  const count = $("#queueCount");
  const before = queueRowRects(host);
  const total = String(Queue.totalSigns());
  // (a sign flying in from Add to Queue bumps the badge when it lands)
  if (count.textContent !== total && _queueKnown && previewMotionOK() && performance.now() > _bumpAt) {
    count.classList.remove("bump");
    void count.offsetWidth;
    count.classList.add("bump");
  }
  count.textContent = total;
  // selection can only reference rows that still exist
  for (const uid of [..._qSel]) if (!Queue.items.some((q) => q.uid === uid)) _qSel.delete(uid);
  if (!Queue.items.length) {
    _queueSeq++; // cancel any in-flight thumbnail pass for the old contents
    _queueKnown = new Set();
    _qFlash.clear();
    _qPrev = new Map();
    _lastEditUid = null;
    host.innerHTML = `<div class="queue-empty">Queue is empty.<br>Build a sign and hit <b>＋ Add to Queue</b> — mix any types and sizes, then print them all at once.</div>`;
    $("#sheetPreviews").innerHTML = "";
    $("#queueStats").textContent = "";
    $("#sheetBox").style.display = "none";
    updateQueueButtons();
    return;
  }
  $("#sheetBox").style.display = "";
  host.innerHTML = "";
  // bulk add and batch loads make silent doubles easy — badge any SKU
  // that appears more than once at the same size
  const dupCounts = {};
  for (const q of Queue.items) {
    for (const sku of itemSkus(q)) dupCounts[`${sku}|${q.sizeId}`] = (dupCounts[`${sku}|${q.sizeId}`] || 0) + 1;
  }
  const motion = previewMotionOK();
  const next = new Map();
  const editStart = !!App.editingUid && App.editingUid !== _lastEditUid && motion;
  _lastEditUid = App.editingUid;
  Queue.items.forEach((q, idx) => {
    const item = el("div", "q-item" + (q.uid === App.editingUid ? " editing" : ""));
    item.dataset.uid = q.uid;
    if (_qFlash.has(q.uid) && _queueKnown && motion) item.classList.add("q-flash");
    if (editStart && q.uid === App.editingUid) item.classList.add("q-edit-in");
    const prev = _qPrev.get(q.uid);
    item.title = "Click to edit this sign";
    const main = el("div", "q-main");
    const thumb = el("div", "q-thumb");
    thumb.dataset.uid = q.uid;
    const info = el("div", "q-info");
    const size = sizeById(q.sizeId);
    info.appendChild(el("div", "q-title", queueItemTitle(q)));
    const sub = el("div", "q-sub");
    sub.appendChild(document.createTextNode(`${typeById(q.typeId) ? typeById(q.typeId).label : q.typeId} · ${size.w}×${size.h}″`));
    // One badge slot per row, highest-priority wins — three stacked pills
    // on a 300px row read as noise, and "needs Now price" (can't print
    // right) always outranks "duplicate" (prints twice) outranks "stale
    // price" (worth re-checking).
    const pa = itemPriceAge(q);
    let badge = null;
    if (q.typeId === "was_now" && !String(q.spec.price || "").trim()) badge = ["q-warn", "needs Now price"];
    else if (itemSkus(q).some((sku) => dupCounts[`${sku}|${q.sizeId}`] > 1)) badge = ["q-warn", "duplicate"];
    else if (pa && pa.age != null && pa.age > 3) badge = ["q-stale", `price ${pa.age}d old`];
    else if (pa && pa.age == null) {
      // pre-2.1 items carry no lookup timestamp — call that out rather
      // than silently skipping the badge on the stalest signs of all
      badge = ["q-stale", "price unchecked"];
    }
    if (badge) {
      const bEl = el("span", badge[0], badge[1]);
      if (motion && prev && prev.badge !== badge[1]) bEl.classList.add("badge-in"); // a new warning pops in once
      sub.appendChild(bEl);
    }
    next.set(q.uid, { copies: q.copies || 1, badge: badge ? badge[1] : "" });
    info.appendChild(sub);
    main.onclick = () => startEditQueueItem(q.uid);
    // keyboard: Tab reaches each row's edit area, Enter/Space opens it
    main.tabIndex = 0;
    main.setAttribute("aria-label", "Edit " + queueItemTitle(q));
    main.onkeydown = (e) => {
      if (e.target !== main || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      startEditQueueItem(q.uid);
    };

    // One ⋯ menu instead of five icon buttons per row — eight interactive
    // targets per sign read as noise and the glyphs needed tooltips to
    // decode. Reordering is drag-and-drop (with menu entries as fallback).
    const actions = el("div", "q-actions");
    const more = el("button", "q-btn q-more", "⋯");
    more.title = "More actions";
    more.onclick = (e) => { e.stopPropagation(); showQueueItemMenu(more, q, idx); };
    actions.appendChild(more);
    const sel = el("input", "q-sel");
    sel.type = "checkbox";
    sel.checked = _qSel.has(q.uid);
    sel.title = "Select — print or save just the ticked signs";
    sel.onclick = (e) => {
      e.stopPropagation();
      if (sel.checked) _qSel.add(q.uid); else _qSel.delete(q.uid);
      updateQueueButtons();
    };
    main.appendChild(sel);
    main.appendChild(thumb);
    main.appendChild(info);
    main.appendChild(actions);
    item.appendChild(main);

    item.draggable = true;
    item.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/x-queue-uid", q.uid);
      e.dataTransfer.effectAllowed = "move";
      _dragFrom = idx;
      // after the browser takes its drag picture, so the picture stays solid
      requestAnimationFrame(() => item.classList.add("dragging"));
    });
    item.addEventListener("dragend", () => {
      _dragFrom = -1;
      item.classList.remove("dragging");
      host.querySelectorAll(".drag-over").forEach((r) => r.classList.remove("drag-over", "drag-below"));
    });
    item.addEventListener("dragover", (e) => {
      if (![...e.dataTransfer.types].includes("text/x-queue-uid")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (_dragFrom === idx) return; // over itself: no line
      item.classList.add("drag-over");
      // a downward drag lands AFTER the target row, an upward one BEFORE it
      item.classList.toggle("drag-below", _dragFrom > -1 && _dragFrom < idx);
    });
    item.addEventListener("dragleave", (e) => {
      if (item.contains(e.relatedTarget)) return; // onto a child, not leaving
      item.classList.remove("drag-over", "drag-below");
    });
    item.addEventListener("drop", (e) => {
      const uid = e.dataTransfer.getData("text/x-queue-uid");
      item.classList.remove("drag-over", "drag-below");
      if (!uid || uid === q.uid) return;
      e.preventDefault();
      _qFlash.add(uid);
      Queue.moveTo(uid, idx);
      _qFlash.clear();
    });

    const copies = el("div", "q-copy-row");
    copies.onclick = (e) => e.stopPropagation();
    copies.appendChild(el("span", null, "Copies"));
    const minus = el("button", "q-step", "−");
    minus.title = "One less copy";
    minus.disabled = (q.copies || 1) <= 1;
    minus.onclick = () => Queue.setCopies(q.uid, (q.copies || 1) - 1);
    const n = el("b", "q-copies", `×${q.copies || 1}`);
    if (motion && prev && prev.copies !== (q.copies || 1)) n.classList.add("bump"); // the click visibly took
    const plus = el("button", "q-step", "＋");
    plus.title = "One more copy";
    plus.onclick = () => Queue.setCopies(q.uid, (q.copies || 1) + 1);
    copies.appendChild(minus);
    copies.appendChild(n);
    copies.appendChild(plus);
    item.appendChild(copies);
    host.appendChild(item);
  });
  _qPrev = next;
  animateQueueRows(host, before);
  updateQueueButtons();
  scheduleQueueVisuals(); // thumbnails + sheet previews, batched to one pass
}

function updateQueueButtons() {
  const has = Queue.items.length > 0;
  $("#printAllBtn").disabled = !has;
  $("#exportAllBtn").disabled = !has;
  $("#clearQueueBtn").disabled = !has;
  $("#refreshPricesBtn").disabled = !has || _refreshingPrices;
  // With a selection, the print buttons act on just the ticked signs.
  const selItems = selectedQueueItems();
  const nSel = selItems.reduce((a, q) => a + (q.copies || 1), 0);
  $("#printAllBtn").textContent = nSel ? `🖨 Print Selected (${nSel})` : "🖨 Print All";
  $("#exportAllBtn").textContent = nSel ? `Save PDF (${nSel})` : "Save PDF";
  const bar = $("#selBar");
  if (bar) {
    bar.style.display = nSel ? "" : "none";
    if (nSel) $("#selBarText").textContent = `${nSel} sign${nSel === 1 ? "" : "s"} selected —`;
  }
}

function clearQueueSelection() {
  _qSel.clear();
  renderQueue();
}

function clearQueueWithUndo() {
  if (!Queue.items.length) return;
  const snap = Queue.clear();
  const n = snap.reduce((a, q) => a + (q.copies || 1), 0);
  // prepend on undo: signs added during the toast window survive
  showToast(`Queue cleared — ${n} sign${n === 1 ? "" : "s"}.`, { undo: () => Queue.replaceAll(snap.concat(Queue.items)) });
}

/* ---------------- toasts ----------------
   opts: undo (adds an Undo button), ms (how long it stays), kind ("ok"
   or "warn": a small green ✓ / amber ! badge). A pointer resting on a
   toast keeps it up; Undo confirms with "↶ Undone". */
let _toastTimer = null;
function showToast(text, opts) {
  const o = opts || {};
  const host = $("#toastHost");
  if (!host) return;
  clearTimeout(_toastTimer);
  host.innerHTML = "";
  const t = el("div", "toast" + (o.kind && !o.undo ? " " + o.kind : ""));
  t.appendChild(el("span", "toast-text", text));
  // slide away, then remove (instantly when motion is turned off)
  const dismiss = () => {
    clearTimeout(_toastTimer);
    if (!t.isConnected || t.classList.contains("leaving")) return;
    t.classList.add("leaving");
    setTimeout(() => t.remove(), previewMotionOK() ? 170 : 0);
  };
  const arm = (ms) => { clearTimeout(_toastTimer); _toastTimer = setTimeout(dismiss, ms); };
  if (o.undo) {
    const u = el("button", "toast-undo", "Undo");
    u.onclick = () => {
      u.remove(); // one undo per toast, even if undo() throws
      arm(1500);
      o.undo();
      if (!t.isConnected) return; // undo() put up its own message
      t.querySelector(".toast-text").textContent = "↶ Undone";
      t.classList.add("undone");
    };
    t.appendChild(u);
  }
  const x = el("button", "toast-close", "✕");
  x.title = "Dismiss";
  x.onclick = dismiss;
  t.appendChild(x);
  // a pointer resting on the toast keeps it up; moving off gives a short grace period
  const held = () => t.isConnected && !t.classList.contains("leaving") && !t.classList.contains("undone");
  t.addEventListener("mouseenter", () => { if (held()) clearTimeout(_toastTimer); });
  t.addEventListener("mouseleave", () => { if (held()) arm(2500); });
  host.appendChild(t);
  arm(o.ms || (o.undo ? 10000 : 5000));
}

/* ---------------- price refresh ---------------- */
/* Types whose price fields map 1:1 onto lookup results. Everything else
   (percent/BOGO/savings…) is hand-entered and left alone. */
const PRICE_REFRESH_TYPES = {
  regular: true, sale: true, big_text: true, stihl_clearance: true,
  arrow_up: true, arrow_down: true, arrow_left: true, arrow_right: true,
};
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
  const refreshable = (q) => q.uid !== App.editingUid && priceUnits(q).length > 0;
  const targets = Queue.items.filter(refreshable);
  const manual = Queue.items.filter((q) => !refreshable(q)).length;
  if (!targets.length) {
    showToast("Nothing to refresh — no queued Regular/Sale/Big Text signs (or Multi Product cells) with a SKU.");
    return;
  }
  const btn = $("#refreshPricesBtn");
  const orig = btn.textContent;
  _refreshingPrices = true;
  btn.disabled = true;
  // the button fills like a progress bar; each row dims while it's checked
  btn.classList.add("busy");
  btn.setAttribute("aria-busy", "true");
  let fin = 0;
  let done = 0, changed = 0, failed = 0;
  const work = targets.slice();
  const runOne = async () => {
    const q = work.shift();
    if (!q) return;
    btn.textContent = `↻ ${++done}/${targets.length}`;
    const row = document.querySelector(`.q-item[data-uid="${CSS.escape(q.uid)}"]`);
    if (row) row.classList.add("q-checking");
    try {
      // one lookup per unit — a multi sign refreshes each of its products
      let gotData = false, moved = false;
      for (const u of priceUnits(q)) {
        const res = await fetch(`/api/lookup?q=${encodeURIComponent(u.spec.sku)}&refresh=1&store=${encodeURIComponent(Settings.get().storeCode)}`).then((r) => r.json());
        const r = applyPriceResult(u, res);
        if (r != null) { gotData = true; if (r) moved = true; }
      }
      if (!gotData) failed++;
      else {
        Queue._bumpRev(q); // spec mutated in place — drop its cached SVG
        if (moved) { changed++; _qFlash.add(q.uid); }
      }
    } catch (e) { failed++; }
    if (row) row.classList.remove("q-checking");
    btn.style.setProperty("--p", (++fin / targets.length * 100) + "%");
    await runOne();
  };
  await Promise.all(Array.from({ length: Math.min(4, targets.length) }, runOne));
  btn.textContent = orig;
  btn.classList.remove("busy");
  btn.removeAttribute("aria-busy");
  btn.style.removeProperty("--p");
  _refreshingPrices = false;
  persistState();
  renderQueue(); // the rows whose price changed flash green once
  _qFlash.clear();
  const okCount = targets.length - failed;
  let msg = `Refreshed ${okCount} sign${okCount === 1 ? "" : "s"} — ${changed} price change${changed === 1 ? "" : "s"}`;
  if (manual) msg += `, ${manual} sign${manual === 1 ? "" : "s"} left untouched`;
  if (failed) msg += `, ${failed} without price data (unchanged)`;
  showToast(msg + ".", { kind: failed ? "warn" : "ok" });
}

/* ---------------- batch pick menu ----------------
   Small anchored menu of saved batch names — used by the queue rail's 🗂
   button to drop a single sign into an existing batch. */
/* Per-row ⋯ menu on queued signs: duplicate / add-to-batch / reorder /
   remove, sharing the pick-menu chrome (and its one-at-a-time state). */
function showQueueItemMenu(anchor, q, idx) {
  closeBatchPickMenu();
  const menu = el("div", "pick-menu");
  markMenuAnchor(menu, anchor);
  const item = (label, fn, disabled) => {
    const b = el("button", "pick-item", label);
    b.disabled = !!disabled;
    b.onclick = (e) => { e.stopPropagation(); closeBatchPickMenu(); fn(); };
    menu.appendChild(b);
  };
  item("⧉ Duplicate", () => Queue.duplicate(q.uid));
  item("🗂 Add to a saved batch…", () => {
    showBatchPickMenu(anchor, (name) => {
      const ok = Batches.addItems(name, [q]);
      showToast(ok
        ? `Added “${queueItemTitle(q)}” to batch “${name}”.`
        : `Batch “${name}” no longer exists.`, { kind: ok ? "ok" : "warn" });
    });
  });
  item("▲ Move up", () => Queue.move(q.uid, -1), idx === 0);
  item("▼ Move down", () => Queue.move(q.uid, 1), idx === Queue.items.length - 1);
  item("✕ Remove", () => {
    const rem = Queue.remove(q.uid);
    if (rem) showToast(`Removed “${queueItemTitle(rem.item)}”.`, { undo: () => Queue.restore(rem.item, rem.index) });
  });
  document.body.appendChild(menu);
  _pickMenuEl = menu;
  const r = anchor.getBoundingClientRect();
  menu.style.top = Math.max(8, Math.min(window.innerHeight - menu.offsetHeight - 8, r.bottom + 4)) + "px";
  menu.style.left = Math.max(8, r.right - menu.offsetWidth) + "px";
  setTimeout(() => document.addEventListener("click", closeBatchPickMenu, { once: true }), 0);
}

let _pickMenuEl = null;
/* The button that opened a menu keeps a pressed look while it's open. */
function markMenuAnchor(menu, anchor) {
  if (!anchor || !anchor.classList) return;
  menu._anchor = anchor;
  anchor.classList.add("menu-open");
  anchor.setAttribute("aria-expanded", "true");
}
function closeBatchPickMenu() {
  if (_pickMenuEl) {
    const a = _pickMenuEl._anchor;
    if (a) { a.classList.remove("menu-open"); a.setAttribute("aria-expanded", "false"); }
    try { _pickMenuEl.remove(); } catch (e) {}
    _pickMenuEl = null;
  }
}
function showBatchPickMenu(anchor, onPick) {
  closeBatchPickMenu();
  const names = Batches.names();
  const menu = el("div", "pick-menu");
  markMenuAnchor(menu, anchor);
  menu.appendChild(el("div", "pick-head", "Add to batch"));
  if (!names.length) {
    menu.appendChild(el("div", "pick-empty", "No saved batches yet — use Batches → Save first."));
  }
  for (const n of names) {
    const b = el("button", "pick-item", n);
    b.onclick = () => { closeBatchPickMenu(); onPick(n); };
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  _pickMenuEl = menu;
  const r = anchor.getBoundingClientRect();
  menu.style.top = Math.max(8, Math.min(window.innerHeight - menu.offsetHeight - 8, r.bottom + 4)) + "px";
  menu.style.left = Math.max(8, r.right - menu.offsetWidth) + "px";
  // any outside click dismisses; deferred so this opening click doesn't
  setTimeout(() => document.addEventListener("click", closeBatchPickMenu, { once: true }), 0);
}

/* Dialog lists: rows rise in one after another as the dialog opens (not on
   every re-render). */
function staggerRows(host) {
  if (!host || !previewMotionOK()) return;
  [...host.children].forEach((r, i) => r.style.setProperty("--i", String(Math.min(i, 8))));
  host.classList.add("stagger");
  setTimeout(() => host.classList.remove("stagger"), 420);
}
/* "It worked": the batch row that was just saved or added to glows green. */
function flashBatchRow(name) {
  const row = $$("#batchList .batch-row").find((r) => r.dataset.name === name);
  if (!row) return;
  $("#batchList").classList.remove("stagger"); // a save right after opening: the flash wins
  row.scrollIntoView({ block: "nearest", behavior: previewMotionOK() ? "smooth" : "auto" });
  if (!previewMotionOK()) return;
  row.classList.add("just-saved");
  setTimeout(() => row.classList.remove("just-saved"), 1200);
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
    flashBatchRow(name);
    showToast(existed ? `Batch “${name}” updated.` : `Batch “${name}” saved.`, { kind: "ok" });
  };
  renderBatchList();
  staggerRows($("#batchList"));
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
    row.dataset.name = name;
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
          if (Queue._gen !== gen) return showToast("The queue changed since the batch loaded — undo unavailable.", { kind: "warn" });
          Queue.replaceAll(prev);
        },
      });
    };
    const addQ = el("button", "btn btn-secondary btn-sm", "＋ Queue");
    addQ.title = "Add every sign currently in the queue to this batch";
    addQ.disabled = !Queue.items.length;
    addQ.onclick = () => {
      const count = Queue.totalSigns();
      if (!Batches.addItems(name, Queue.items)) return;
      renderBatchList();
      flashBatchRow(name);
      showToast(`Added ${count} sign${count === 1 ? "" : "s"} from the queue to batch “${name}”.`, { kind: "ok" });
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
    row.appendChild(addQ);
    row.appendChild(del);
    host.appendChild(row);
  }
}

/* ---------------- one-click sync opt-in ----------------
   Release builds carry the store's sync connection, so a PC that hasn't
   decided yet gets a launch banner: Turn on (named after the computer)
   or dismiss for good on this PC. Settings can change either later. */
function maybeOfferSync() {
  const s = Settings.get();
  if (!window.__builtinSync || s.syncOn || s.syncOfferDismissed) return;
  const bar = $("#syncOfferBar");
  if (!bar) return;
  $("#syncOfferOn").onclick = () => {
    Settings.set({ syncOn: true, syncName: String(s.syncName || window.__appHost || "").trim() });
    bar.classList.remove("show");
    Sync.start();
    showToast("Sync is on — saved batches and print history are now shared with the store.", { kind: "ok" });
  };
  $("#syncOfferDismiss").onclick = () => {
    Settings.set({ syncOfferDismissed: true });
    bar.classList.remove("show");
  };
  bar.classList.add("show");
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
  // a crash-loop / quick relaunch shouldn't hammer acehardware.com —
  // skip only if a scan finished within the last 30 minutes
  try {
    const last = Date.parse(localStorage.getItem(BATCH_SCAN_KEY) || "");
    if (!isNaN(last) && Date.now() - last < 30 * 60000) return;
  } catch (e) {}
  const r = await scanBatchPrices();
  if (r && (r.changed.length || r.ended.length)) showBatchPriceBar(r.changed, r.ended, r.endedNoSku.length);
}

/* Check every saved batch's signs against today's store prices. Shared by
   the launch banner and the on-demand Price check report. Returns
   {changed, ended, endedNoSku, checked} — or null when there was nothing
   to check or no lookup answered (offline). */
async function scanBatchPrices() {
  const today = todayISO();
  // ended = the sale ran out before today; a sale ending today still counts
  const isEnded = (q) =>
    /^\d{4}-\d{2}-\d{2}$/.test(String(q.spec.endDate || "")) &&
    q.spec.endDate < today && !q.spec._endedOffered;
  const priceTargets = [], endedTargets = [], endedNoSku = [];
  for (const name of Batches.names()) {
    for (const q of Batches.data[name].items || []) {
      if (!q.spec) continue;
      if (priceUnits(q).length) priceTargets.push({ name, q });
      else if (isEnded(q)) (String(q.spec.sku || "").trim() ? endedTargets : endedNoSku).push({ name, q });
    }
  }
  if (!priceTargets.length && !endedTargets.length) return null;

  // one lookup per distinct SKU — a multi sign contributes one per product
  const skus = [...new Set(
    priceTargets.flatMap((t) => priceUnits(t.q).map((u) => String(u.spec.sku).trim()))
      .concat(endedTargets.map((t) => String(t.q.spec.sku).trim()))
  )];
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
  if (!bySku.size) return null;
  try { localStorage.setItem(BATCH_SCAN_KEY, new Date().toISOString()); } catch (e) {}

  // apply to copies first — the stored batches only change if the user accepts
  const changed = []; // {name, stored, updated} — price moved, batch gets the update
  const ended = [];   // {name, stored, updated} — promo over, replacement queued only
  for (const t of priceTargets) {
    const updated = JSON.parse(JSON.stringify(t.q));
    // the copy yields the same units in the same order as the stored item
    let answered = false, moved = false;
    for (const u of priceUnits(updated)) {
      const res = bySku.get(String(u.spec.sku).trim());
      if (!res) continue;
      answered = true;
      if (applyPriceResult(u, res)) moved = true;
    }
    if (!answered) continue;
    if (moved) {
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
  return { changed, ended, endedNoSku, checked: bySku.size };
}

function showBatchPriceBar(changed, ended, endedNoSkuCount) {
  const bar = $("#batchPriceBar");
  if (!bar) return;
  ended = ended || [];
  const all = changed.concat(ended);
  const batches = [...new Set(all.map((c) => c.name))];
  // esc() matters: batch names are free text and arrive from other computers
  // via sync — this string lands in innerHTML below.
  const bList = batches.slice(0, 3).map((b) => `“${esc(b)}”`).join(", ") + (batches.length > 3 ? ` +${batches.length - 3} more` : "");
  // a sign saved in several batches counts (and prints) once
  const uniq = (list) => new Set(list.map((c) => itemSignKey(c.updated))).size;
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
    applyBatchPriceChanges(changed, ended);
    bar.classList.remove("show");
  };
  $("#batchPriceDismiss").onclick = () => bar.classList.remove("show");
  bar.classList.add("show");
}

/* Accept a price scan's findings: queue one replacement per unique sign,
   write new prices/types into the stored batches, and stamp ended promos
   so they aren't re-offered. Shared by the launch banner and the Price
   check report. */
function applyBatchPriceChanges(changed, ended) {
  const seen = new Set();
  let added = 0;
  const queueOnce = (u) => {
    const key = itemSignKey(u);
    if (seen.has(key)) return;
    seen.add(key);
    Queue.add(u.typeId, u.sizeId, u.spec, u.copies || 1);
    added++;
  };
  // The banner/report can sit unclicked while a sync merge (or backup
  // import) replaces Batches.data — mutating the object references
  // captured at scan time would then write into orphaned copies and
  // silently change nothing. Re-resolve each row by batch name + item uid
  // at click time, and bump savedAt on every touched batch so the accepted
  // updates win the newest-wins merge on the other computers.
  const resolveStored = (c) => {
    const b = Batches.data[c.name];
    if (!b || !b.items) return null;
    return b.items.find((q) => q && q.uid === c.stored.uid) || null;
  };
  const touched = new Set();
  for (const c of changed) {
    // write the new price/type into the stored batch item; the rev bump
    // keeps a later "Load batch" from serving the old price out of the
    // rendered-SVG cache (batch items keep their uid when reloaded)
    const stored = resolveStored(c);
    if (stored) {
      stored.typeId = c.updated.typeId;
      stored.spec = c.updated.spec;
      Queue._bumpRev(stored);
      touched.add(c.name);
    }
    queueOnce(c.updated);
  }
  for (const c of ended) {
    // the batch keeps the promo sign (it may run again) — just remember
    // the offer was taken so it doesn't repeat every launch
    const stored = resolveStored(c);
    if (stored) {
      stored.spec._endedOffered = todayISO();
      touched.add(c.name);
    }
    queueOnce(c.updated);
  }
  const at = new Date().toISOString();
  for (const name of touched) Batches.data[name].savedAt = at;
  persistState();
  const notes = [];
  if (changed.length) notes.push("the batches now carry the new prices");
  if (ended.length) notes.push("ended promos stay in their batches for next time");
  showToast(`Queued ${added} replacement sign${added === 1 ? "" : "s"} — ${notes.join("; ")}.`, { kind: "ok" });
  return added;
}

/* On-demand price check across all saved batches — the launch banner as a
   deliberate, reviewable report. Opened from the Batches modal. */
async function runPriceCheckReport() {
  const modal = $("#priceCheckModal");
  const body = $("#priceCheckBody");
  const queueBtn = $("#priceCheckQueueBtn");
  queueBtn.style.display = "none";
  body.innerHTML = `<div class="f-help" style="font-size:12.5px"><span class="spin"></span> Checking saved batches against today's store prices…</div>`;
  modal.classList.add("show");
  const r = await scanBatchPrices();
  if (!modal.classList.contains("show")) return; // closed while checking
  if (!r) {
    body.innerHTML = `<div class="f-help" style="font-size:12.5px">Nothing to check — no saved batch has signs with a SKU (or the store site didn't answer; try again in a minute).</div>`;
    return;
  }
  const { changed, ended, endedNoSku, checked } = r;
  if (!changed.length && !ended.length) {
    body.innerHTML = `<div class="pc-allgood">✓ All ${checked} checked sign${checked === 1 ? "" : "s"} match today's store prices.</div>` +
      (endedNoSku.length ? `<div class="f-help">${endedNoSku.length} ended promo${endedNoSku.length === 1 ? " has" : "s have"} no SKU — open their batch to rebuild by hand.</div>` : "");
    return;
  }
  const money = (v) => (String(v || "").trim() ? "$" + String(v).trim() : "—");
  const byBatch = new Map();
  for (const c of changed) { if (!byBatch.has(c.name)) byBatch.set(c.name, []); byBatch.get(c.name).push({ c, kind: "changed" }); }
  for (const c of ended) { if (!byBatch.has(c.name)) byBatch.set(c.name, []); byBatch.get(c.name).push({ c, kind: "ended" }); }
  let html = `<div class="f-help" style="margin-bottom:8px">${checked} SKU${checked === 1 ? "" : "s"} checked. Queue the replacements below — price changes update the batches too.</div>`;
  for (const [name, rows] of byBatch) {
    html += `<div class="pc-group"><div class="pc-batch">🗂 ${esc(name)}</div>`;
    for (const { c, kind } of rows) {
      const title = esc(queueItemTitle(c.updated));
      if (kind === "changed") {
        const flip = c.stored.typeId !== c.updated.typeId
          ? (c.updated.typeId === "sale" ? " · now on sale" : " · sale over")
          : "";
        html += `<div class="pc-row">${title} <span class="pc-price">${esc(money(c.stored.spec.price))} → <b>${esc(money(c.updated.spec.price))}</b>${flip}</span></div>`;
      } else {
        html += `<div class="pc-row">${title} <span class="pc-price">promo ended — back to <b>${esc(money(c.updated.spec.price))}</b></span></div>`;
      }
    }
    html += `</div>`;
  }
  if (endedNoSku.length) {
    html += `<div class="f-help">${endedNoSku.length} more ended promo${endedNoSku.length === 1 ? " has" : "s have"} no SKU — open their batch to rebuild by hand.</div>`;
  }
  body.innerHTML = html;
  queueBtn.style.display = "";
  queueBtn.onclick = () => {
    applyBatchPriceChanges(changed, ended);
    modal.classList.remove("show");
  };
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
  staggerRows($("#historyList"));
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
          if (Queue._gen !== gen) return showToast("The queue changed since the restore — undo unavailable.", { kind: "warn" });
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
  // The summary line above carries the decision-making info; composing the
  // page thumbnails is only worth it while the section is open (a toggle
  // listener re-runs this when it opens).
  const box = $("#sheetBox");
  if (box && !box.open) return packed;
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
function stalePricedItems(items) {
  return (items || Queue.items).filter((q) => {
    const pa = itemPriceAge(q);
    return !!pa && (pa.age == null || pa.age > STALE_PRICE_DAYS);
  });
}

/* Last stop before an out-of-date price reaches a shelf. The queue persists
   for weeks and batches get reloaded months later, so "load last spring's
   sale, hit Print All" is one distracted click — and a wrong shelf price is
   the most expensive mistake this app can make. Offers the fix (refresh
   first) rather than just blocking. */
function promptStalePrices(stale, print) {
  const modal = $("#stalePriceModal");
  const never = stale.filter((q) => itemPriceAge(q).age == null).length;
  const ages = stale.map((q) => itemPriceAge(q).age).filter((d) => d != null);
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
    const age = itemPriceAge(q).age;
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
  // With a selection, everything below acts on just the ticked signs.
  const selItems = selectedQueueItems();
  const source = selItems.length ? selItems : Queue.items;
  // Signs print exactly as their previews show, finished or not (4.0:
  // the store's call). Unfinished ones get a heads-up, never a block.
  const bad = source.filter((q) => {
    const t = typeById(q.typeId);
    return t && validateSpec(t, q.spec);
  });
  if (bad.length) {
    const first = validateSpec(typeById(bad[0].typeId), bad[0].spec);
    showToast(`Heads-up: ${bad.length} sign${bad.length === 1 ? " looks" : "s look"} unfinished — “${queueItemTitle(bad[0])}”: ${first} Printing ${bad.length === 1 ? "it" : "them"} as shown.`, { ms: 9000, kind: "warn" });
  }
  if (!(opts && opts.skipStaleCheck)) {
    const stale = stalePricedItems(source);
    if (stale.length) {
      promptStalePrices(stale, print);
      return;
    }
  }
  const btn = print ? $("#printAllBtn") : $("#exportAllBtn");
  const orig = btn.textContent;
  let okDone = false;
  btn.disabled = true;
  btn.classList.add("busy"); // stays in full color and fills as sheets render
  try {
    const packed = packQueue(Queue.packable(source), { margin: Settings.get().margin });
    btn.textContent = "Rendering…";
    const doc = await pagesToPdf(packed.pages, Settings.get().cutGuides, (i, n) => {
      btn.textContent = `Sheet ${i}/${n}…`;
      btn.style.setProperty("--p", (i / n * 100) + "%");
    });
    if (print) printPdfDoc(doc);
    else {
      const d = new Date();
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      downloadPdfDoc(doc, `ace-signs-${stamp}.pdf`);
    }
    History.record(print ? "print" : "pdf", source);
    okDone = true;
  } catch (e) {
    alert("Export failed: " + friendlyError(e) + ".");
    console.error(e);
  } finally {
    btn.textContent = orig;
    btn.disabled = false;
    btn.classList.remove("busy");
    btn.style.removeProperty("--p");
    // handed to the print dialog / download: a green ring, once (after the
    // button is already usable again)
    if (okDone) pulseDone(btn, "did-it");
  }
}

/* ---------------- bulk add ---------------- */
/* Promo details the lookup can't supply — shown as small shared inputs
   when the picked type needs them, applied to every SKU in the batch
   ("everything in the list is 25% off"). */
const BULK_EXTRAS = {
  percent_off: [{ key: "percent", label: "% off", ph: "25" }],
  bogo_percent: [{ key: "percent", label: "% off", ph: "50" }],
  two_for: [{ key: "qty", label: "Qty", ph: "2", int: true }, { key: "price", label: "Bundle $", ph: "9.00" }],
  instant_savings: [{ key: "savings", label: "Save $", ph: "10" }],
  buy_get_off: [{ key: "qty", label: "Buy", ph: "2", int: true }, { key: "savings", label: "$ off", ph: "10" }],
  your_choice: [{ key: "price", label: "Choice $", ph: "5.00" }],
};

function renderBulkExtras() {
  const host = $("#bulkExtras");
  const defs = BULK_EXTRAS[$("#bulkType").value] || [];
  host.innerHTML = "";
  host.style.display = defs.length ? "" : "none";
  for (const d of defs) {
    const lab = el("label", "bulk-extra-label", d.label);
    const inp = el("input", "f-input bulk-extra-input");
    inp.type = d.int ? "number" : "text";
    if (d.int) { inp.min = "2"; inp.max = "9"; }
    inp.placeholder = d.ph;
    inp.dataset.bx = d.key;
    lab.appendChild(inp);
    host.appendChild(lab);
  }
}

/* Copy-diagnostics: with the Support feature gone, this is the one way to
   pull version/settings/lookup state off a store PC when something's off.
   Clipboard only — no email, no files, no tokens. */
const _recentErrors = [];
function initDiagnostics() {
  const note = (kind, msg) => {
    _recentErrors.push(`${new Date().toISOString()} ${kind}: ${String(msg).slice(0, 300)}`);
    if (_recentErrors.length > 20) _recentErrors.shift();
  };
  window.addEventListener("error", (e) => note("error", e.message || e.type));
  window.addEventListener("unhandledrejection", (e) => note("rejection", (e.reason && (e.reason.message || e.reason)) || "unknown"));
  $("#copyDiagBtn").onclick = async () => {
    const s = Object.assign({}, Settings.get());
    const lines = [
      `Ace Sign Studio ${window.__appVersion || "?"} on ${window.__appHost || "?"}`,
      `Generated ${new Date().toISOString()}`,
      `Queue: ${Queue.totalSigns()} sign(s) in ${Queue.items.length} row(s) · Batches: ${Batches.names().length} · History: ${History.data.length}`,
      `Sync: ${Sync.enabled() ? "on" : "off"}${Sync.lastSync ? ` · last synced ${Sync.lastSync.toISOString()}` : ""}${Sync.lastError ? ` · last error: ${Sync.lastError}` : ""}`,
      "",
      "Settings: " + JSON.stringify(s),
      "",
      "Last lookup log:",
      ...(typeof lastDiagnostics !== "undefined" && lastDiagnostics.length ? lastDiagnostics.map((d, i) => `  ${i + 1}. ${d}`) : ["  (no lookup this session)"]),
      "",
      "Recent errors:",
      ...(_recentErrors.length ? _recentErrors.map((e) => "  " + e) : ["  (none)"]),
    ];
    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      showToast("Diagnostics copied — paste into a message to Cody.", { kind: "ok" });
    } catch (e) {
      const ta = el("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); showToast("Diagnostics copied.", { kind: "ok" }); }
      catch (_) { showToast("Couldn't copy automatically.", { kind: "warn" }); }
      ta.remove();
    }
  };
}

let _bulkProgHide = 0;
function initBulk() {
  $("#bulkOpenBtn").onclick = () => $("#bulkModal").classList.add("show");
  const ta = $("#bulkSkus");
  const badge = $("#bulkCount");
  ta.addEventListener("input", () => {
    badge.classList.remove("ok");
    const n = parseBulkSkus(ta.value).length;
    badge.textContent = n ? `${n} SKU${n === 1 ? "" : "s"} detected` : "";
  });
  // every sign type that works from a SKU is bulk-addable, grouped like
  // the nav; sizes come from the registry so new ones appear on their own
  const typeSel = $("#bulkType");
  for (const g of [...new Set(SIGN_TYPES.map((t) => t.group))]) {
    const grp = SIGN_TYPES.filter((t) => t.group === g && t.fields.some((f) => f.kind === "sku"));
    if (!grp.length) continue;
    const og = el("optgroup");
    og.label = g;
    for (const t of grp) {
      const o = el("option", null, t.label);
      o.value = t.id;
      og.appendChild(o);
    }
    typeSel.appendChild(og);
  }
  typeSel.onchange = renderBulkExtras;
  const sizeSel = $("#bulkSize");
  for (const s of SIZES) {
    const o = el("option", null, s.label.replace(/"$/, "″"));
    o.value = s.id;
    sizeSel.appendChild(o);
  }
  renderBulkExtras();
  $("#bulkAddBtn").onclick = async () => {
    const btn = $("#bulkAddBtn");
    if (btn.disabled) return; // a run is in flight — a second click would add everything twice
    const skus = parseBulkSkus(ta.value);
    if (!skus.length) return;
    const idle = btn.textContent;
    btn.disabled = true;
    try {
    const typeId = $("#bulkType").value;
    const sizeId = $("#bulkSize").value;
    const copies = clampCopies($("#bulkCopies").value);
    // shared promo details must be filled before anything hits the queue —
    // a blank one would bulk-add signs that can't print
    const extras = {};
    for (const d of BULK_EXTRAS[typeId] || []) {
      const v = String($(`#bulkExtras [data-bx="${d.key}"]`).value || "").trim();
      if (!v) {
        $("#bulkReport").innerHTML = "";
        $("#bulkReport").appendChild(el("div", "bulk-warn", `⚠ Fill in “${d.label}” first — it applies to every sign in this batch.`));
        return;
      }
      extras[d.key] = d.int ? String(Math.max(2, Math.min(9, parseInt(v, 10) || 2))) : v;
    }
    const prog = $("#bulkProgress");
    const fill = prog.querySelector("i");
    clearTimeout(_bulkProgHide);
    prog.classList.remove("done", "has-fails");
    fill.style.width = "0";
    prog.classList.add("show");
    // the button keeps its color with a spinner, and a live count ticks
    // as each SKU comes back
    btn.classList.add("busy");
    btn.innerHTML = `<span class="spin spin-light"></span> Looking up ${skus.length} SKU${skus.length === 1 ? "" : "s"}…`;
    badge.classList.remove("ok");
    badge.textContent = `0 of ${skus.length} looked up`;
    $("#bulkReport").innerHTML = "";
    const failed = [];   // {sku, reason}
    const needsNow = []; // Was/Now signs added without a Now price
    let done = 0, ok = 0;
    const CONCURRENCY = 5;
    // Lookups run in parallel, but signs land in the queue in the order
    // the SKUs were pasted — not the order the site happened to answer.
    const results = new Array(skus.length);
    const work = skus.map((sku, i) => ({ sku, i }));
    const runOne = async () => {
      const job = work.shift();
      if (!job) return;
      const { sku, i } = job;
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
          // shared promo details (percent/savings/qty — and for 2-for /
          // Your Choice, the promo price replaces the looked-up price)
          Object.assign(spec, extras);
          results[i] = { addType, spec };
          ok++;
        } else {
          failed.push({ sku, reason: res.error || "no product data" });
        }
      } catch (e) {
        failed.push({ sku, reason: "connection failed" });
      }
      done++;
      fill.style.width = `${(done / skus.length) * 100}%`;
      badge.textContent = `${done} of ${skus.length} looked up`;
      await runOne();
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, skus.length) }, runOne));
    for (const r of results) if (r) Queue.add(r.addType, sizeId, r.spec, copies);
    // the bar reaches the end and shows how it went (green, or amber when
    // some failed), then fades — it never holds anything up
    prog.classList.add("done");
    prog.classList.toggle("has-fails", failed.length > 0);
    _bulkProgHide = setTimeout(() => { prog.classList.remove("show"); fill.style.width = "0"; }, previewMotionOK() ? 600 : 0);
    badge.textContent = `Added ${ok} of ${skus.length}`;
    badge.classList.toggle("ok", ok > 0 && !failed.length);
    if (ok) ta.value = "";
    renderBulkReport(failed, needsNow);
    } finally {
      btn.disabled = false;
      btn.classList.remove("busy");
      btn.textContent = idle;
    }
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
      `⚠ ${needsNow.length} This Unit Only Clearance sign${needsNow.length === 1 ? "" : "s"} added without a Now price — click them in the queue to set it.`));
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
  $("#setSyncOn").checked = !!s.syncOn;
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
      syncOn: $("#setSyncOn").checked,
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
    Sync.start(); // pick up sync setting changes immediately
    renderQueue();
    showToast("Settings saved.", { kind: "ok" });
  };
}

/* ---------------- backup export / import ----------------
   Everything worth keeping — queue, batches, history, settings — to a
   plain JSON file and back. The sync token lives only inside the exe, so
   it is never in a backup; an old backup that still carries a pasted
   token from pre-3.12.2 has it dropped on import. */
function buildBackupJSON() {
  const settings = Object.assign({}, Settings.get());
  return JSON.stringify({
    app: "AceSignStudio",
    backupVersion: 1,
    appVersion: window.__appVersion || "",
    exportedAt: new Date().toISOString(),
    settings,
    queue: Queue.items,
    batches: Batches.data,
    history: History.data,
    favorites: Favorites.data,
  });
}

function exportBackup() {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([buildBackupJSON()], { type: "application/json" }));
  a.download = `ace-sign-studio-backup-${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  showToast("Backup exported.", { kind: "ok" });
}

/* Returns an error string, or null on success (with an undo toast). */
function applyBackup(data) {
  if (!data || typeof data !== "object" || data.app !== "AceSignStudio") {
    return "that file isn't an Ace Sign Studio backup";
  }
  const prev = {
    settings: JSON.parse(JSON.stringify(Settings.data)),
    queue: Queue.items,
    batches: Batches.data,
    history: History.data,
    favorites: Favorites.data,
  };
  if (data.settings && typeof data.settings === "object") {
    Object.assign(Settings.data, data.settings);
    delete Settings.data.syncToken; // pre-3.12.2 backups may carry these
    delete Settings.data.syncRepo;
  }
  Batches.data = data.batches && typeof data.batches === "object" ? data.batches : {};
  History.data = Array.isArray(data.history) ? data.history : [];
  // older backups have no favorites: keep this computer's rather than wipe them
  if (data.favorites && typeof data.favorites === "object") Favorites.data = data.favorites;
  Queue.replaceAll(Array.isArray(data.queue) ? data.queue : []); // persists + re-renders
  Sync.start();
  showToast(`Backup restored${data.exportedAt ? ` (saved ${fmtBatchDate(data.exportedAt)})` : ""} — queue, batches, history & settings replaced.`, {
    undo: () => {
      Object.assign(Settings.data, prev.settings);
      Batches.data = prev.batches;
      History.data = prev.history;
      Favorites.data = prev.favorites;
      Queue.replaceAll(prev.queue);
      Sync.start();
    },
  });
  return null;
}

function initBackup() {
  $("#backupExportBtn").onclick = exportBackup;
  $("#backupImportBtn").onclick = () => $("#backupFile").click();
  $("#backupFile").onchange = () => {
    const f = $("#backupFile").files && $("#backupFile").files[0];
    $("#backupFile").value = "";
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      let err;
      try { err = applyBackup(JSON.parse(r.result)); }
      catch (e) { err = "couldn't read that file as JSON"; }
      if (err) showToast(`Import failed — ${err}.`, { kind: "warn" });
      else $("#settingsModal").classList.remove("show");
    };
    r.readAsText(f);
  };
}

/* Settings → Updates: on-demand update check + the version history. */
function initSettingsUpdates() {
  const status = $("#settingsUpdateStatus");
  const btn = $("#settingsUpdateBtn");
  if (!status || !btn) return;
  status.classList.remove("ok");
  status.textContent = window.__appVersion ? `You have v${window.__appVersion}.` : "";
  btn.disabled = false;
  btn.onclick = async () => {
    btn.disabled = true;
    status.classList.remove("ok");
    status.innerHTML = '<span class="spin"></span> Checking…';
    try {
      const st = await fetch("/api/update/check", { cache: "no-store" }).then((r) => r.json());
      if (st.available) {
        status.textContent = `v${st.latest} is available — close Settings and use the “${st.canApply ? "Update & Restart" : "Download"}” banner at the top.`;
      } else if (st.error) {
        status.textContent = `Couldn't check for updates: ${st.error}. Are you online?`;
      } else {
        status.textContent = `✓ You're up to date — v${st.current} is the latest.`;
        status.classList.add("ok");
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
