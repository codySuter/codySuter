/* ============================================================
   Sign queue + settings, persisted server-side (survives restarts,
   port changes, and browser cache clears) with localStorage fallback.
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
  },
  get() { return this.data; },
  set(patch) { Object.assign(this.data, patch); persistState(); },
};

const Queue = {
  items: [], // {uid, typeId, sizeId, spec}
  add(typeId, sizeId, spec) {
    this.items.push({ uid: Date.now() + "-" + Math.random().toString(36).slice(2, 7), typeId, sizeId, spec: JSON.parse(JSON.stringify(spec)) });
    persistState();
    renderQueue();
  },
  remove(uid) {
    this.items = this.items.filter((q) => q.uid !== uid);
    persistState();
    renderQueue();
  },
  duplicate(uid) {
    const i = this.items.findIndex((q) => q.uid === uid);
    if (i === -1) return;
    const copy = JSON.parse(JSON.stringify(this.items[i]));
    copy.uid = Date.now() + "-" + Math.random().toString(36).slice(2, 7);
    this.items.splice(i + 1, 0, copy);
    persistState();
    renderQueue();
  },
  clear() {
    this.items = [];
    persistState();
    renderQueue();
  },
  packable() {
    return this.items.map((q) => ({ uid: q.uid, size: sizeOfQueueItem(q), q }));
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
   and PDF). Renders at the item's registered size, including the pallet
   cut guide when the size carries one. */
async function renderQueueItemSVG(qOrItem) {
  const q = qOrItem.q || qOrItem;
  const spec = Object.assign({}, q.spec);
  if (Settings.get().printStoreLine) spec.storeLine = Settings.get().storeLine;
  return renderSignSVG(q.typeId, spec, q.sizeId);
}

/* ---------- persistence ---------- */
let _persistTimer = null;
function persistState() {
  clearTimeout(_persistTimer);
  _persistTimer = setTimeout(async () => {
    const state = {
      settings: Settings.data,
      queue: Queue.items,
      stihl: typeof StihlData !== "undefined" ? { overrides: StihlData.overrides, meta: StihlData.meta, dataset: StihlData.meta.source === "import" ? StihlData.data : null } : undefined,
    };
    const json = JSON.stringify(state);
    try { localStorage.setItem("acesignstudio.state.v1", json); } catch (e) {}
    try {
      await fetch("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: json });
    } catch (e) {}
  }, 400);
}

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
    if (typeof StihlData !== "undefined") StihlData.init(state.stihl || null);
  } else if (typeof StihlData !== "undefined") {
    StihlData.init(null);
  }
  // drop queue entries whose sign type isn't registered (e.g. STIHL, disabled for now)
  Queue.items = Queue.items.filter((q) => typeById(q.typeId));
}
