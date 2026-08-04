/* ============================================================
   Sign queue + settings + saved batches, persisted server-side
   (survives restarts, port changes, and browser cache clears)
   with localStorage fallback.

   Queue items keep the raw editor spec — including the `hide`
   toggle map — so a queued sign can be reopened and edited.
   Hides are applied at render time, never destructively.
   ============================================================ */
"use strict";

const Settings = {
  data: {
    storeCode: "12180",
    storeLine: "Snyder's Ace Hardware · Media, PA",
    printStoreLine: false,
    cutGuides: true,
    margin: 0.375,
    templateSku: "81995",
    keepScaleOnLookup: false, // keep Element sizes sliders when a new SKU's lookup lands
  },
  get() { return this.data; },
  set(patch) { Object.assign(this.data, patch); persistState(); },
};

function clampCopies(n) {
  return Math.max(1, Math.min(99, parseInt(n, 10) || 1));
}

const Queue = {
  items: [], // {uid, typeId, sizeId, spec (raw, incl. hide), copies}
  _gen: 0,   // bumps on every mutation — lets undo closures detect divergence
  _uid() { return Date.now() + "-" + Math.random().toString(36).slice(2, 7); },
  _touch() {
    this._gen++;
    persistState();
    renderQueue();
  },
  add(typeId, sizeId, spec, copies) {
    this.items.push({ uid: this._uid(), typeId, sizeId, spec: JSON.parse(JSON.stringify(spec)), copies: clampCopies(copies) });
    this._touch();
  },
  update(uid, typeId, sizeId, spec) {
    const q = this.items.find((x) => x.uid === uid);
    if (!q) return false;
    q.typeId = typeId;
    q.sizeId = sizeId;
    q.spec = JSON.parse(JSON.stringify(spec));
    this._touch();
    return true;
  },
  remove(uid) {
    const i = this.items.findIndex((q) => q.uid === uid);
    if (i === -1) return null;
    const [item] = this.items.splice(i, 1);
    this._touch();
    return { item, index: i };
  },
  restore(item, index) {
    this.items.splice(Math.min(index, this.items.length), 0, item);
    this._touch();
  },
  duplicate(uid) {
    const i = this.items.findIndex((q) => q.uid === uid);
    if (i === -1) return;
    const copy = JSON.parse(JSON.stringify(this.items[i]));
    copy.uid = this._uid();
    this.items.splice(i + 1, 0, copy);
    this._touch();
  },
  setCopies(uid, n) {
    const q = this.items.find((x) => x.uid === uid);
    if (!q) return;
    q.copies = clampCopies(n);
    this._touch();
  },
  move(uid, dir) {
    const i = this.items.findIndex((q) => q.uid === uid);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= this.items.length) return;
    const [it] = this.items.splice(i, 1);
    this.items.splice(j, 0, it);
    this._touch();
  },
  clear() {
    const snap = this.items;
    this.items = [];
    this._touch();
    return snap;
  },
  replaceAll(items) {
    this.items = JSON.parse(JSON.stringify(items || []));
    this.items.forEach((q) => { if (!q.copies) q.copies = 1; });
    this._touch();
  },
  totalSigns() { return this.items.reduce((a, q) => a + (q.copies || 1), 0); },
  packable() {
    const out = [];
    for (const q of this.items) {
      for (let i = 0; i < (q.copies || 1); i++) {
        out.push({ uid: q.uid + ":" + i, size: sizeOfQueueItem(q), q });
      }
    }
    return out;
  },
};

/* Named batches: snapshots of the whole queue, saved under a name. */
const Batches = {
  data: {}, // name -> {items, savedAt}
  names() {
    return Object.keys(this.data).sort((a, b) =>
      String(this.data[b].savedAt || "").localeCompare(String(this.data[a].savedAt || "")));
  },
  save(name) {
    this.data[name] = { items: JSON.parse(JSON.stringify(Queue.items)), savedAt: new Date().toISOString() };
    persistState();
  },
  remove(name) {
    delete this.data[name];
    persistState();
  },
};

function sizeOfQueueItem(q) {
  const s = sizeById(q.sizeId);
  return { w: s.w, h: s.h };
}

function queueItemTitle(q) {
  const t = typeById(q.typeId);
  return q.spec.name || q.spec.category || (t ? t.label : q.typeId);
}

/* Render a queue item's sign SVG (used by thumbnails, sheet composer,
   and PDF). The stored spec is raw — per-field hides are applied here,
   on a copy, so the item stays editable. Renders at the item's
   registered size, including the pallet cut guide when it has one. */
async function renderQueueItemSVG(qOrItem) {
  const q = qOrItem.q || qOrItem;
  const spec = Object.assign({}, q.spec);
  const hide = spec.hide;
  delete spec.hide;
  applyHiddenFields(spec, hide);
  if (Settings.get().printStoreLine) spec.storeLine = Settings.get().storeLine;
  return renderSignSVG(q.typeId, spec, q.sizeId);
}

/* ---------- persistence ---------- */
let _persistTimer = null;
function stateJSON() {
  return JSON.stringify({
    settings: Settings.data,
    queue: Queue.items,
    batches: Batches.data,
    stihl: typeof StihlData !== "undefined" ? { overrides: StihlData.overrides, meta: StihlData.meta, dataset: StihlData.meta.source === "import" ? StihlData.data : null } : undefined,
  });
}
function persistState() {
  clearTimeout(_persistTimer);
  _persistTimer = setTimeout(async () => {
    _persistTimer = null;
    const json = stateJSON();
    try { localStorage.setItem("acesignstudio.state.v1", json); } catch (e) {}
    try {
      await fetch("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: json });
    } catch (e) {}
  }, 400);
}

/* The debounce loses the last mutation if the window closes inside the
   400 ms window — flush synchronously on pagehide (sendBeacon survives
   page teardown; the Blob type satisfies the server's JSON check). */
window.addEventListener("pagehide", () => {
  if (_persistTimer == null) return;
  clearTimeout(_persistTimer);
  _persistTimer = null;
  const json = stateJSON();
  try { localStorage.setItem("acesignstudio.state.v1", json); } catch (e) {}
  try { navigator.sendBeacon("/api/state", new Blob([json], { type: "application/json" })); } catch (e) {}
});

async function restoreState() {
  let state = null;
  try {
    const resp = await fetch("/api/state");
    if (resp.ok) state = await resp.json();
  } catch (e) {}
  if (!state || (!state.settings && !state.queue)) {
    try { state = JSON.parse(localStorage.getItem("acesignstudio.state.v1") || "null"); } catch (e) {}
  }
  if (state) {
    if (state.settings) Object.assign(Settings.data, state.settings);
    if (Array.isArray(state.queue)) Queue.items = state.queue;
    if (state.batches && typeof state.batches === "object") Batches.data = state.batches;
    if (typeof StihlData !== "undefined") StihlData.init(state.stihl || null);
  } else if (typeof StihlData !== "undefined") {
    StihlData.init(null);
  }
  // drop queue entries whose sign type isn't registered (e.g. STIHL, disabled for now)
  Queue.items = Queue.items.filter((q) => typeById(q.typeId));
  // migrate pre-2.1 items: no copies counter, and hides applied
  // destructively (blanked fields / showLogo:false with no hide map) —
  // reconstruct the hide map so the sign is editable and the toggle
  // chips report the truth
  Queue.items.forEach((q) => {
    if (!q.copies) q.copies = 1;
    const spec = q.spec || (q.spec = {});
    if (!spec.hide) {
      spec.hide = {};
      const t = typeById(q.typeId);
      for (const k of (t && t.hideable) || []) {
        if (k === "logo") { if (spec.showLogo === false) spec.hide.logo = true; }
        else if (k === "image") { if (spec.image == null) spec.hide.image = true; }
        else if (!String(spec[k] == null ? "" : spec[k]).trim()) spec.hide[k] = true;
      }
    } else if (spec.showLogo === false) {
      spec.hide.logo = true;
    }
    delete spec.showLogo;
  });
}
