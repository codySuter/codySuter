/* ============================================================
   Ace Location Studio — Settings view. Every change saves on its own
   (a short pause after typing), with a small "Saved" flash.
   ============================================================ */
"use strict";

const SettingsView = {
  _t: null,

  init() {
    this.render();
  },

  refresh() { /* settings only re-render on open, so typing isn't interrupted */ },

  changed() {
    clearTimeout(this._t);
    this._t = setTimeout(async () => {
      const ok = await Store.save();
      const f = $("#setSaved");
      if (f) { f.textContent = ok ? "✓ Saved" : "Couldn't save"; f.className = "saved-flash show" + (ok ? "" : " err"); setTimeout(() => f.classList.remove("show"), 1400); }
      ClearView.refresh();
      PlanView.renderSave();
    }, 350);
  },

  /** The watched folder's status under its setting. */
  async showWatch() {
    const el = $("#sWatchNow");
    if (!el) return;
    const dir = Store.watchDir();
    if (!Store.settings.watchOn) { el.innerHTML = "Off — load an export by hand in Clear Locations."; return; }
    let st;
    try {
      st = await fetch("/api/watch?dir=" + encodeURIComponent(dir), { cache: "no-store" }).then((r) => r.json());
    } catch (e) { el.textContent = "Couldn't check the folder — " + friendlyError(e); return; }
    if (!$("#sWatchNow") || dir !== Store.watchDir()) return;
    let line;
    if (st.error) line = `${icon("alert")} ${esc(st.error)}`;
    else if (!st.exists) line = `${icon("alert")} <code>${esc(st.dir)}</code> doesn't exist yet — create it, or point Compass's task at it.`;
    else if (!st.file) line = `${icon("folder")} Watching <code>${esc(st.dir)}</code> — no export there yet.`;
    else {
      const old = Date.now() - st.file.modified > 60 * 60000;
      line = `${icon(old ? "alert" : "check")} Newest: <b>${esc(st.file.name)}</b>, saved ${esc(whenText(st.file.modified))} (${esc(agoText(st.file.modified))})${old ? " — over an hour old" : ""}.`;
    }
    $("#sWatchNow").innerHTML = line;
  },

  async showCompassExe() {
    const el = $("#sCompassExeNow");
    if (!el) return;
    const exe = Store.compassExe();
    let st;
    try {
      st = await fetch("/api/compass/app?exe=" + encodeURIComponent(exe), { cache: "no-store" }).then((r) => r.json());
    } catch (e) { el.textContent = "Couldn't check — " + friendlyError(e); return; }
    if (!$("#sCompassExeNow") || exe !== Store.compassExe()) return;
    $("#sCompassExeNow").innerHTML = st.found
      ? `${icon("check")} Found${st.running ? " — Compass is open right now" : ""}.`
      : `${icon("alert")} ${esc(st.error || "Not found.")}`;
  },

  render() {
    const st = Store.settings;
    const def = window.__defaultExportDir || "C:\\3apps\\Temp";
    const v = $("#view-settings");
    v.innerHTML = `
      <div class="view-head">
        <div><h2>Settings</h2><p>Changes save automatically.</p></div>
        <span class="saved-flash" id="setSaved"></span>
      </div>
      <div class="settings-grid">
        <div class="card">
          <div class="card-head"><h3>${icon("folder")} Where import files go</h3></div>
          <p class="f-help">Eagle picks up import files from this folder. Leave it blank to use <code>${esc(def)}</code>.
            The folder is created if it doesn't exist yet.</p>
          <label class="f-label" for="sDir">Export folder</label>
          <div class="f-row">
            <input class="f-input" id="sDir" placeholder="${esc(def)}" value="${esc(st.exportDir)}" spellcheck="false">
            <button class="btn btn-secondary" id="sDirReset" title="Go back to ${esc(def)}">Use default</button>
          </div>
          <p class="f-help" id="sDirNow" style="margin-top:8px"></p>
          <label class="f-label" for="sStore">Store name (top-right corner)</label>
          <input class="f-input" id="sStore" value="${esc(st.storeLine)}">
        </div>
        <div class="card">
          <div class="card-head"><h3>${icon("info")} How clearing works</h3></div>
          <ul class="rules">
            <li>A code clears every location that <b>starts with</b> it: <code>12R</code> clears 12R01–12R09, <code>12R03</code> clears only 12R03.</li>
            <li>Each code clears the locations ticked under it (L1–L6). By default that's <b>Location 1</b> (shelf) and <b>Locations 4–6</b> (overstock).</li>
            <li><b>Location 2</b> (system flags like MDONE) and <b>Location 3</b> (shelf capacity) are left alone unless you tick them for a code — they're written back exactly as they are.</li>
            <li>Only SKUs with at least one cleared location go in the import file, always with all six location columns.</li>
            <li>In the file a <code>?</code> tells Eagle to clear that location.</li>
          </ul>
          <div class="card-head" style="margin-top:14px"><h3>${icon("pin")} How new planograms work</h3></div>
          <ul class="rules">
            <li>Each section (segment) of the plan gets its own Location 1, in the order they appear left to right.</li>
            <li><b>Location 3</b> is the plan's REC QTY. With fewer facings it's scaled down and rounded down (REC QTY 12 at 2 facings → 6 at 1), never below 1; blank when the plan has no REC QTY.</li>
            <li>Taking away the last facing drops the SKU from every file.</li>
            <li>Files: <code>&lt;POG&gt; NEWLOC - Eagle Import.csv</code> (SKU, Location 1, Location 3) and label files with <b>facings, SKU</b> and no header — one per location plus an ALL file when the plan spans more than one location.</li>
          </ul>
        </div>
        <div class="card span2" id="watchCard">
          <div class="card-head"><h3>${icon("refresh")} Compass exports — load automatically</h3></div>
          <p class="f-help">Compass can save a location export on a schedule (every 30 minutes, say). The app watches that folder:
            Clear Locations loads the newest export by itself, picks up newer ones as they arrive, and warns when the newest is over an hour old.
            It only reads the folder — nothing there is changed or deleted.</p>
          <label class="check-row"><input type="checkbox" id="sWatchOn" ${st.watchOn ? "checked" : ""}> Load the newest Compass export automatically</label>
          <label class="f-label" for="sWatch">Compass export folder</label>
          <div class="f-row">
            <input class="f-input" id="sWatch" placeholder="${esc(window.__defaultWatchDir || "")}" value="${esc(st.watchDir)}" spellcheck="false">
            <button class="btn btn-secondary" id="sWatchReset" title="Go back to ${esc(window.__defaultWatchDir || "")}">Use default</button>
          </div>
          <p class="f-help" id="sWatchNow" style="margin-top:8px"></p>
          <label class="f-label" for="sCompassExe">Compass program</label>
          <p class="f-help">Clear Locations has a <b>Get fresh data from Compass</b> button: it starts Compass (restarting it if it's open — after asking, and letting Compass ask about unsaved work), so the export task set to run when Compass starts saves a new export.</p>
          <div class="f-row">
            <input class="f-input" id="sCompassExe" placeholder="${esc(window.__defaultCompassExe || "")}" value="${esc(st.compassExe)}" spellcheck="false">
            <button class="btn btn-secondary" id="sCompassExeReset" title="Go back to ${esc(window.__defaultCompassExe || "")}">Use default</button>
          </div>
          <p class="f-help" id="sCompassExeNow" style="margin-top:8px"></p>
          <details class="watch-how"><summary>Setting up the export in Compass</summary>
            <ol class="rules">
              <li>Make a <b>query</b> of items with <b>Item Number</b>, <b>Item Description</b> and <b>Location</b>, <b>Location 2</b> … <b>Location 6</b> — no filter, so it has every item.</li>
              <li>Make a <b>schedule</b> that runs every 30 minutes.</li>
              <li>Make a <b>task</b> that runs the query on that schedule and saves it (Excel or CSV) <b>into the folder above, with the same file name every time</b>.</li>
              <li>For the <b>Get fresh data</b> button, also set the task to run <b>when Compass starts</b>.</li>
            </ol>
          </details>
        </div>
        <div class="card span2" id="compassCard"></div>
        <div class="card span2">
          <div class="card-head"><h3>${icon("refresh")} Updates &amp; data</h3></div>
          <div class="data-path" id="sDataDir"></div>
          <p class="f-help">Settings and the list of saved import files live in this folder, with a daily backup.</p>
          <div class="f-row"><button class="btn btn-secondary" id="settingsUpdateBtn">Check for updates</button><span class="f-help inline" id="settingsUpdateStatus"></span></div>
          <details class="changelog-box"><summary>What's new — version history</summary><div class="changelog" id="changelogList"></div></details>
        </div>
      </div>`;

    const showNow = () => { $("#sDirNow").innerHTML = `Saving to ${icon("folder")} <code>${esc(Store.exportDir())}</code>`; };
    showNow();
    $("#sDir").oninput = (e) => { st.exportDir = e.target.value.trim(); showNow(); this.changed(); };
    $("#sDirReset").onclick = () => { st.exportDir = ""; $("#sDir").value = ""; showNow(); this.changed(); };
    $("#sStore").oninput = (e) => { st.storeLine = e.target.value; $("#storeLineTop").textContent = st.storeLine; this.changed(); };
    $("#sDataDir").innerHTML = window.__dataDir ? `${icon("save")} <code>${esc(window.__dataDir)}</code>` : "";
    const watchChanged = () => {
      this.changed();
      clearTimeout(this._wt);
      this._wt = setTimeout(() => { this.showWatch(); ClearView.checkWatch(); }, 400);
    };
    $("#sWatchOn").onchange = (e) => { st.watchOn = e.target.checked; watchChanged(); };
    $("#sWatch").oninput = (e) => { st.watchDir = e.target.value.trim(); watchChanged(); };
    $("#sWatchReset").onclick = () => { st.watchDir = ""; $("#sWatch").value = ""; watchChanged(); };
    this.showWatch();
    const exeChanged = () => { this.changed(); clearTimeout(this._et); this._et = setTimeout(() => this.showCompassExe(), 400); };
    $("#sCompassExe").oninput = (e) => { st.compassExe = e.target.value.trim(); exeChanged(); };
    $("#sCompassExeReset").onclick = () => { st.compassExe = ""; $("#sCompassExe").value = ""; exeChanged(); };
    this.showCompassExe();
    initSettingsUpdates();
    CompassPanel.render($("#compassCard"));
  },
};
