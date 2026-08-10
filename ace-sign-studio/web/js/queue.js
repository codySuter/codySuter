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
    batchPriceCheck: true,    // launch scan: saved batches vs current store prices
    syncOn: false,            // share batches & history with the store's other computers
    syncOfferDismissed: false, // the "turn on sync?" launch banner was declined on this PC
    syncRepo: "codysuter/ace-sign-sync", // private GitHub repo holding the sync data
    syncToken: "",            // token override — blank uses the token built into release builds
    syncName: "",             // this computer's name, shown on synced history
    sizePresets: {},          // named Element-sizes slider layouts, {name: scaleMap}
  },
  get() { return this.data; },
  set(patch) { Object.assign(this.data, patch); persistState(); },
};

function clampCopies(n) {
  return Math.max(1, Math.min(99, parseInt(n, 10) || 1));
}

const Queue = {
  items: [], // {uid, typeId, sizeId, spec (raw, incl. hide), copies, _rev}
  _gen: 0,   // bumps on every mutation — lets undo closures detect divergence
  _uid() { return Date.now() + "-" + Math.random().toString(36).slice(2, 7); },
  _touch() {
    this._gen++;
    persistState();
    renderQueue();
  },
  /* Bump when an item's *appearance* changes, so the rendered-SVG cache
     knows to drop it. Copy count and row order don't change the artwork. */
  _bumpRev(q) { if (q) q._rev = (q._rev || 0) + 1; },
  add(typeId, sizeId, spec, copies) {
    this.items.push({ uid: this._uid(), typeId, sizeId, spec: JSON.parse(JSON.stringify(spec)), copies: clampCopies(copies), _rev: 0 });
    this._touch();
  },
  update(uid, typeId, sizeId, spec) {
    const q = this.items.find((x) => x.uid === uid);
    if (!q) return false;
    q.typeId = typeId;
    q.sizeId = sizeId;
    q.spec = JSON.parse(JSON.stringify(spec));
    this._bumpRev(q);
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
  /* Drop a row at an absolute position (drag-and-drop reorder). */
  moveTo(uid, index) {
    const i = this.items.findIndex((q) => q.uid === uid);
    if (i < 0) return;
    const [it] = this.items.splice(i, 1);
    this.items.splice(Math.max(0, Math.min(index, this.items.length)), 0, it);
    this._touch();
  },
  replaceAll(items) {
    this.items = JSON.parse(JSON.stringify(items || []));
    this.items.forEach((q) => { if (!q.copies) q.copies = 1; });
    this._touch();
  },
  totalSigns() { return this.items.reduce((a, q) => a + (q.copies || 1), 0); },
  packable(items) {
    const out = [];
    for (const q of items || this.items) {
      for (let i = 0; i < (q.copies || 1); i++) {
        out.push({ uid: q.uid + ":" + i, size: sizeOfQueueItem(q), q });
      }
    }
    return out;
  },
};

/* Named batches: snapshots of the whole queue, saved under a name.
   Deleting keeps a tombstone ({deletedAt}, no items) instead of removing
   the key — without one, multi-PC sync would resurrect every deleted
   batch from the other computers' copies. Tombstones are pruned after
   60 days (restoreState). */
const Batches = {
  data: {}, // name -> {items, savedAt} | {deletedAt}
  names() {
    return Object.keys(this.data)
      .filter((n) => this.data[n] && this.data[n].items)
      .sort((a, b) => String(this.data[b].savedAt || "").localeCompare(String(this.data[a].savedAt || "")));
  },
  save(name) {
    // Full save: wholesale-authoritative in the sync merge. Stamping every
    // item's addedAt to the savedAt means none of them can be "rescued"
    // into a copy that a later full save deliberately replaced.
    const at = new Date().toISOString();
    const items = JSON.parse(JSON.stringify(Queue.items));
    items.forEach((q) => { q.addedAt = at; });
    this.data[name] = { items, savedAt: at };
    persistState();
  },
  remove(name) {
    this.data[name] = { deletedAt: new Date().toISOString() };
    persistState();
  },
  /* Append signs (queue rows, copies included) to an existing batch.
     Fresh uids so the batch copies diverge cleanly from the live queue
     rows (and from re-adding the same sign later). Appends deliberately do
     NOT bump savedAt: they travel through sync via their addedAt stamps
     (mergeSyncDoc rescues appends newer than the winning side's last full
     save), so two computers appending to the same batch in the same sync
     window both keep their signs instead of newest-savedAt silently
     dropping one side's. */
  addItems(name, items) {
    const b = this.data[name];
    if (!b || !b.items || !items || !items.length) return false;
    const at = new Date().toISOString();
    const copies = JSON.parse(JSON.stringify(items));
    copies.forEach((q) => { q.uid = Queue._uid(); q.addedAt = at; });
    b.items = b.items.concat(copies);
    persistState();
    return true;
  },
};

/* Print history: a snapshot of every Print All / Save PDF / single-sign
   print, newest first, capped. Restoring puts the exact set back in the
   queue — items keep their uid+rev, so unchanged signs reuse their
   cached SVG correctly. */
const History = {
  data: [], // {at, kind: "print"|"pdf", signs, items}
  MAX: 25,
  record(kind, items) {
    const snap = JSON.parse(JSON.stringify(items || []));
    if (!snap.length) return;
    this.data.unshift({
      uid: "h-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8), // sync dedupe key
      at: new Date().toISOString(),
      kind,
      signs: snap.reduce((a, q) => a + (q.copies || 1), 0),
      items: snap,
      by: String(Settings.get().syncName || "").trim() || undefined, // which computer printed it
    });
    if (this.data.length > this.MAX) this.data.length = this.MAX;
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
   registered size, including the pallet cut guide when it has one.

   Memoized per uid+revision: a single queue render asks for the same item's
   SVG once per thumbnail and again for every placement on every sheet
   preview (a ×12 sign appears 12 times), and each render re-measures text
   and re-inlines the product photo. The cache key includes the settings
   that affect artwork, so toggling them invalidates correctly. */
const _itemSVGCache = new Map();
// The floor covers small queues; sizing to the live queue matters past ~80
// items — a fixed cap smaller than the queue thrashes on every sequential
// render pass (item 1 evicted by the time the pass wraps), turning each
// copies-click into a full re-render of every thumbnail.
function _itemSVGCacheMax() { return Math.max(80, Queue.items.length + 16); }
function _itemSVGKey(q) {
  const s = Settings.get();
  return `${q.uid}|${q._rev || 0}|${q.typeId}|${q.sizeId}|${s.printStoreLine ? s.storeLine : ""}`;
}
async function renderQueueItemSVG(qOrItem) {
  const q = qOrItem.q || qOrItem;
  const key = q.uid ? _itemSVGKey(q) : null;
  if (key && _itemSVGCache.has(key)) return _cacheTouch(_itemSVGCache, key, _itemSVGCacheMax());
  const spec = Object.assign({}, q.spec);
  const hide = spec.hide;
  delete spec.hide;
  applyHiddenFields(spec, hide);
  if (Settings.get().printStoreLine) spec.storeLine = Settings.get().storeLine;
  const p = renderSignSVG(q.typeId, spec, q.sizeId);
  if (key) {
    _itemSVGCache.set(key, p);
    while (_itemSVGCache.size > _itemSVGCacheMax()) _itemSVGCache.delete(_itemSVGCache.keys().next().value);
    p.catch(() => _itemSVGCache.delete(key)); // a failed render must not stick
  }
  return p;
}

/* ---------- persistence ---------- */
let _persistTimer = null;
function stateJSON() {
  return JSON.stringify({
    settings: Settings.data,
    queue: Queue.items,
    batches: Batches.data,
    history: History.data,
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
  // local changes should reach the other store computers soon, not on the
  // next 20s poll (no-op when sync is off; converges to no writes)
  if (typeof Sync !== "undefined") Sync.request();
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
    // 3.0.0 installs saved syncRepo:"" before the default existed — an
    // empty repo means "use the store default"
    if (!String(Settings.data.syncRepo || "").trim()) Settings.data.syncRepo = "codysuter/ace-sign-sync";
    // pre-3.1 sync was "on" purely by having a token pasted — carry that over
    if (state.settings && state.settings.syncOn == null && String(Settings.data.syncToken || "").trim()) {
      Settings.data.syncOn = true;
    }
    if (Array.isArray(state.queue)) Queue.items = state.queue;
    if (state.batches && typeof state.batches === "object") Batches.data = state.batches;
    if (Array.isArray(state.history)) History.data = state.history;
  }
  // sync migrations: pre-3.0 history rows have no uid (the sync dedupe
  // key), and batch tombstones only matter for 60 days
  History.data.forEach((h) => {
    if (h && !h.uid) h.uid = "h-" + (Date.parse(h.at) || 0) + "-" + Math.random().toString(36).slice(2, 8);
  });
  const tombCutoff = Date.now() - 60 * 86400000;
  for (const n of Object.keys(Batches.data)) {
    const b = Batches.data[n];
    if (b && !b.items && (Date.parse(b.deletedAt || 0) || 0) < tombCutoff) delete Batches.data[n];
  }
  // drop queue entries whose sign type isn't registered
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
