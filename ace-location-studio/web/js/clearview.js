/* ============================================================
   Ace Location Studio — Clear Locations view.

   1. Load the location data: the newest Compass export from the watched
      folder loads by itself (and again when Compass saves a newer one),
      or drop an Eagle / Compass export (the backend reads the file).
   2. Type the location codes being reset.
   3. Check the preview, then save the import file into the export
      folder (C:\3apps\Temp) for Eagle to pick up.
   The clearing rules themselves live in clear.js.
   ============================================================ */
"use strict";

const PREVIEW_LIMIT = 1000; // rows drawn at once; the file itself has them all
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.,()&+#-]{0,150}\.csv$/;
const WATCH_POLL_MS = 60000;           // look for a newer Compass export every minute
const STALE_MS = 60 * 60000;           // warn when the loaded export is over an hour old
const FRESH_POLL_MS = 4000;            // after starting Compass, look for its export this often…
const FRESH_WAIT_MS = 10 * 60000;      // …for up to 10 minutes (time to log in to Compass)

const ClearView = {
  file: null,        // parsed Eagle file from /api/parse or /api/watch/load
  source: null,      // { kind: "watch", dir, name, modified } or { kind: "manual", loadedAt }
  watch: null,       // the watched folder's last status from /api/watch
  newer: null,       // a newer export waiting to be loaded (not loaded because codes are in use)
  watchBusy: false,
  watchError: "",
  awaiting: 0,       // when "Get fresh data from Compass" started it (ms), while waiting for its export
  launching: "",     // "Starting Compass…" while the request runs
  launchError: "",
  launchNote: "",    // shown after waiting ran out
  fileError: "",
  loading: "",
  codes: [],
  slotsByCode: {},   // { "12R": [0, 3, 4, 5] } — which locations each code clears (default 1, 4, 5, 6)
  plan: null,
  customName: null,  // set when the file name was edited by hand
  saved: null,       // { path, skus, cells } after a save
  saveError: "",
  saving: false,
  mode: "import",    // preview: "import" rows or "all" SKUs
  filter: "",

  init() {
    const v = $("#view-clear");
    v.innerHTML = `
      <div class="view-head">
        <div>
          <h2>Clear Locations</h2>
          <p>The newest Compass export loads by itself (or drop an Eagle export). Type the codes being reset, check the preview, and save the import file for Eagle.</p>
        </div>
      </div>
      <div class="clear-layout">
        <div class="side">
          <div class="card step" id="stepFile"></div>
          <div class="card step" id="stepCodes"></div>
          <div class="card step" id="stepSave"></div>
        </div>
        <div class="main">
          <div class="card" id="previewCard"></div>
          <div class="card" id="logCard"></div>
        </div>
      </div>
      <input type="file" id="fileInput" accept=".xls,.xlsx,.csv,application/vnd.ms-excel" hidden>
      <div class="drop-overlay" id="dropOverlay"><div>${icon("upload")}<b id="dropText">Drop the file to load it</b></div></div>`;

    $("#fileInput").onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (f) this.loadFile(f);
    };
    this.wireDragDrop();
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && App.view === "clear") {
        e.preventDefault();
        if (this.canSave()) this.save(false);
      }
    });
    this.refresh();
    this.checkWatch();
    setInterval(() => this.checkWatch(), WATCH_POLL_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) this.checkWatch(); });
  },

  refresh() {
    this.plan = this.file && this.codes.length ? Clear.planClear(this.file.rows, this.codes, this.slotsByCode) : null;
    this.renderFile();
    this.renderCodes();
    this.renderSave();
    this.renderPreview();
    this.renderLog();
  },

  /* ---------------- step 1: the file ---------------- */

  wireDragDrop() {
    const ov = $("#dropOverlay");
    let depth = 0;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
    document.addEventListener("dragenter", (e) => {
      if (!hasFiles(e) || (App.view !== "clear" && App.view !== "plan")) return;
      $("#dropText").textContent = App.view === "plan" ? "Drop the planogram PDF to load it" : "Drop the export to load it";
      depth++;
      ov.classList.add("show");
    });
    document.addEventListener("dragleave", () => {
      depth = Math.max(0, depth - 1);
      if (!depth) ov.classList.remove("show");
    });
    document.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
    document.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      ov.classList.remove("show");
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      if (App.view === "clear") this.loadFile(f);
      else if (App.view === "plan") PlanView.loadFile(f);
    });
  },

  async loadFile(f) {
    this.loading = f.name;
    this.fileError = "";
    this.renderFile();
    try {
      const r = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(f.name) },
        body: f,
      });
      const data = await r.json().catch(() => ({ error: `the app answered ${r.status}` }));
      if (!r.ok || data.error) throw new Error(data.error || `the app answered ${r.status}`);
      this.file = data;
      this.source = { kind: "manual", loadedAt: Date.now() };
      this.newer = null;
      this.saved = null;
      this.saveError = "";
      showToast(`${icon("check")} Loaded ${esc(f.name)} — ${data.rows.length.toLocaleString()} SKUs`, { kind: "good" });
    } catch (e) {
      this.fileError = friendlyError(e);
    } finally {
      this.loading = "";
      this.refresh();
    }
  },

  /* The Compass export folder: Compass saves a fresh export on a schedule;
     the newest one loads by itself. A newer one replaces the loaded data
     straight away while no codes are typed; otherwise a banner offers it,
     so nothing changes under someone mid-way through. A file loaded by
     hand is never replaced by itself. */
  checkWatch() {
    // One check at a time (the tab, the timer and focus can all ask at once).
    if (!this._checking) this._checking = this._checkWatch().finally(() => { this._checking = null; });
    return this._checking;
  },

  async _checkWatch() {
    const dir = Store.watchDir();
    if (!Store.settings.watchOn || !dir) {
      if (this.watch || this.newer) { this.watch = null; this.newer = null; this.renderFile(); }
      return;
    }
    if (this.watchBusy || this.loading) return;
    let st;
    try {
      st = await fetch("/api/watch?dir=" + encodeURIComponent(dir), { cache: "no-store" }).then((r) => r.json());
    } catch (e) { return; }
    if (dir !== Store.watchDir()) return; // the folder changed meanwhile
    this.watch = st;
    const f = st.file;
    if (f && f.writing) {
      clearTimeout(this._settle);
      this._settle = setTimeout(() => this.checkWatch(), 6000); // still being saved
    } else if (f) {
      const src = this.source;
      if (this.awaiting && f.modified >= this.awaiting - 2000 && !(src && src.kind === "watch" && src.name === f.name && src.modified === f.modified)) {
        this.stopAwaiting();
        return this.loadWatch(f); // asked for: load it even with codes typed (they stay)
      }
      if (!this.file) return this.loadWatch(f);
      if (src && src.kind === "watch") {
        const isNew = src.dir !== dir || f.name !== src.name || f.modified > src.modified;
        if (isNew && !this.codes.length && !this.saving) return this.loadWatch(f);
        this.newer = isNew ? f : null;
      } else if (src && src.kind === "manual") {
        this.newer = f.modified > src.loadedAt ? f : null;
      }
    } else {
      this.newer = null;
    }
    this.renderFile();
  },

  async loadWatch(f) {
    const dir = Store.watchDir();
    this.watchBusy = true;
    this.loading = f.name;
    this.renderFile();
    try {
      const r = await fetch("/api/watch/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir, name: f.name }),
      });
      const data = await r.json().catch(() => ({ error: `the app answered ${r.status}` }));
      if (!r.ok || data.error) throw new Error(data.error || `the app answered ${r.status}`);
      const replaced = !!this.file;
      this.file = data;
      this.source = { kind: "watch", dir, name: f.name, modified: data.modified };
      this.newer = null;
      this.launchNote = "";
      this.watchError = "";
      this.fileError = "";
      this.saved = null;
      this.saveError = "";
      showToast(`${icon("check")} ${replaced ? "Updated to" : "Loaded"} the Compass export from ${esc(whenText(data.modified))} — ${data.rows.length.toLocaleString()} SKUs`, { kind: "good" });
    } catch (e) {
      this.watchError = `${f.name}: ${friendlyError(e)}`;
    } finally {
      this.watchBusy = false;
      this.loading = "";
      this.refresh();
    }
  },

  /* "Get fresh data from Compass": start Compass, whose startup task saves
     an export, then watch the folder closely until it arrives. If Compass
     is already open, its startup task won't run again, so (after asking)
     it's closed politely — it can still ask about unsaved work — and
     started again. */
  async freshFromCompass() {
    const exe = Store.compassExe();
    this.launchError = "";
    this.launchNote = "";
    let st;
    try {
      st = await fetch("/api/compass/app?exe=" + encodeURIComponent(exe), { cache: "no-store" }).then((r) => r.json());
    } catch (e) { this.launchError = friendlyError(e); return this.renderFile(); }
    if (!st.found) { this.launchError = st.error || "Compass wasn't found."; return this.renderFile(); }
    let restart = false;
    if (st.running) {
      const yes = await confirmBox("Restart Compass?",
        "Compass is already open, so its startup export won't run again. The app will close Compass and start it again — if you're in the middle of something there, Compass asks about saving first.",
        { okText: "Restart Compass" });
      if (!yes) return;
      restart = true;
    }
    this.launching = restart ? "Closing Compass…" : "Starting Compass…";
    this.renderFile();
    try {
      const r = await fetch("/api/compass/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exe, restart }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || `the app answered ${r.status}`);
      this.awaiting = data.started || Date.now();
      clearInterval(this._fast);
      clearTimeout(this._fastEnd);
      this._fast = setInterval(() => this.checkWatch(), FRESH_POLL_MS);
      this._fastEnd = setTimeout(() => {
        this.stopAwaiting();
        this.launchNote = "No new export from Compass yet. Check you're logged in to Compass and that its startup task ran — the app keeps checking every minute.";
        this.renderFile();
      }, FRESH_WAIT_MS);
    } catch (e) {
      this.launchError = friendlyError(e);
    } finally {
      this.launching = "";
      this.renderFile();
    }
  },

  stopAwaiting() {
    this.awaiting = 0;
    clearInterval(this._fast);
    clearTimeout(this._fastEnd);
  },

  freshHtml() {
    if (!Store.settings.watchOn) return "";
    if (this.launching) return `<div class="notice info slim" id="freshNote"><div class="spinner sm"></div><span>${esc(this.launching)}</span></div>`;
    if (this.awaiting) {
      return `<div class="notice info slim" id="freshNote"><div class="spinner sm"></div><span><b>Waiting for Compass's export…</b> Log in to Compass if it asks — the new data loads here as soon as Compass saves it. <button class="link" id="freshStop">Stop waiting</button></span></div>`;
    }
    let out = `<button class="btn btn-secondary btn-sm fresh-btn" id="freshBtn" title="Starts Compass so its startup task saves a new export">${icon("refresh")} Get fresh data from Compass</button>`;
    if (this.launchError) out += `<div class="notice bad slim" id="freshError">${icon("x")}<span><b>Couldn't start Compass.</b> ${esc(this.launchError)}</span></div>`;
    if (this.launchNote) out += `<div class="notice warn slim" id="freshTimeout">${icon("alert")}<span>${esc(this.launchNote)}</span></div>`;
    return out;
  },

  renderFile() {
    const c = $("#stepFile");
    if (!c) return;
    const f = this.file;
    const src = this.source;
    const st = this.watch;
    let body;
    if (this.loading) {
      body = `<div class="file-row"><div class="spinner"></div><div><b>Reading ${esc(this.loading)}…</b></div></div>`;
    } else if (f) {
      const layout = { export: "Eagle location export", compass: "Compass export", import: "Eagle import layout" }[f.layout] || "Eagle import layout";
      const fromWatch = src && src.kind === "watch";
      const age = fromWatch ? Date.now() - src.modified : 0;
      body = `
        <div class="file-row">
          <span class="file-ico">${icon(fromWatch ? "refresh" : "sheet")}</span>
          <div class="file-meta">
            <b title="${esc(f.name)}">${esc(f.name)}</b>
            <span>${f.rows.length.toLocaleString()} SKUs${f.sheet ? " · " + esc(f.sheet) : ""} · ${layout}</span>
            ${fromWatch ? `<span class="fresh${age > STALE_MS ? " stale" : ""}" id="freshLine">Saved by Compass ${esc(whenText(src.modified))} (${esc(agoText(src.modified))})</span>` : ""}
          </div>
          <button class="btn btn-secondary" id="fileChange">Change file</button>
        </div>
        ${fromWatch && age > STALE_MS ? `<div class="notice warn slim" id="staleNote">${icon("alert")}<span><b>This export is ${esc(agoText(src.modified).replace(" ago", ""))} old.</b> Compass may have stopped saving new ones — check its scheduled task, or drop a fresh export here.</span></div>` : ""}
        ${this.newer ? `<div class="notice info slim" id="newerNote">${icon("refresh")}<span><b>Newer Compass data</b> from ${esc(whenText(this.newer.modified))}.${this.codes.length ? " Your codes stay; the preview updates." : ""} <button class="link" id="newerLoad">Load it</button></span></div>` : ""}
        ${(f.warnings || []).map((w) => `<div class="notice warn slim">${icon("alert")}<span>${esc(w)}</span></div>`).join("")}`;
    } else {
      let hint = "";
      if (Store.settings.watchOn && st) {
        if (st.file && st.file.writing) hint = `Compass is saving <b>${esc(st.file.name)}</b> — it loads in a moment.`;
        else if (st.exists && !st.file) hint = `Watching <code>${esc(st.dir)}</code> — no Compass export there yet.`;
        else if (!st.exists) hint = `The Compass export folder <code>${esc(st.dir)}</code> isn't there yet. <button class="link" id="watchSettings">Settings</button>`;
      }
      body = `
        <button class="dropzone" id="fileDrop">
          ${icon("upload", "big-ico")}
          <b>Drop the Eagle or Compass export here</b>
          <span>or click to choose the file</span>
        </button>
        <p class="f-help" style="margin-top:10px">The newest export in the Compass folder loads by itself. You can also drop the location export from Eagle (.xls) or Compass (.xlsx / .csv).</p>
        ${hint ? `<p class="f-help watch-hint" id="watchHint">${icon("refresh")} ${hint}</p>` : ""}`;
    }
    if (this.watchError) {
      body += `<div class="notice warn slim" id="watchError">${icon("alert")}<span><b>Couldn't load the newest Compass export.</b> ${esc(this.watchError)}</span></div>`;
    }
    if (this.fileError) {
      body += `<div class="notice bad" id="fileError">${icon("x")}<span><b>Couldn't load that file.</b> ${esc(this.fileError)}</span></div>`;
    }
    c.innerHTML = stepHead(1, "Location data", !!f) + body + this.freshHtml();
    const pick = () => $("#fileInput").click();
    if ($("#fileDrop")) $("#fileDrop").onclick = pick;
    if ($("#fileChange")) $("#fileChange").onclick = pick;
    if ($("#newerLoad")) $("#newerLoad").onclick = () => this.loadWatch(this.newer);
    if ($("#watchSettings")) $("#watchSettings").onclick = () => App.show("settings");
    if ($("#freshBtn")) $("#freshBtn").onclick = () => this.freshFromCompass();
    if ($("#freshStop")) $("#freshStop").onclick = () => { this.stopAwaiting(); this.renderFile(); };
  },

  /* ---------------- step 2: the codes ---------------- */

  addCodes(text) {
    const typed = Clear.parseCodes(text);
    const bad = typed.map((c) => Clear.codeProblem(c)).filter(Boolean);
    const good = typed.filter((c) => !Clear.codeProblem(c));
    let added = 0;
    for (const c of good) if (!this.codes.includes(c)) { this.codes.push(c); added++; }
    if (added) { this.saved = null; this.saveError = ""; }
    this.refresh();
    if (bad.length) {
      const err = $("#codeError");
      if (err) { err.textContent = bad[0]; err.classList.add("show"); }
      const inp = $("#codeInput");
      if (inp) inp.value = typed.filter((c) => Clear.codeProblem(c)).join(" ");
    }
    const inp = $("#codeInput");
    if (inp) inp.focus();
  },

  removeCode(code) {
    this.codes = this.codes.filter((c) => c !== code);
    delete this.slotsByCode[code];
    this.saved = null;
    this.saveError = "";
    this.refresh();
  },

  /** Tick or untick one location for one code. */
  toggleSlot(code, slot) {
    const cur = Clear.slotsFor(code, this.slotsByCode);
    this.slotsByCode[code] = cur.includes(slot) ? cur.filter((s) => s !== slot) : cur.concat(slot).sort((a, b) => a - b);
    this.saved = null;
    this.saveError = "";
    this.refresh();
  },

  /** Slots any code clears (the default four when there are no codes). */
  activeSlots() {
    if (!this.codes.length) return Clear.CLEARABLE.slice();
    const all = new Set();
    this.codes.forEach((c) => Clear.slotsFor(c, this.slotsByCode).forEach((s) => all.add(s)));
    return Array.from(all);
  },

  renderCodes() {
    const c = $("#stepCodes");
    const plan = this.plan;
    const statFor = (code) => plan && plan.stats.find((s) => s.code === code);
    const slotsOf = (code) => Clear.slotsFor(code, this.slotsByCode);
    // "12R03" adds nothing when "12R" is on the list and clears at least the same locations.
    const covered = Object.fromEntries(Clear.coveredCodes(this.codes)
      .filter((x) => slotsOf(x.code).every((s) => slotsOf(x.by).includes(s)))
      .map((x) => [x.code, x.by]));
    const short = (slots) => slots.length ? slots.map((s) => "L" + (s + 1)).join(" ") : "nothing";
    const chips = this.codes.map((code) => {
      const s = statFor(code);
      const n = s ? `<span class="chip-n${s.cells ? "" : " zero"}">${s.cells.toLocaleString()}</span>` : "";
      return `<span class="chip code-chip" data-code="${esc(code)}" title="Clears ${esc(short(slotsOf(code)))}">${esc(code)}${n}<button title="Remove ${esc(code)}" data-remove="${esc(code)}">${icon("x")}</button></span>`;
    }).join("");

    let details = this.codes.map((code) => {
      const s = statFor(code);
      const slots = slotsOf(code);
      const notes = [];
      if (covered[code]) notes.push(`<div class="notice info slim">${icon("info")}<span>Already covered by <b>${esc(covered[code])}</b>.</span></div>`);
      else if (s && !s.cells && slots.length) notes.push(`<div class="notice warn slim">${icon("alert")}<span>No ticked location in this file starts with <b>${esc(code)}</b>.</span></div>`);
      if (!slots.length) notes.push(`<div class="notice warn slim no-slots">${icon("alert")}<span>No locations ticked — <b>${esc(code)}</b> won't clear anything.</span></div>`);
      const risky = slots.filter((x) => Clear.PROTECTED.includes(x));
      if (risky.length) notes.push(`<div class="notice warn slim risky-slots">${icon("alert")}<span>Also clears <b>${risky.map((x) => `Location ${x + 1} (${Clear.SLOT_ROLES[x].toLowerCase()})`).join(" and ")}</b> when it starts with “${esc(code)}”. Check the preview is only what you mean.</span></div>`);
      if (code.length <= 2 && s && s.cells) notes.push(`<div class="notice warn slim">${icon("alert")}<span>Short code — it clears <b>every</b> ticked location starting with “${esc(code)}”. Check the list below is only what you mean.</span></div>`);
      const where = [];
      if (s) {
        if (s.bySlot[0]) where.push(`Location 1: ${s.bySlot[0].toLocaleString()}`);
        if (s.bySlot[1]) where.push(`Location 2: ${s.bySlot[1].toLocaleString()}`);
        if (s.bySlot[2]) where.push(`Location 3: ${s.bySlot[2].toLocaleString()}`);
        const over = s.bySlot[3] + s.bySlot[4] + s.bySlot[5];
        if (over) where.push(`Overstock: ${over.toLocaleString()}`);
      }
      const pick = Clear.SLOT_ROLES.map((role, i) => {
        const on = slots.includes(i);
        const tag = ["Shelf", "Flag", "Cap", "Over", "Over", "Over"][i];
        return `<button class="sp${on ? " on" : ""}${Clear.PROTECTED.includes(i) ? " prot" : ""}" data-slot-code="${esc(code)}" data-slot="${i}" aria-pressed="${on}" title="${on ? "Clears" : "Leaves"} Location ${i + 1} (${role.toLowerCase()})">L${i + 1}<small>${tag}</small></button>`;
      }).join("");
      return `
        <div class="code-detail" data-detail="${esc(code)}">
          <div class="cd-head"><b>${esc(code)}</b>${s ? `<span>${s.cells.toLocaleString()} location${s.cells === 1 ? "" : "s"} on ${s.skus.toLocaleString()} SKU${s.skus === 1 ? "" : "s"}</span>` : ""}</div>
          <div class="slot-pick" role="group" aria-label="Locations ${esc(code)} clears"><span class="sp-label">Clears</span>${pick}</div>
          ${s && s.cells ? `<div class="cd-values">${esc(Clear.valuesSummary(s.values, 8))}</div><div class="cd-where">${where.join(" · ")}</div>` : ""}
          ${notes.join("")}
        </div>`;
    }).join("");
    if (plan && plan.protectedHits.length) {
      const hits = plan.protectedHits;
      const list = hits.slice(0, 4).map((h) => `${esc(h.value)} in Location ${h.slot + 1} on SKU ${esc(h.sku)}`).join("; ");
      const more = hits.length > 4 ? ` and ${hits.length - 4} more` : "";
      details += `<div class="notice info" id="protectedNote">${icon("lock")}<span><b>Left alone:</b> ${list}${more} — that location isn't ticked for the code.</span></div>`;
    }

    c.innerHTML = stepHead(2, "Codes to clear", this.codes.length > 0 && !!plan && plan.cells > 0) + `
      <div class="f-row code-entry">
        <input class="f-input code-input" id="codeInput" placeholder="e.g. 12R" autocomplete="off" spellcheck="false" aria-label="Location code to clear">
        <button class="btn btn-primary" id="codeAdd">${icon("plus")} Add</button>
      </div>
      <div class="field-error" id="codeError"></div>
      <p class="f-help" style="margin-top:8px">Clears every location that <b>starts with</b> the code — <code>12R</code> clears 12R01–12R09, <code>12R03</code> only 12R03. Add as many as you need, and pick which locations each one clears.</p>
      ${chips ? `<div class="chips">${chips}</div>` : ""}
      ${this.codes.length > 1 ? `<button class="link small" id="codesClear">Remove all codes</button>` : ""}
      <div class="code-details">${details}</div>
      ${plan && plan.protectedHits.length ? "" : `<div class="lock-note">${icon("lock")}<span>Location 2 (flags) and Location 3 (capacity) are left alone unless you tick them for a code.</span></div>`}`;


    const inp = $("#codeInput");
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || (e.key === "," && inp.value.trim())) {
        e.preventDefault();
        if (inp.value.trim()) this.addCodes(inp.value);
      }
    });
    inp.addEventListener("input", () => {
      $("#codeError").classList.remove("show");
      inp.value = inp.value.toUpperCase();
    });
    inp.addEventListener("paste", (e) => {
      const t = (e.clipboardData || window.clipboardData).getData("text");
      if (/[\s,;]/.test(t.trim())) { e.preventDefault(); this.addCodes(t); }
    });
    $("#codeAdd").onclick = () => { if (inp.value.trim()) this.addCodes(inp.value); else inp.focus(); };
    $$("[data-remove]", c).forEach((b) => (b.onclick = () => this.removeCode(b.dataset.remove)));
    $$("[data-slot-code]", c).forEach((b) => (b.onclick = () => this.toggleSlot(b.dataset.slotCode, Number(b.dataset.slot))));
    if ($("#codesClear")) $("#codesClear").onclick = () => { this.codes = []; this.slotsByCode = {}; this.saved = null; this.refresh(); };
  },

  /* ---------------- step 3: save ---------------- */

  autoName() { return Clear.importFileName(this.codes); },
  fileName() { return this.customName != null ? this.customName : this.autoName(); },

  blocker() {
    if (!this.file) return "Load the location data first.";
    if (!this.codes.length) return "Add the location codes to clear.";
    if (!this.plan || !this.plan.changed.length) return "Nothing in this file matches those codes.";
    if (!SAFE_NAME.test(this.fileName())) return "The file name can only use letters, numbers, spaces and dashes, and must end in .csv.";
    return "";
  },
  canSave() { return !this.blocker() && !this.saving; },

  renderSave() {
    const c = $("#stepSave");
    const plan = this.plan;
    const n = plan ? plan.changed.length : 0;
    const blocker = this.blocker();
    const edited = this.customName != null;
    let result = "";
    if (this.saved) {
      result = `
        <div class="notice good saved-note" id="savedNote">${icon("check")}
          <div><b>Saved for Eagle.</b> ${this.saved.skus.toLocaleString()} SKUs · ${this.saved.cells.toLocaleString()} locations cleared
            <code class="saved-path">${esc(this.saved.path)}</code>
            <div class="saved-acts">
              <button class="btn btn-secondary btn-sm" id="savedShow">${icon("folder")} Show in folder</button>
              <button class="btn btn-ghost btn-sm" id="savedCopy">${icon("copy")} Copy path</button>
            </div>
          </div>
        </div>`;
    }
    if (this.saveError) result += `<div class="notice bad" id="saveError">${icon("x")}<span><b>Couldn't save.</b> ${esc(this.saveError)}</span></div>`;

    c.innerHTML = stepHead(3, "Save for Eagle", !!this.saved) + `
      <label class="f-label" for="nameInput">File name</label>
      <input class="f-input" id="nameInput" value="${esc(this.fileName())}" spellcheck="false">
      ${edited ? `<button class="link small" id="nameReset">Use “${esc(this.autoName())}”</button>` : ""}
      <div class="dest-line">${icon("folder")}<span>Saves to <code id="destDir">${esc(Store.exportDir())}</code></span><button class="link small" id="destChange">Change</button></div>
      <button class="btn btn-primary btn-block" id="saveBtn" ${blocker || this.saving ? "disabled" : ""}>
        ${icon("save")} ${this.saving ? "Saving…" : n ? `Save import file · ${n.toLocaleString()} SKU${n === 1 ? "" : "s"}` : "Save import file"}
      </button>
      ${blocker && !this.saved ? `<p class="f-help center" id="saveBlocker" style="margin-top:8px">${esc(blocker)}</p>` : ""}
      ${result}`;

    const ni = $("#nameInput");
    ni.oninput = () => {
      this.customName = ni.value;
      this.saved = null;
      const btn = $("#saveBtn");
      const b = this.blocker();
      btn.disabled = !!b || this.saving;
      ni.classList.toggle("invalid", !SAFE_NAME.test(ni.value));
    };
    ni.onblur = () => {
      let v = ni.value.trim();
      if (v && !/\.csv$/i.test(v)) v += ".csv";
      v = v.replace(/\.CSV$/, ".csv");
      this.customName = v === this.autoName() || !v ? null : v;
      this.renderSave();
    };
    if ($("#nameReset")) $("#nameReset").onclick = () => { this.customName = null; this.renderSave(); };
    $("#destChange").onclick = () => { App.show("settings"); setTimeout(() => $("#sDir") && $("#sDir").focus(), 30); };
    $("#saveBtn").onclick = () => this.save(false);
    if ($("#savedShow")) $("#savedShow").onclick = () => reveal(this.saved.path);
    if ($("#savedCopy")) $("#savedCopy").onclick = () => copyText(this.saved.path);
  },

  async save(overwrite) {
    if (!this.canSave()) return;
    const plan = this.plan;
    const name = this.fileName();
    const csv = Clear.importCSV(plan.changed);
    this.saving = true;
    this.saveError = "";
    this.renderSave();
    try {
      const r = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: Store.exportDir(), name, csv, overwrite: !!overwrite }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 409 && data.exists) {
        this.saving = false;
        this.renderSave();
        const yes = await confirmBox("Replace the existing file?",
          `<code>${esc(data.path)}</code> is already there. Replace it with this one (${plan.changed.length.toLocaleString()} SKUs)?`,
          { okText: "Replace it", danger: true });
        if (yes) return this.save(true);
        return;
      }
      if (!r.ok || !data.ok) throw new Error(data.error || `the app answered ${r.status}`);
      this.saved = { path: data.path, skus: plan.changed.length, cells: plan.cells };
      showToast(`${icon("check")} Saved ${esc(name)}`, { kind: "good" });
      Store.logExport({
        file: name, path: data.path, codes: this.codes.slice(),
        slots: Object.fromEntries(this.codes.map((c) => [c, Clear.slotsFor(c, this.slotsByCode)])),
        skus: plan.changed.length, cells: plan.cells, source: this.file.name,
      }).then(() => this.renderLog());
    } catch (e) {
      this.saveError = friendlyError(e);
    } finally {
      this.saving = false;
      this.renderSave();
    }
  },

  /* ---------------- preview ---------------- */

  renderPreview() {
    const c = $("#previewCard");
    const f = this.file;
    if (!f) {
      c.innerHTML = `
        <div class="card-head"><h3>${icon("list")} Preview</h3></div>
        <div class="empty-state">${icon("sheet", "big-ico")}<p>Load the location data to see every SKU and location that will be cleared.</p></div>`;
      return;
    }
    const plan = this.plan;
    const mode = plan ? this.mode : "all";

    // Rows to show: the import rows, or every SKU with its clears marked.
    let rows;
    if (mode === "import" && plan) {
      rows = plan.changed;
    } else {
      const map = new Map();
      if (plan) plan.changed.forEach((r) => map.set(r.sku + "\u0000" + r.before.join("\u0000"), r));
      rows = f.rows.map((r) => map.get(r.sku + "\u0000" + r.locs.join("\u0000")) || { sku: r.sku, desc: r.desc, before: r.locs, after: r.locs, cleared: [], same: true });
    }
    const q = this.filter.trim().toUpperCase();
    if (q) rows = rows.filter((r) => r.sku.toUpperCase().includes(q) || (r.desc || "").toUpperCase().includes(q) || r.before.some((v) => v.toUpperCase().includes(q)));
    const shown = rows.slice(0, PREVIEW_LIMIT);

    const tiles = plan ? `
      <div class="tiles">
        <div class="tile"><div class="t-label">SKUs in the file</div><div class="t-value num">${f.rows.length.toLocaleString()}</div></div>
        <div class="tile hero-tile"><div class="t-label">SKUs in the import</div><div class="t-value num" id="tSkus">${plan.changed.length.toLocaleString()}</div></div>
        <div class="tile"><div class="t-label">Locations cleared</div><div class="t-value num" id="tCells">${plan.cells.toLocaleString()}</div></div>
        <div class="tile"><div class="t-label">Left out — nothing to clear</div><div class="t-value num" id="tSame">${plan.unchanged.toLocaleString()}</div></div>
      </div>` : `<div class="notice info slim">${icon("info")}<span>Add a location code to see what will be cleared. Showing the file as loaded.</span></div>`;

    const active = this.activeSlots();
    const head = Clear.SLOT_NAMES.map((n, i) => {
      const locked = !active.includes(i);
      return `<th class="loc-h${locked ? " locked" : ""}" title="${locked ? "Not ticked for any code — left as it is" : "Cleared when it matches a code ticked for it"}">${locked ? icon("lock") : ""}Loc ${i + 1}<small>${Clear.SLOT_ROLES[i]}</small></th>`;
    }).join("");
    const body = shown.map((r) => {
      const cells = r.before.map((v, i) => {
        if (r.cleared.includes(i)) return `<td class="loc cleared"><span class="q">?</span> <s>${esc(v)}</s></td>`;
        return `<td class="loc${active.includes(i) ? "" : " locked"}">${esc(v)}</td>`;
      }).join("");
      return `<tr class="${r.same ? "same" : "chg"}"><td class="sku">${esc(r.sku)}</td><td class="desc" title="${esc(r.desc)}">${esc(r.desc)}</td>${cells}</tr>`;
    }).join("");

    const importN = plan ? plan.changed.length : 0;
    c.innerHTML = `
      <div class="card-head">
        <h3>${icon("list")} Preview</h3>
        <div class="prev-tools">
          <label class="search">${icon("search")}<input class="f-input" id="prevFilter" placeholder="Find SKU, item or location" value="${esc(this.filter)}"></label>
          ${plan ? `<div class="seg" role="tablist">
            <button data-mode="import" class="${mode === "import" ? "active" : ""}">In the import · ${importN.toLocaleString()}</button>
            <button data-mode="all" class="${mode === "all" ? "active" : ""}">All SKUs · ${f.rows.length.toLocaleString()}</button>
          </div>` : ""}
        </div>
      </div>
      ${tiles}
      <div class="tbl-scroll preview-scroll">
        <table class="tbl preview" id="previewTable">
          <thead><tr><th>SKU</th><th>Description</th>${head}</tr></thead>
          <tbody>${body || `<tr><td colspan="8" class="center muted">${q ? "Nothing matches that search." : "No SKUs to show."}</td></tr>`}</tbody>
        </table>
      </div>
      ${rows.length > PREVIEW_LIMIT ? `<p class="f-help center">Showing the first ${PREVIEW_LIMIT.toLocaleString()} of ${rows.length.toLocaleString()} rows — the saved file has all of them. Use the search box to find one.</p>` : ""}
      ${plan ? `<p class="f-help prev-key"><span class="q">?</span> = cleared in Eagle (old location shown crossed out). Everything else is written back exactly as it is now.</p>` : ""}`;

    $$("[data-mode]", c).forEach((b) => (b.onclick = () => { this.mode = b.dataset.mode; this.renderPreview(); }));
    const fi = $("#prevFilter");
    fi.oninput = () => {
      this.filter = fi.value;
      const pos = fi.selectionStart;
      this.renderPreview();
      const n = $("#prevFilter");
      n.focus();
      n.setSelectionRange(pos, pos);
    };
  },

  /* ---------------- saved-file log ---------------- */

  renderLog() {
    const c = $("#logCard");
    const list = Store.exports;
    if (!list.length) { c.style.display = "none"; return; }
    c.style.display = "";
    c.innerHTML = `
      <div class="card-head"><h3>${icon("clock")} Saved import files</h3><span class="muted small">Last ${Math.min(list.length, 10)} of ${list.length}</span></div>
      <table class="tbl compact log-tbl">
        <thead><tr><th>Saved</th><th>File</th><th>Codes</th><th class="r">SKUs</th><th class="r">Cleared</th><th></th></tr></thead>
        <tbody>${list.slice(0, 10).map((x) => `
          <tr>
            <td class="nowrap">${esc(fmtDateTime(x.ts))}</td>
            <td>${x.kind === "plan" ? `<span class="kind-tag">New plan</span> ` : ""}<span title="${esc(x.path || "")}">${esc(x.file)}</span>${x.source ? `<div class="muted small">from ${esc(x.source)}</div>` : ""}</td>
            <td>${(x.codes || []).map((c) => {
              const sl = x.slots && x.slots[c];
              const tag = sl && !Clear.isDefaultSlots(sl) ? ` <small>${sl.length ? sl.map((k) => "L" + (k + 1)).join(" ") : "none"}</small>` : "";
              return `<span class="mini-code">${esc(c)}${tag}</span>`;
            }).join(" ")}</td>
            <td class="r num">${Number(x.skus || 0).toLocaleString()}</td>
            <td class="r num">${x.kind === "plan" ? `<span class="muted small">${Number(x.cells || 0)} files</span>` : Number(x.cells || 0).toLocaleString()}</td>
            <td class="row-acts">${x.path ? `<button class="icon-btn-sm" title="Show in folder" data-reveal="${esc(x.path)}">${icon("folder")}</button>` : ""}</td>
          </tr>`).join("")}</tbody>
      </table>`;
    $$("[data-reveal]", c).forEach((b) => (b.onclick = () => reveal(b.dataset.reveal)));
  },
};

function stepHead(n, title, done) {
  return `<div class="step-head"><span class="step-n${done ? " done" : ""}">${done ? icon("check") : n}</span><h3>${esc(title)}</h3></div>`;
}

async function reveal(path) {
  try {
    const r = await fetch("/api/reveal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `the app answered ${r.status}`);
  } catch (e) {
    showToast(`${icon("x")} Couldn't open the folder — ${esc(friendlyError(e))}`, { kind: "error" });
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${icon("check")} Copied`, { kind: "good" });
  } catch (e) {
    showToast(`${icon("x")} Couldn't copy — select the path and press Ctrl+C`, { kind: "error" });
  }
}
