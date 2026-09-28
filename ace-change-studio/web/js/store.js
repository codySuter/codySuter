/* ============================================================
   Ace Change Studio — the saved document (state.json via /api/state).

   { version, settings, counts: [...], boxLogs: [...] }

   Saves are serialized and retried, and a failure is shown on screen:
   a count that silently didn't save would be worse than an error.
   ============================================================ */
"use strict";

const DEFAULT_DRAWERS = [
  { id: "up1", name: "Upstairs 1", area: "Upstairs", note: "Main register", start: 15000 },
  { id: "up2", name: "Upstairs 2", area: "Upstairs", note: "", start: 15000 },
  { id: "up3", name: "Upstairs 3", area: "Upstairs", note: "", start: 15000 },
  { id: "dn1", name: "Downstairs 1", area: "Downstairs", note: "", start: 15000 },
  { id: "dn2", name: "Downstairs 2", area: "Downstairs", note: "", start: 15000 },
  { id: "swap", name: "Swap drawer", area: "Upstairs", note: "Mid-shift swap for Upstairs 1", start: 15000 },
];

function defaultSettings() {
  return {
    storeLine: "Snyder's Ace Hardware · Media, PA",
    drawers: JSON.parse(JSON.stringify(DEFAULT_DRAWERS)),
    reset: Object.assign({}, Cash.DEFAULT_RESET),
    people: [],
    flags: { green: 100, yellow: 500 }, // cents
    ideal: Object.assign({}, Cash.DEFAULT_IDEAL),
    billRound: 50,
    excessThreshold: 25,
  };
}

const Store = {
  doc: { version: 1, settings: defaultSettings(), counts: [], boxLogs: [] },
  loaded: false,
  _chain: Promise.resolve(),
  _listeners: [],

  get settings() { return this.doc.settings; },
  get counts() { return this.doc.counts; },
  get boxLogs() { return this.doc.boxLogs; },

  async load() {
    let data = {};
    try {
      data = await fetch("/api/state", { cache: "no-store" }).then((r) => r.json());
    } catch (e) {
      showToast("Couldn't load saved data — " + esc(friendlyError(e)), { kind: "error", ms: 8000 });
    }
    this.doc = normalizeDoc(data);
    this.loaded = true;
  },

  /** Persist the whole document. Resolves true on success. */
  save() {
    const body = JSON.stringify(this.doc);
    const run = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fetch("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body });
          if (r.ok) { setSaveState("ok"); return true; }
        } catch (e) { /* retry */ }
        await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
      }
      setSaveState("error");
      return false;
    };
    const p = this._chain.then(run, run);
    this._chain = p;
    this._listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
    return p;
  },

  onChange(fn) { this._listeners.push(fn); },

  drawer(id) { return this.settings.drawers.find((d) => d.id === id); },
};

function setSaveState(s) {
  const bar = $("#saveBar");
  if (!bar) return;
  bar.classList.toggle("show", s === "error");
}

/* Fill in anything missing so older / hand-edited files still load. */
function normalizeDoc(data) {
  const d = data && typeof data === "object" ? data : {};
  const def = defaultSettings();
  const s = Object.assign({}, def, d.settings || {});
  s.flags = Object.assign({}, def.flags, s.flags || {});
  s.ideal = Object.assign({}, def.ideal, s.ideal || {});
  s.reset = s.reset && typeof s.reset === "object" ? s.reset : def.reset;
  s.people = Array.isArray(s.people) ? s.people.filter((p) => typeof p === "string" && p.trim()) : [];
  s.drawers = Array.isArray(s.drawers) && s.drawers.length ? s.drawers.map((x) => Object.assign({ area: "", note: "", start: 15000 }, x)) : def.drawers;
  return {
    version: 1,
    settings: s,
    counts: Array.isArray(d.counts) ? d.counts.filter((c) => c && c.id) : [],
    boxLogs: Array.isArray(d.boxLogs) ? d.boxLogs.filter((c) => c && c.id) : [],
  };
}
