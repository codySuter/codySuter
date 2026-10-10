/* ============================================================
   Ace Location Studio — Clear Locations view.

   1. Load the Eagle location export (the backend reads the .xls).
   2. Type the location codes being reset.
   3. Check the preview, then save the import file into the export
      folder (C:\3apps\Temp) for Eagle to pick up.
   The clearing rules themselves live in clear.js.
   ============================================================ */
"use strict";

const PREVIEW_LIMIT = 1000; // rows drawn at once; the file itself has them all
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.,()&+#-]{0,150}\.csv$/;

const ClearView = {
  file: null,        // parsed Eagle file from /api/parse
  fileError: "",
  loading: "",
  codes: [],
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
          <p>Load the location export from Eagle, type the codes being reset, check the preview, and save the import file for Eagle.</p>
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
      <div class="drop-overlay" id="dropOverlay"><div>${icon("upload")}<b>Drop the Eagle export to load it</b></div></div>`;

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
  },

  refresh() {
    this.plan = this.file && this.codes.length ? Clear.planClear(this.file.rows, this.codes) : null;
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
      if (!hasFiles(e) || App.view !== "clear") return;
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
      if (App.view !== "clear") return;
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) this.loadFile(f);
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

  renderFile() {
    const c = $("#stepFile");
    const f = this.file;
    let body;
    if (this.loading) {
      body = `<div class="file-row"><div class="spinner"></div><div><b>Reading ${esc(this.loading)}…</b></div></div>`;
    } else if (f) {
      const layout = f.layout === "export" ? "Eagle location export" : "Eagle import layout";
      body = `
        <div class="file-row">
          <span class="file-ico">${icon("sheet")}</span>
          <div class="file-meta">
            <b title="${esc(f.name)}">${esc(f.name)}</b>
            <span>${f.rows.length.toLocaleString()} SKUs${f.sheet ? " · " + esc(f.sheet) : ""} · ${layout}</span>
          </div>
          <button class="btn btn-secondary" id="fileChange">Change file</button>
        </div>
        ${(f.warnings || []).map((w) => `<div class="notice warn slim">${icon("alert")}<span>${esc(w)}</span></div>`).join("")}`;
    } else {
      body = `
        <button class="dropzone" id="fileDrop">
          ${icon("upload", "big-ico")}
          <b>Drop the Eagle export here</b>
          <span>or click to choose the file</span>
        </button>
        <p class="f-help" style="margin-top:10px">The location export from Eagle, saved as Excel (.xls). An .xlsx or .csv with the same columns works too.</p>`;
    }
    if (this.fileError) {
      body += `<div class="notice bad" id="fileError">${icon("x")}<span><b>Couldn't load that file.</b> ${esc(this.fileError)}</span></div>`;
    }
    c.innerHTML = stepHead(1, "Eagle export", !!f) + body;
    const pick = () => $("#fileInput").click();
    if ($("#fileDrop")) $("#fileDrop").onclick = pick;
    if ($("#fileChange")) $("#fileChange").onclick = pick;
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
    this.saved = null;
    this.saveError = "";
    this.refresh();
  },

  renderCodes() {
    const c = $("#stepCodes");
    const plan = this.plan;
    const statFor = (code) => plan && plan.stats.find((s) => s.code === code);
    const covered = Object.fromEntries(Clear.coveredCodes(this.codes).map((x) => [x.code, x.by]));
    const chips = this.codes.map((code) => {
      const s = statFor(code);
      const n = s ? `<span class="chip-n${s.cells ? "" : " zero"}">${s.cells.toLocaleString()}</span>` : "";
      return `<span class="chip code-chip" data-code="${esc(code)}">${esc(code)}${n}<button title="Remove ${esc(code)}" data-remove="${esc(code)}">${icon("x")}</button></span>`;
    }).join("");

    let details = "";
    if (plan) {
      details = plan.stats.map((s) => {
        const notes = [];
        if (covered[s.code]) notes.push(`<div class="notice info slim">${icon("info")}<span>Already covered by <b>${esc(covered[s.code])}</b>.</span></div>`);
        else if (!s.cells) notes.push(`<div class="notice warn slim">${icon("alert")}<span>No Location 1 or overstock location in this file starts with <b>${esc(s.code)}</b>.</span></div>`);
        if (s.code.length <= 2 && s.cells) notes.push(`<div class="notice warn slim">${icon("alert")}<span>Short code — it clears <b>every</b> location starting with “${esc(s.code)}”. Check the list below is only what you mean.</span></div>`);
        const where = [];
        if (s.bySlot[0]) where.push(`Location 1: ${s.bySlot[0].toLocaleString()}`);
        const over = s.bySlot[3] + s.bySlot[4] + s.bySlot[5];
        if (over) where.push(`Overstock: ${over.toLocaleString()}`);
        return `
          <div class="code-detail">
            <div class="cd-head"><b>${esc(s.code)}</b><span>${s.cells.toLocaleString()} location${s.cells === 1 ? "" : "s"} on ${s.skus.toLocaleString()} SKU${s.skus === 1 ? "" : "s"}</span></div>
            ${s.cells ? `<div class="cd-values">${esc(Clear.valuesSummary(s.values, 8))}</div><div class="cd-where">${where.join(" · ")}</div>` : ""}
            ${notes.join("")}
          </div>`;
      }).join("");
      if (plan.protectedHits.length) {
        const hits = plan.protectedHits;
        const list = hits.slice(0, 4).map((h) => `${esc(h.value)} in Location ${h.slot + 1} on SKU ${esc(h.sku)}`).join("; ");
        const more = hits.length > 4 ? ` and ${hits.length - 4} more` : "";
        details += `<div class="notice info" id="protectedNote">${icon("lock")}<span><b>Left alone:</b> ${list}${more}. Location 2 and Location 3 are never cleared.</span></div>`;
      }
    }

    c.innerHTML = stepHead(2, "Codes to clear", this.codes.length > 0 && !!plan && plan.cells > 0) + `
      <div class="f-row code-entry">
        <input class="f-input code-input" id="codeInput" placeholder="e.g. 12R" autocomplete="off" spellcheck="false" aria-label="Location code to clear">
        <button class="btn btn-primary" id="codeAdd">${icon("plus")} Add</button>
      </div>
      <div class="field-error" id="codeError"></div>
      <p class="f-help" style="margin-top:8px">Clears every location that <b>starts with</b> the code — <code>12R</code> clears 12R01–12R09, <code>12R03</code> only 12R03. Add as many as you need.</p>
      ${chips ? `<div class="chips">${chips}</div>` : ""}
      ${this.codes.length > 1 ? `<button class="link small" id="codesClear">Remove all codes</button>` : ""}
      <div class="code-details">${details}</div>
      ${plan && plan.protectedHits.length ? "" : `<div class="lock-note">${icon("lock")}<span>Location 2 (flags) and Location 3 (capacity) are never cleared.</span></div>`}`;

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
    if ($("#codesClear")) $("#codesClear").onclick = () => { this.codes = []; this.saved = null; this.refresh(); };
  },

  /* ---------------- step 3: save ---------------- */

  autoName() { return Clear.importFileName(this.codes); },
  fileName() { return this.customName != null ? this.customName : this.autoName(); },

  blocker() {
    if (!this.file) return "Load the Eagle export first.";
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
        <div class="empty-state">${icon("sheet", "big-ico")}<p>Load the Eagle export to see every SKU and location that will be cleared.</p></div>`;
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

    const head = Clear.SLOT_NAMES.map((n, i) => {
      const locked = Clear.PROTECTED.includes(i);
      return `<th class="loc-h${locked ? " locked" : ""}" title="${locked ? "Never cleared" : "Cleared when it matches"}">${locked ? icon("lock") : ""}Loc ${i + 1}<small>${Clear.SLOT_ROLES[i]}</small></th>`;
    }).join("");
    const body = shown.map((r) => {
      const cells = r.before.map((v, i) => {
        if (r.cleared.includes(i)) return `<td class="loc cleared"><span class="q">?</span> <s>${esc(v)}</s></td>`;
        return `<td class="loc${Clear.PROTECTED.includes(i) ? " locked" : ""}">${esc(v)}</td>`;
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
            <td><span title="${esc(x.path || "")}">${esc(x.file)}</span>${x.source ? `<div class="muted small">from ${esc(x.source)}</div>` : ""}</td>
            <td>${(x.codes || []).map((c) => `<span class="mini-code">${esc(c)}</span>`).join(" ")}</td>
            <td class="r num">${Number(x.skus || 0).toLocaleString()}</td>
            <td class="r num">${Number(x.cells || 0).toLocaleString()}</td>
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
