/* ============================================================
   Ace Change Studio — Settings view. Every change saves on its own
   (a short pause after typing), with a small "Saved" flash.
   ============================================================ */
"use strict";

const SettingsView = {
  _t: null,

  init() {
    this.render();
  },

  refresh() { /* settings only re-render on open, so typing isn't interrupted */ },

  changed(rerenderOthers) {
    clearTimeout(this._t);
    this._t = setTimeout(async () => {
      const ok = await Store.save();
      const f = $("#setSaved");
      if (f) { f.textContent = ok ? "✓ Saved" : "Couldn't save"; f.className = "saved-flash show" + (ok ? "" : " err"); setTimeout(() => f.classList.remove("show"), 1400); }
      if (rerenderOthers !== false) App.refreshAll({ skipSettings: true });
    }, 350);
  },

  render() {
    const st = Store.settings;
    const v = $("#view-settings");
    v.innerHTML = `
      <div class="view-head">
        <div><h2>Settings</h2><p>Changes save automatically.</p></div>
        <span class="saved-flash" id="setSaved"></span>
      </div>
      <div class="settings-grid">
        <div class="card">
          <div class="card-head"><h3>${icon("user")} People</h3></div>
          <p class="f-help">Names for the cashier and "counted by" lists.</p>
          <div class="chips" id="sPeople"></div>
          <div class="f-row"><input class="f-input" id="sPersonNew" placeholder="Add a name"><button class="btn btn-secondary" id="sPersonAdd">${icon("plus")} Add</button></div>
          <label class="f-label" for="sStore">Store name (printed on order sheets)</label>
          <input class="f-input" id="sStore" value="${esc(st.storeLine)}">
        </div>

        <div class="card">
          <div class="card-head"><h3>${icon("alert")} Over / short flags</h3></div>
          <p class="f-help">How far off a drawer can be before it's flagged — over or short.</p>
          <div class="flag-set">
            <span class="os-badge good">${icon("check")}<span>Green</span></span><span>up to</span>
            <div class="money-input sm"><span>$</span><input class="f-input" id="sGreen" value="${(st.flags.green / 100).toFixed(2)}"></div>
          </div>
          <div class="flag-set">
            <span class="os-badge warn">${icon("alert")}<span>Yellow</span></span><span>up to</span>
            <div class="money-input sm"><span>$</span><input class="f-input" id="sYellow" value="${(st.flags.yellow / 100).toFixed(2)}"></div>
          </div>
          <div class="flag-set"><span class="os-badge bad">${icon("x")}<span>Red</span></span><span id="sRedText">over $${(st.flags.yellow / 100).toFixed(2)}</span></div>
        </div>

        <div class="card span2">
          <div class="card-head"><h3>${icon("drawer")} Drawers</h3><button class="btn btn-secondary" id="sDrawerAdd">${icon("plus")} Add a drawer</button></div>
          <table class="tbl drawers-tbl">
            <thead><tr><th>Name</th><th>Area</th><th>Note</th><th>Starts at</th><th></th></tr></thead>
            <tbody id="sDrawers"></tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-head"><h3>${icon("drawer")} The reset — what a good $150 looks like</h3></div>
          <p class="f-help">When you count a drawer, the app leaves as close to this as it can, using what's actually in the drawer.</p>
          <div id="sReset"></div>
          <div class="f-row between"><span id="sResetTotal"></span><button class="btn btn-ghost" id="sResetDefault">Use the recommended mix</button></div>
        </div>

        <div class="card">
          <div class="card-head"><h3>${icon("box")} Ideal change box</h3></div>
          <p class="f-help">What a full change box holds. Orders aim to bring it back to this.</p>
          <div id="sIdeal"></div>
          <div class="f-row between"><span id="sIdealTotal"></span><button class="btn btn-ghost" id="sIdealDefault">Restore the original</button></div>
          <label class="f-label" for="sRound">Round bill orders up to</label>
          <select class="f-input" id="sRound">
            <option value="50" ${st.billRound === 50 ? "selected" : ""}>Half straps (50 bills) — recommended</option>
            <option value="100" ${st.billRound === 100 ? "selected" : ""}>Full straps (100 bills)</option>
            <option value="1" ${st.billRound === 1 ? "selected" : ""}>Exact number of bills</option>
          </select>
          <label class="f-label" for="sExcess">Send extra 5s and 10s to the bank when there are more than</label>
          <div class="f-row"><input class="f-input narrow-in" id="sExcess" value="${st.excessThreshold}"><span class="f-help inline">bills over ideal</span></div>
        </div>

        <div class="card">
          <div class="card-head"><h3>${icon("save")} Your data</h3></div>
          <p class="f-help">Everything is saved on this computer. A backup copy is kept automatically for each of the last 30 days you used the app.</p>
          <div class="data-path" id="sDataDir"></div>
          <div class="f-row">
            <button class="btn btn-secondary" id="sExport">${icon("download")} Save a backup file</button>
            <button class="btn btn-secondary" id="sImport">${icon("upload")} Restore from a file</button>
            <input type="file" id="sImportFile" accept="application/json,.json" hidden>
          </div>
          <p class="f-help" id="sDataStats"></p>
        </div>

        <div class="card">
          <div class="card-head"><h3>${icon("refresh")} Updates</h3></div>
          <div class="f-row"><button class="btn btn-secondary" id="settingsUpdateBtn">Check for updates</button><span class="f-help inline" id="settingsUpdateStatus"></span></div>
          <details class="changelog-box"><summary>What's new — version history</summary><div class="changelog" id="changelogList"></div></details>
        </div>
      </div>`;

    this.renderPeople();
    $("#sPersonAdd").onclick = () => this.addPerson();
    $("#sPersonNew").onkeydown = (e) => { if (e.key === "Enter") this.addPerson(); };
    $("#sStore").oninput = (e) => { st.storeLine = e.target.value; $("#storeLineTop").textContent = st.storeLine; this.changed(false); };

    const flagInput = (id, key) => {
      $(id).oninput = (e) => {
        const c = Cash.parseMoney(e.target.value);
        if (c == null || c < 0) return;
        st.flags[key] = c;
        if (st.flags.yellow < st.flags.green) st.flags.yellow = st.flags.green;
        $("#sRedText").textContent = `over ${Cash.money(st.flags.yellow)}`;
        this.changed();
      };
      $(id).onblur = () => { $("#sGreen").value = (st.flags.green / 100).toFixed(2); $("#sYellow").value = (st.flags.yellow / 100).toFixed(2); };
    };
    flagInput("#sGreen", "green");
    flagInput("#sYellow", "yellow");

    this.renderDrawers();
    $("#sDrawerAdd").onclick = () => {
      st.drawers.push({ id: uid(), name: `Drawer ${st.drawers.length + 1}`, area: "", note: "", start: 15000 });
      this.renderDrawers();
      this.changed();
      const inputs = $$("#sDrawers input[data-k='name']");
      inputs[inputs.length - 1].focus();
    };

    this.renderReset();
    $("#sResetDefault").onclick = () => { st.reset = Object.assign({}, Cash.DEFAULT_RESET); this.renderReset(); this.changed(); };

    this.renderIdeal();
    $("#sIdealDefault").onclick = async () => {
      const ok = await confirmBox("Restore the original ideal box?", "20 rolls quarters, 10 dimes, 10 nickels, 4 straps of ones, 1 strap of fives, 1 strap of tens ($2,170).", { okText: "Restore" });
      if (!ok) return;
      st.ideal = Object.assign({}, Cash.DEFAULT_IDEAL); this.renderIdeal(); this.changed();
    };
    $("#sRound").onchange = (e) => { st.billRound = Number(e.target.value); this.changed(); };
    wireNumberInput($("#sExcess"), () => { st.excessThreshold = parseInt($("#sExcess").value, 10) || 0; this.changed(); });

    $("#sExport").onclick = () => downloadText(`ace-change-studio-backup-${todayISO()}.json`, JSON.stringify(Store.doc, null, 1), "application/json");
    $("#sImport").onclick = () => $("#sImportFile").click();
    $("#sImportFile").onchange = (e) => this.importFile(e.target.files[0]);
    $("#sDataDir").innerHTML = window.__dataDir ? `${icon("save")} <code>${esc(window.__dataDir)}</code>` : "";
    $("#sDataStats").textContent = `${Store.counts.length} drawer count${Store.counts.length === 1 ? "" : "s"} and ${Store.boxLogs.length} change box record${Store.boxLogs.length === 1 ? "" : "s"} saved.`;

    initSettingsUpdates();
  },

  renderPeople() {
    const host = $("#sPeople");
    const people = Store.settings.people;
    host.innerHTML = people.length ? people.map((p, i) => `<span class="chip">${esc(p)}<button data-i="${i}" title="Remove ${esc(p)}">${icon("x")}</button></span>`).join("") : `<span class="muted small-note">No names yet.</span>`;
    $$("button", host).forEach((b) => (b.onclick = () => {
      const [gone] = people.splice(Number(b.dataset.i), 1);
      this.renderPeople();
      this.changed();
      showToast(`Removed ${esc(gone)} from the list. Their past counts keep their name.`, { undo: () => { people.push(gone); people.sort((a, b) => a.localeCompare(b)); this.renderPeople(); this.changed(); } });
    }));
  },

  addPerson() {
    const inp = $("#sPersonNew");
    const name = inp.value.trim();
    if (!name) return;
    if (!Store.settings.people.includes(name)) {
      Store.settings.people.push(name);
      Store.settings.people.sort((a, b) => a.localeCompare(b));
    }
    inp.value = "";
    inp.focus();
    this.renderPeople();
    this.changed();
  },

  renderDrawers() {
    const st = Store.settings;
    const host = $("#sDrawers");
    host.innerHTML = st.drawers.map((d, i) => `
      <tr data-i="${i}">
        <td><input class="f-input" data-k="name" value="${esc(d.name)}"></td>
        <td><input class="f-input" data-k="area" value="${esc(d.area)}" placeholder="Upstairs / Downstairs" list="areaList"></td>
        <td><input class="f-input" data-k="note" value="${esc(d.note)}" placeholder="optional"></td>
        <td><div class="money-input sm"><span>$</span><input class="f-input" data-k="start" value="${(d.start / 100).toFixed(2)}"></div></td>
        <td><button class="icon-btn-sm danger" data-act="del" title="Remove drawer">${icon("trash")}</button></td>
      </tr>`).join("") + `<datalist id="areaList"><option>Upstairs</option><option>Downstairs</option></datalist>`;
    $$("tr[data-i]", host).forEach((tr) => {
      const d = st.drawers[Number(tr.dataset.i)];
      $$("input", tr).forEach((inp) => (inp.oninput = () => {
        const k = inp.dataset.k;
        if (k === "start") { const c = Cash.parseMoney(inp.value); if (c == null || c < 0) return; d.start = c; this.renderResetTotal(); }
        else d[k] = inp.value;
        this.changed();
      }));
      tr.querySelector('[data-act="del"]').onclick = async () => {
        if (st.drawers.length <= 1) return showToast("Keep at least one drawer.", { kind: "error" });
        const ok = await confirmBox(`Remove ${esc(d.name)}?`, "Past counts for this drawer stay in History.", { okText: "Remove", danger: true });
        if (!ok) return;
        st.drawers.splice(st.drawers.indexOf(d), 1);
        this.renderDrawers();
        this.changed();
      };
    });
  },

  renderReset() {
    const st = Store.settings;
    const ids = ["b10", "b5", "b1", "rq", "rd", "rn", "cq", "cd", "cn"];
    $("#sReset").innerHTML = `<div class="mini-rows">${ids.map((id) => `
      <div class="mini-row" data-id="${id}">${moneyPic(id, "sm")}<span class="mr-l">${Cash.DENOM[id].label}</span>
        <span class="cnt-wrap"><input class="cnt" value="${st.reset[id] || ""}" placeholder="0"></span>
        <span class="mr-v" id="rv-${id}"></span></div>`).join("")}</div>`;
    $$("#sReset .mini-row").forEach((row) => {
      const id = row.dataset.id;
      wireNumberInput($("input", row), () => {
        const n = parseInt($("input", row).value, 10) || 0;
        if (n) st.reset[id] = n; else delete st.reset[id];
        this.renderResetTotal();
        this.changed();
      });
    });
    this.renderResetTotal();
  },

  renderResetTotal() {
    const st = Store.settings;
    for (const id of Object.keys(Cash.DENOM)) { const o = $("#rv-" + id); if (o) o.textContent = st.reset[id] ? Cash.money(st.reset[id] * Cash.DENOM[id].cents) : ""; }
    const total = Cash.sumCents(st.reset);
    const starts = [...new Set(st.drawers.map((d) => d.start))];
    const match = starts.length === 1 && starts[0] === total;
    $("#sResetTotal").innerHTML = `Adds up to <b>${Cash.money(total)}</b> ${match ? `<span class="os-badge good tiny">${icon("check")}<span>matches</span></span>` : `<span class="os-badge warn tiny">${icon("alert")}<span>drawers start at ${starts.map((s) => Cash.money(s)).join(" / ")}</span></span>`}`;
  },

  renderIdeal() {
    const st = Store.settings;
    $("#sIdeal").innerHTML = `<div class="mini-rows">${Cash.BOX_STOCK.map((s) => `
      <div class="mini-row" data-id="${s.id}">${moneyPic(s.id, "sm")}<span class="mr-l">${s.label}</span>
        <span class="cnt-wrap"><input class="cnt" value="${st.ideal[s.id] || ""}" placeholder="0"></span><span class="unit-label">${s.unit}s</span>
        <span class="mr-v" id="iv-${s.id}"></span></div>`).join("")}</div>`;
    $$("#sIdeal .mini-row").forEach((row) => {
      const id = row.dataset.id;
      wireNumberInput($("input", row), () => {
        st.ideal[id] = parseInt($("input", row).value, 10) || 0;
        this.renderIdealTotal();
        this.changed();
      });
    });
    this.renderIdealTotal();
  },

  renderIdealTotal() {
    const st = Store.settings;
    for (const s of Cash.BOX_STOCK) {
      const o = $("#iv-" + s.id);
      const n = st.ideal[s.id] || 0;
      if (o) o.innerHTML = n ? `${Cash.dollars(n * s.dollars)} <small class="muted">${esc(Cash.packText(s.id, n))}</small>` : "";
    }
    $("#sIdealTotal").innerHTML = `Total float <b>${Cash.dollars(Cash.sumDollars(st.ideal))}</b>`;
  },

  async importFile(file) {
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { return showToast("That file isn't an Ace Change Studio backup.", { kind: "error" }); }
    if (!data || typeof data !== "object" || !("counts" in data) || !("settings" in data)) return showToast("That file isn't an Ace Change Studio backup.", { kind: "error" });
    const n = Array.isArray(data.counts) ? data.counts.length : 0;
    const ok = await confirmBox("Restore from this file?", `It has ${n} drawer count${n === 1 ? "" : "s"}. Everything saved now will be replaced — a backup file of the current data downloads first, just in case.`, { okText: "Replace & restore", danger: true });
    $("#sImportFile").value = "";
    if (!ok) return;
    downloadText(`ace-change-studio-before-restore-${todayISO()}.json`, JSON.stringify(Store.doc, null, 1), "application/json");
    Store.doc = normalizeDoc(data);
    await Store.save();
    App.refreshAll();
    this.render();
    showToast(`${icon("check")} Restored.`);
  },
};
