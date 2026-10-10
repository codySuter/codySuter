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
            <li><b>Location 1</b> (shelf) and <b>Locations 4–6</b> (overstock) are cleared when they match.</li>
            <li><b>Location 2</b> (system flags like MDONE) and <b>Location 3</b> (shelf capacity) are never cleared — they're written back exactly as they are.</li>
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
    initSettingsUpdates();
    CompassPanel.render($("#compassCard"));
  },
};
