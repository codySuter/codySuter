/* ============================================================
   Ace Location Studio — the saved document (state.json via /api/state).

   { version, settings: { storeLine, exportDir, watchOn, watchDir }, exports: [...], plans: {...} }

   exports is a short log of the files saved, newest first (kind "clear"
   for Clear Locations, "plan" for New Planogram), so there's a record of
   what was saved and when. plans remembers each planogram's section
   locations and facing changes by POG ID. Saves are
   serialized and retried, and a failure is shown on screen.
   ============================================================ */
"use strict";

const MAX_EXPORT_LOG = 50;

function defaultSettings() {
  return {
    storeLine: "Snyder's Ace Hardware · Media, PA",
    exportDir: "", // "" = the default, C:\3apps\Temp
    watchOn: true, // load the newest Compass export from watchDir by itself
    watchDir: "",  // "" = the default, %USERPROFILE%\Cody's Apps\Epicor Exports
    compassExe: "", // "" = the default Compass (Conductor.exe) path
  };
}

const Store = {
  doc: { version: 1, settings: defaultSettings(), exports: [], plans: {} },
  loaded: false,
  _chain: Promise.resolve(),

  get settings() { return this.doc.settings; },
  get exports() { return this.doc.exports; },

  /** The folder Compass saves its scheduled exports to. */
  watchDir() { return (this.settings.watchDir || "").trim() || window.__defaultWatchDir || ""; },

  /** The Compass program "Get fresh data from Compass" starts. */
  compassExe() { return (this.settings.compassExe || "").trim() || window.__defaultCompassExe || ""; },

  /** The folder import files are saved to. */
  exportDir() { return (this.settings.exportDir || "").trim() || window.__defaultExportDir || "C:\\3apps\\Temp"; },

  async load() {
    let data = {};
    try {
      data = await fetch("/api/state", { cache: "no-store" }).then((r) => r.json());
    } catch (e) {
      showToast("Couldn't load saved settings — " + esc(friendlyError(e)), { kind: "error", ms: 8000 });
    }
    this.doc = normalizeDoc(data);
    this.loaded = true;
  },

  logExport(entry) {
    this.doc.exports.unshift(Object.assign({ id: uid(), ts: Date.now() }, entry));
    this.doc.exports.length = Math.min(this.doc.exports.length, MAX_EXPORT_LOG);
    return this.save();
  },

  /** Persist the whole document. Resolves true on success. With
   *  { keepalive: true } the request outlives the page — for saving as the
   *  window closes or reloads. */
  save(opts) {
    const body = JSON.stringify(this.doc);
    const keepalive = !!(opts && opts.keepalive) && body.length < 60000; // browsers cap keepalive bodies at 64 KB
    if (keepalive) {
      try { fetch("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }); } catch (e) { /* page is going away */ }
      return Promise.resolve(true);
    }
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
    return p;
  },
};

function setSaveState(s) {
  const bar = $("#saveBar");
  if (!bar) return;
  bar.classList.toggle("show", s === "error");
}

/* Fill in anything missing so older / hand-edited files still load. */
function normalizeDoc(data) {
  const d = data && typeof data === "object" ? data : {};
  const s = Object.assign({}, defaultSettings(), d.settings || {});
  if (typeof s.exportDir !== "string") s.exportDir = "";
  if (typeof s.storeLine !== "string") s.storeLine = defaultSettings().storeLine;
  if (typeof s.watchDir !== "string") s.watchDir = "";
  if (typeof s.watchOn !== "boolean") s.watchOn = true;
  if (typeof s.compassExe !== "string") s.compassExe = "";
  return {
    version: 1,
    settings: s,
    exports: Array.isArray(d.exports) ? d.exports.filter((x) => x && x.id && x.file).slice(0, MAX_EXPORT_LOG) : [],
    plans: d.plans && typeof d.plans === "object" && !Array.isArray(d.plans) ? d.plans : {},
    compass: d.compass && typeof d.compass === "object" ? d.compass : null, // last connection test (no secrets)
  };
}
