/* ============================================================
   Ace Location Studio — Settings → Live data from Compass.

   The Compass data warehouse is a read-only MySQL copy of the store's
   Eagle data on the store network; Margin Master reads from it the same
   way. This card holds the connection (copied from Margin Master's
   Epicor tab), tests it like Margin Master's troubleshooter, and runs
   Explore — a report that finds which tables and columns hold the SKU
   and the six locations. The password goes to the app's backend only,
   which keeps it encrypted for this Windows user; the page never sees it.
   ============================================================ */
"use strict";

const CompassPanel = {
  settings: null,   // { server, port, database, username, tls, hasPassword }
  test: null,       // last test result
  testing: false,
  report: null,     // last explore report
  exploring: false,
  error: "",
  sku: "",
  loc: "",

  async load() {
    try {
      this.settings = await fetch("/api/compass/settings", { cache: "no-store" }).then((r) => r.json());
    } catch (e) {
      this.error = friendlyError(e);
    }
  },

  async render(host) {
    this.host = host;
    if (!this.settings) await this.load();
    this.draw();
  },

  status() {
    const st = (Store.doc.compass || {});
    if (this.testing) return `<span class="cp-status">Testing…</span>`;
    if (this.test) return this.test.ok ? `<span class="cp-status ok">${icon("check")} Connected</span>` : `<span class="cp-status bad">${icon("x")} Not connected</span>`;
    if (st.ok && this.settings && this.settings.server) return `<span class="cp-status ok" title="Last test ${esc(fmtDateTime(st.ts))}">${icon("check")} Connected ${esc(fmtDate(todayISO(new Date(st.ts)), { month: "short", day: "numeric" }))}</span>`;
    if (this.settings && this.settings.server) return `<span class="cp-status">Not tested</span>`;
    return `<span class="cp-status">Not set up</span>`;
  },

  draw() {
    const c = this.host;
    if (!c) return;
    const s = this.settings || { port: 3306, tls: "preferred" };
    c.innerHTML = `
      <div class="card-head"><h3>${icon("refresh")} Live data from Compass <span class="muted small">(read-only)</span></h3>${this.status()}</div>
      <p class="f-help">The app can read SKUs and locations straight from your <b>Compass data warehouse</b>, the same way Margin Master does,
        instead of you exporting a file from Eagle. It only ever <b>reads</b> — changes still go into Eagle through the import files.</p>
      <div class="notice info slim">${icon("info")}<span>Copy these from <b>Margin Master</b>: Options → POS / Connections → <b>Epicor</b> tab, with <b>Connect via MySQL / Compass</b> checked.
        Run this on a PC on the store network (not over VPN or Remote Desktop).</span></div>
      ${this.error ? `<div class="notice bad">${icon("x")}<span>${esc(this.error)}</span></div>` : ""}
      <div class="cp-grid">
        <label><span>Server</span><input class="f-input" id="cpServer" value="${esc(s.server || "")}" placeholder="e.g. 192.168.1.20" spellcheck="false" autocomplete="off"></label>
        <label><span>Port</span><input class="f-input" id="cpPort" value="${esc(s.port || 3306)}" inputmode="numeric" autocomplete="off"></label>
        <label><span>Database</span><input class="f-input" id="cpDb" value="${esc(s.database || "")}" spellcheck="false" autocomplete="off"></label>
        <label><span>Username</span><input class="f-input" id="cpUser" value="${esc(s.username || "")}" spellcheck="false" autocomplete="off"></label>
        <label><span>Password</span><input class="f-input" id="cpPass" type="password" autocomplete="new-password" placeholder="${s.hasPassword ? "Saved — leave blank to keep" : ""}"></label>
        <label><span>SSL</span><select class="f-input" id="cpTls">
          <option value="preferred"${s.tls === "preferred" || !s.tls ? " selected" : ""}>Use if the server has it</option>
          <option value="off"${s.tls === "off" ? " selected" : ""}>Off</option>
          <option value="on"${s.tls === "on" ? " selected" : ""}>Required</option>
        </select></label>
      </div>
      <div class="f-row">
        <button class="btn btn-primary" id="cpSave" ${this.testing ? "disabled" : ""}>${icon("check")} ${this.testing ? "Testing…" : "Save & test connection"}</button>
        ${s.hasPassword ? `<button class="btn btn-ghost" id="cpClearPw">Forget password</button>` : ""}
        <span class="f-help inline">The password is kept encrypted for your Windows login on this PC.</span>
      </div>
      <div id="cpChecks">${this.checksHtml()}</div>
      <div class="cp-explore">
        <h4>${icon("search")} Find where your data lives</h4>
        <p class="f-help">Compass's table layout isn't published, so the app looks for it. Type a <b>SKU</b> and its <b>Location 1</b> that you know from Eagle,
          then <b>Explore</b>: the report lists Compass's tables and shows which columns hold that SKU and location. Send the report to whoever is setting up the app.</p>
        <div class="f-row">
          <input class="f-input narrow-sku" id="cpSku" placeholder="SKU, e.g. 70013" value="${esc(this.sku)}" spellcheck="false" autocomplete="off">
          <input class="f-input narrow-loc" id="cpLoc" placeholder="Location, e.g. 12R02" value="${esc(this.loc)}" maxlength="5" spellcheck="false" autocomplete="off">
          <button class="btn btn-secondary" id="cpExplore" ${this.exploring || !(s.server && s.database && s.username) ? "disabled" : ""}>${icon("search")} ${this.exploring ? "Exploring… (up to a minute)" : "Explore Compass"}</button>
        </div>
        <div id="cpReport">${this.reportHtml()}</div>
      </div>`;

    $("#cpSave").onclick = () => this.saveAndTest();
    if ($("#cpClearPw")) $("#cpClearPw").onclick = () => this.save({ clearPassword: true }).then(() => this.draw());
    $("#cpExplore").onclick = () => this.explore();
    $("#cpSku").oninput = (e) => { this.sku = e.target.value.trim(); };
    $("#cpLoc").oninput = (e) => { e.target.value = e.target.value.toUpperCase(); this.loc = e.target.value.trim(); };
    if ($("#cpCopyChecks")) $("#cpCopyChecks").onclick = () => copyText(this.checksText());
    if ($("#cpCopyReport")) $("#cpCopyReport").onclick = () => copyText(this.report.text);
    if ($("#cpSaveReport")) $("#cpSaveReport").onclick = () => downloadText(`Compass explore report ${todayISO()}.txt`, this.report.text);
  },

  fields() {
    return {
      server: $("#cpServer").value.trim(),
      port: Number($("#cpPort").value.trim()) || 0,
      database: $("#cpDb").value.trim(),
      username: $("#cpUser").value.trim(),
      tls: $("#cpTls").value,
    };
  },

  /** What's on screen, ready to save (read before anything redraws). */
  formBody(extra) {
    const body = Object.assign(this.fields(), extra || {});
    const pw = $("#cpPass") && $("#cpPass").value;
    if (pw) body.password = pw;
    return body;
  },

  async save(extra, body) {
    body = body || this.formBody(extra);
    const r = await fetch("/api/compass/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `the app answered ${r.status}`);
    this.settings = data;
    this.error = "";
    return data;
  },

  async saveAndTest() {
    if (this.testing) return;
    const body = this.formBody();
    this.testing = true;
    this.test = null;
    this.error = "";
    // Show "Testing…" (and drop the last results) straight away, keeping
    // what was typed on screen until the save comes back.
    Object.assign(this.settings || (this.settings = {}), { server: body.server, port: body.port, database: body.database, username: body.username, tls: body.tls });
    this.draw();
    try {
      await this.save(null, body);
      this.draw();
      const r = await fetch("/api/compass/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `the app answered ${r.status}`);
      this.test = data;
      Store.doc.compass = { ok: !!data.ok, ts: Date.now(), version: data.version || "", inRows: data.inRows || 0 };
      Store.save();
    } catch (e) {
      this.error = friendlyError(e);
    } finally {
      this.testing = false;
      this.draw();
    }
  },

  checksHtml() {
    const t = this.test;
    if (!t) return "";
    const ico = { pass: "check", warn: "alert", fail: "x", skip: "minus" };
    return `
      <ul class="cp-checks" id="cpCheckList">${t.checks.map((c) => `
        <li class="${c.status}"><span class="cp-ico">${icon(ico[c.status] || "info")}</span>
          <div><b>${esc(c.name)}</b> <span>${esc(c.detail)}</span>${c.fix ? `<div class="cp-fix">${esc(c.fix)}</div>` : ""}</div></li>`).join("")}
      </ul>
      <div class="f-row"><button class="btn btn-ghost btn-sm" id="cpCopyChecks">${icon("copy")} Copy results</button>
        ${t.ok ? `<span class="f-help inline">Connected${t.inRows ? ` — ${Number(t.inRows).toLocaleString()} inventory rows` : ""}. Next: Explore below.</span>` : ""}</div>`;
  },

  checksText() {
    const t = this.test;
    return ["Ace Location Studio — Compass connection test", ...t.checks.map((c) => `[${c.status.toUpperCase()}] ${c.name}: ${c.detail}${c.fix ? " → " + c.fix : ""}`)].join("\n");
  },

  async explore() {
    this.exploring = true;
    this.report = null;
    this.error = "";
    this.draw();
    try {
      const r = await fetch("/api/compass/explore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sku: this.sku, location: this.loc }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `the app answered ${r.status}`);
      this.report = data;
    } catch (e) {
      this.error = "Explore didn't finish: " + friendlyError(e);
    } finally {
      this.exploring = false;
      this.draw();
    }
  },

  reportHtml() {
    const r = this.report;
    if (!r) return "";
    const found = (what) => r.matches.filter((m) => m.what === what).map((m) => `<code>${esc(m.table)}.${esc(m.column)}</code>`);
    const sku = found("sku"), loc = found("location");
    const lines = [];
    if (this.sku) lines.push(sku.length ? `SKU ${esc(this.sku)} is in ${sku.join(", ")}` : `SKU ${esc(this.sku)} wasn't found in a SKU-like column`);
    if (this.loc) lines.push(loc.length ? `Location ${esc(this.loc)} is in ${loc.join(", ")}` : `Location ${esc(this.loc)} wasn't found`);
    return `
      <div class="notice ${sku.length || loc.length ? "good" : "info"} slim" id="cpFound">${icon(sku.length || loc.length ? "check" : "info")}<span>
        ${lines.length ? lines.join(" · ") : "Report ready."} — ${r.tables.length} tables${r.inColumns.length ? `, inventory table with ${r.inColumns.length} columns` : ""}.</span></div>
      <pre class="cp-report" id="cpReportText">${esc(r.text)}</pre>
      <div class="f-row">
        <button class="btn btn-secondary btn-sm" id="cpCopyReport">${icon("copy")} Copy report</button>
        <button class="btn btn-secondary btn-sm" id="cpSaveReport">${icon("download")} Save report…</button>
        <span class="f-help inline">It includes a few rows of inventory data — share it only with people you trust.</span>
      </div>`;
  },
};
