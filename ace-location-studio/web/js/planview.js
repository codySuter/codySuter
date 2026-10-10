/* ============================================================
   Ace Location Studio — New Planogram view.

   1. Load the planogram PDF (read here with pdf.js; the rules for
      reading it live in pog.js).
   2. Give each section (segment) its Location 1 code.
   3. Adjust facings on the plan's own drawing or in the list — fewer
      facings scale Location 3 down; 0 drops the SKU.
   4. Save the Eagle import + label files into the export folder.

   Codes and facing changes are remembered per POG ID, so closing the
   app half-way through loses nothing.
   ============================================================ */
"use strict";

const PLAN_MEMORY = 20; // plans remembered
const CROP_TOP = 50;    // PDF points of page header hidden above the drawing
const CROP_BOTTOM = 76; // …and of the footer box below it
const CROP_SIDE = 46;   // room kept either side of the outermost labels

const PlanView = {
  doc: null,         // pdf.js document
  plan: null,        // Pog.parsePlan result
  fileName: "",
  loading: "",
  error: "",
  codes: {},         // seg → location code
  facings: {},       // sku → facings (only SKUs changed from the plan)
  selected: null,    // sku
  tab: null,         // seg number, or "cover"
  zoom: 1,           // 1 = fit the window
  filter: "",
  restored: null,    // timestamp when a saved plan was picked back up
  saved: null,       // [{ name, path }]
  saveError: "",
  saving: false,
  _renderToken: 0,
  _persistT: null,

  init() {
    const v = $("#view-plan");
    v.innerHTML = `
      <div class="view-head">
        <div>
          <h2>New Planogram</h2>
          <p>Load the planogram PDF, give each section its location, adjust facings on the drawing, and save the Eagle import and label files.</p>
        </div>
      </div>
      <div class="clear-layout">
        <div class="side">
          <div class="card step" id="planFileStep"></div>
          <div class="card step" id="planLocStep"></div>
          <div class="card step" id="planSaveStep"></div>
        </div>
        <div class="main">
          <div class="card" id="drawCard"></div>
          <div class="card" id="planListCard"></div>
        </div>
      </div>
      <input type="file" id="pogInput" accept=".pdf,application/pdf" hidden>`;
    $("#pogInput").onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (f) this.loadFile(f);
    };
    document.addEventListener("keydown", (e) => {
      if (App.view !== "plan" || !this.selected || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName)) return;
      if (e.key === "-" || e.key === "_") { e.preventDefault(); this.bump(this.selected, -1); }
      else if (e.key === "+" || e.key === "=") { e.preventDefault(); this.bump(this.selected, 1); }
      else if (e.key === "Escape") { this.select(null); }
    });
    window.addEventListener("pagehide", () => this.flush());
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.flush(); });
    let t = null;
    window.addEventListener("resize", () => {
      clearTimeout(t);
      t = setTimeout(() => { if (App.view === "plan" && this.plan) this.renderDrawing(); }, 150);
    });
    this.refresh();
  },

  /** Called when the tab is shown (the canvas needs a laid-out width). */
  shown() {
    if (this.plan) this.renderDrawing();
  },

  refresh() {
    this.renderFile();
    this.renderLocs();
    this.renderSave();
    this.renderDrawing();
    this.renderList();
  },

  /** Re-render everything that depends on facings or codes, but not the
   *  page canvas itself. */
  update() {
    this.saved = null;
    this.saveError = "";
    this.renderLocs();
    this.renderSave();
    this.renderTabs();
    this.renderHotspots();
    this.renderSelBar();
    this.renderList();
    this.persist();
  },

  item(sku) { return this.plan && this.plan.items.find((i) => i.sku === sku); },
  facingsOf(it) { return this.facings[it.sku] != null ? this.facings[it.sku] : it.facings; },

  /* ---------------- step 1: the PDF ---------------- */

  async loadFile(f) {
    this.loading = f.name;
    this.error = "";
    this.renderFile();
    try {
      if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") throw new Error("that isn't a PDF — load the planogram PDF from Ace");
      const pdfjs = await Promise.race([
        window.pdfjsReady,
        new Promise((_, reject) => setTimeout(() => reject(new Error("the app's PDF reader didn't start — close the app and open it again")), 15000)),
      ]);
      const data = new Uint8Array(await f.arrayBuffer());
      const doc = await pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
      const pages = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        pages.push({ num: n, width: vp.width, height: vp.height, items: tc.items.map(Pog.normItem) });
      }
      const plan = Pog.parsePlan(pages);
      if (!plan.items.length) throw new Error(plan.warnings[0] || "no SKUs found in this PDF");
      if (this.doc) this.doc.destroy();
      this.doc = doc;
      this.plan = plan;
      this.fileName = f.name;
      this.selected = null;
      this.filter = "";
      this.saved = null;
      this.saveError = "";
      this.tab = plan.drawings.length ? plan.drawings[0].seg : "cover";
      const mem = (Store.doc.plans || {})[plan.pogId];
      this.codes = {};
      this.facings = {};
      this.restored = null;
      if (mem) {
        for (const s of plan.segments) if (mem.codes && mem.codes[s.seg]) this.codes[s.seg] = mem.codes[s.seg];
        for (const it of plan.items) {
          const fc = mem.facings && mem.facings[it.sku];
          if (fc != null && fc >= 0 && fc < it.facings) this.facings[it.sku] = fc;
        }
        if (Object.keys(this.codes).length || Object.keys(this.facings).length) this.restored = mem.ts || Date.now();
      }
      showToast(`${icon("check")} Loaded ${esc(plan.pogId || f.name)} — ${plan.items.length} SKUs in ${plan.segments.length} section${plan.segments.length === 1 ? "" : "s"}`, { kind: "good" });
    } catch (e) {
      this.error = friendlyError(e);
    } finally {
      this.loading = "";
      this.refresh();
    }
  },

  renderFile() {
    const c = $("#planFileStep");
    const p = this.plan;
    let body;
    if (this.loading) {
      body = `<div class="file-row"><div class="spinner"></div><div><b>Reading ${esc(this.loading)}…</b></div></div>`;
    } else if (p) {
      body = `
        <div class="file-row">
          <span class="file-ico">${icon("file")}</span>
          <div class="file-meta">
            <b title="${esc(p.title)}">${esc(p.pogId || "Planogram")}${p.title ? " · " + esc(p.title) : ""}</b>
            <span id="planMeta">${p.items.length} SKUs · ${p.segments.length} section${p.segments.length === 1 ? "" : "s"}${p.liveDate ? " · live " + esc(p.liveDate) : ""}</span>
          </div>
          <button class="btn btn-secondary" id="pogChange">Change</button>
        </div>
        ${this.restored ? `<div class="notice info slim" id="planRestored">${icon("clock")}<span>Picked up where you left off (${esc(fmtDateTime(this.restored))}). <button class="link" id="planStartOver">Start over</button></span></div>` : ""}
        ${(p.warnings || []).map((w) => `<div class="notice warn slim">${icon("alert")}<span>${esc(w)}</span></div>`).join("")}`;
    } else {
      body = `
        <button class="dropzone" id="pogDrop">
          ${icon("upload", "big-ico")}
          <b>Drop the planogram PDF here</b>
          <span>or click to choose the file</span>
        </button>
        <p class="f-help" style="margin-top:10px">The planogram PDF from Ace — the app reads its product report and drawing pages. Any number of sections.</p>`;
    }
    if (this.error) body += `<div class="notice bad" id="pogError">${icon("x")}<span><b>Couldn't read that file.</b> ${esc(this.error)}</span></div>`;
    c.innerHTML = stepHead(1, "Planogram PDF", !!p) + body;
    const pick = () => $("#pogInput").click();
    if ($("#pogDrop")) $("#pogDrop").onclick = pick;
    if ($("#pogChange")) $("#pogChange").onclick = pick;
    if ($("#planStartOver")) $("#planStartOver").onclick = async () => {
      const yes = await confirmBox("Start over on this plan?", "Clears the section locations and facing changes you made for this planogram.", { okText: "Start over", danger: true });
      if (!yes) return;
      this.codes = {};
      this.facings = {};
      this.restored = null;
      this.update();
      this.renderFile();
    };
  },

  /* ---------------- step 2: section locations ---------------- */

  renderLocs() {
    const c = $("#planLocStep");
    const p = this.plan;
    if (!p) {
      c.innerHTML = stepHead(2, "Section locations", false) + `<p class="f-help">After the PDF loads, type the Location 1 code for each section of the plan (for example 12R03).</p>`;
      return;
    }
    const segs = p.segments;
    const rows = segs.map((s) => {
      const code = this.codes[s.seg] || "";
      const prob = code ? Pog.codeProblem(code) : "";
      return `
        <div class="loc-row">
          <label for="loc-${s.seg}"><b>Section ${s.seg}</b><span>${s.skus} SKU${s.skus === 1 ? "" : "s"}</span></label>
          <input class="f-input loc-input${prob ? " invalid" : ""}" id="loc-${s.seg}" data-seg="${s.seg}" value="${esc(code)}" placeholder="e.g. 12R03" maxlength="5" autocomplete="off" spellcheck="false">
          <div class="field-error${prob ? " show" : ""}" id="locErr-${s.seg}">${esc(prob)}</div>
        </div>`;
    }).join("");
    c.innerHTML = stepHead(2, "Section locations", false) + `
      <p class="f-help">Each section of the plan (left to right on the cover page) gets its own Location 1.</p>
      <div class="loc-rows">${rows}</div>
      <div id="locFillHost"></div>`;
    $$(".loc-input", c).forEach((inp) => {
      inp.addEventListener("input", () => {
        const pos = inp.selectionStart;
        inp.value = inp.value.toUpperCase();
        inp.setSelectionRange(pos, pos);
        this.codes[inp.dataset.seg] = inp.value.trim();
        if (!this.codes[inp.dataset.seg]) delete this.codes[inp.dataset.seg];
        if (inp.classList.contains("invalid")) this.showLocProblem(inp);
        this.saved = null;
        this.renderLocExtras();
        this.renderSave();
        this.renderTabs();
        this.renderList();
        this.renderSelBar();
        this.persist();
      });
      // Only flag a problem once they've moved on, so half-typed codes don't nag.
      inp.addEventListener("change", () => this.showLocProblem(inp));
      inp.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const all = $$(".loc-input", c);
        const next = all[all.indexOf(inp) + 1];
        this.showLocProblem(inp);
        if (next) next.focus();
      });
    });
    this.renderLocExtras();
  },

  showLocProblem(inp) {
    const code = inp.value.trim();
    const prob = code ? Pog.codeProblem(code) : "";
    inp.classList.toggle("invalid", !!prob);
    const err = $(`#locErr-${inp.dataset.seg}`);
    if (err) { err.textContent = prob; err.classList.toggle("show", !!prob); }
  },

  /** The parts of step 2 that follow typing without re-drawing the inputs
   *  (which would lose the cursor): the tick, the suggested codes, and
   *  the "Fill the rest" link. */
  renderLocExtras() {
    const c = $("#planLocStep");
    const p = this.plan;
    if (!c || !p) return;
    const segs = p.segments;
    const first = this.codes[segs[0].seg];
    const firstOk = first && !Pog.codeProblem(first);
    const n = $(".step-head .step-n", c);
    const allOk = segs.every((s) => !Pog.codeProblem(this.codes[s.seg]));
    if (n) { n.classList.toggle("done", allOk); n.innerHTML = allOk ? icon("check") : "2"; }
    segs.forEach((s, i) => {
      const inp = $(`#loc-${s.seg}`);
      if (inp && i > 0) inp.placeholder = (firstOk && Pog.nextCode(first, i)) || "e.g. 12R03";
    });
    const host = $("#locFillHost");
    const fillable = segs.length > 1 && firstOk && segs.slice(1).some((s) => !this.codes[s.seg]);
    host.innerHTML = fillable ? `<button class="link small" id="locFill">Fill the rest: ${segs.slice(1).map((s, i) => esc(this.codes[s.seg] || Pog.nextCode(first, i + 1) || "?")).join(", ")}</button>` : "";
    if ($("#locFill")) $("#locFill").onclick = () => {
      segs.slice(1).forEach((s, i) => { if (!this.codes[s.seg]) { const nx = Pog.nextCode(first, i + 1); if (nx) this.codes[s.seg] = nx; } });
      this.update();
    };
  },

  /* ---------------- step 3: save ---------------- */

  files() { return this.plan ? Pog.planFiles(this.plan, this.codes, this.facings) : []; },

  blocker() {
    if (!this.plan) return "Load the planogram PDF first.";
    const missing = this.plan.segments.filter((s) => Pog.codeProblem(this.codes[s.seg]));
    if (missing.length) return `Give ${missing.length === 1 ? "Section " + missing[0].seg : missing.length + " sections"} a location first.`;
    if (!Pog.planRows(this.plan.items, this.codes, this.facings).length) return "Every SKU is dropped — nothing to save.";
    return "";
  },

  renderSave() {
    const c = $("#planSaveStep");
    const blocker = this.blocker();
    const files = blocker ? [] : this.files();
    const list = files.map((f) => `
      <li><span class="pf-ico">${icon(f.kind === "import" ? "sheet" : "list")}</span>
        <span class="pf-name">${esc(f.name)}</span><span class="pf-n">${f.rows} row${f.rows === 1 ? "" : "s"}</span></li>`).join("");
    let result = "";
    if (this.saved) {
      result = `
        <div class="notice good saved-note" id="planSavedNote">${icon("check")}
          <div><b>Saved ${this.saved.length} file${this.saved.length === 1 ? "" : "s"}.</b>
            <ul class="saved-list">${this.saved.map((s) => `<li>${esc(s.name)}</li>`).join("")}</ul>
            <div class="saved-acts">
              <button class="btn btn-secondary btn-sm" id="planShow">${icon("folder")} Show in folder</button>
            </div>
          </div>
        </div>`;
    }
    if (this.saveError) result += `<div class="notice bad" id="planSaveError">${icon("x")}<span><b>Couldn't save.</b> ${esc(this.saveError)}</span></div>`;
    c.innerHTML = stepHead(3, "Save for Eagle & labels", !!this.saved) + `
      ${list ? `<ul class="plan-files" id="planFiles">${list}</ul>` : ""}
      <div class="dest-line">${icon("folder")}<span>Saves to <code id="planDest">${esc(Store.exportDir())}</code></span><button class="link small" id="planDestChange">Change</button></div>
      <button class="btn btn-primary btn-block" id="planSaveBtn" ${blocker || this.saving ? "disabled" : ""}>
        ${icon("save")} ${this.saving ? "Saving…" : files.length ? `Save ${files.length} files` : "Save files"}
      </button>
      ${blocker && !this.saved ? `<p class="f-help center" id="planBlocker" style="margin-top:8px">${esc(blocker)}</p>` : ""}
      ${result}`;
    $("#planDestChange").onclick = () => { App.show("settings"); setTimeout(() => $("#sDir") && $("#sDir").focus(), 30); };
    $("#planSaveBtn").onclick = () => this.save();
    if ($("#planShow")) $("#planShow").onclick = () => reveal(this.saved[0].path);
  },

  async save() {
    if (this.blocker() || this.saving) return;
    const files = this.files();
    const dir = Store.exportDir();
    this.saving = true;
    this.saved = null; // the "Saved" note comes back once these files are written
    this.saveError = "";
    this.renderSave();
    const post = (f, overwrite) => fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir, name: f.name, csv: f.csv, overwrite }),
    }).then(async (r) => ({ f, status: r.status, data: await r.json().catch(() => ({})) }));
    const done = [];
    try {
      const first = [];
      for (const f of files) first.push(await post(f, false));
      const conflicts = first.filter((r) => r.status === 409 && r.data.exists);
      for (const r of first) {
        if (r.status === 200 && r.data.ok) done.push({ name: r.f.name, path: r.data.path });
        else if (!(r.status === 409 && r.data.exists)) throw new Error(r.data.error || `the app answered ${r.status}`);
      }
      if (conflicts.length) {
        this.saving = false;
        this.renderSave();
        const yes = await confirmBox(conflicts.length === 1 ? "Replace the existing file?" : `Replace ${conflicts.length} existing files?`,
          `Already in <code>${esc(dir)}</code>:<br>${conflicts.map((r) => `• ${esc(r.f.name)}`).join("<br>")}`,
          { okText: conflicts.length === 1 ? "Replace it" : "Replace them", danger: true });
        this.saving = true;
        if (yes) {
          for (const r of conflicts) {
            const again = await post(r.f, true);
            if (again.status !== 200 || !again.data.ok) throw new Error(again.data.error || `the app answered ${again.status}`);
            done.push({ name: r.f.name, path: again.data.path });
          }
        } else if (done.length) {
          this.saveError = `Kept the existing ${conflicts.map((r) => r.f.name).join(", ")}; saved the rest.`;
        }
      }
      if (done.length) {
        const order = files.map((f) => f.name);
        done.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
        this.saved = done;
        const rows = Pog.planRows(this.plan.items, this.codes, this.facings);
        showToast(`${icon("check")} Saved ${done.length} file${done.length === 1 ? "" : "s"}`, { kind: "good" });
        Store.logExport({
          kind: "plan", file: files[0].name, path: (done.find((d) => d.name === files[0].name) || done[0]).path,
          codes: this.plan.segments.map((s) => Pog.codeProblem(this.codes[s.seg]) ? "" : this.codes[s.seg].toUpperCase()).filter(Boolean),
          skus: rows.length, cells: done.length, source: this.fileName,
        }).then(() => this.renderLog());
      }
    } catch (e) {
      this.saveError = friendlyError(e) + (done.length ? ` (${done.length} file${done.length === 1 ? " was" : "s were"} saved before this)` : "");
      if (done.length) this.saved = done;
    } finally {
      this.saving = false;
      this.renderSave();
    }
  },

  /* ---------------- drawing ---------------- */

  renderDrawing() {
    const c = $("#drawCard");
    const p = this.plan;
    if (!p) {
      c.innerHTML = `
        <div class="card-head"><h3>${icon("pin")} Planogram</h3></div>
        <div class="empty-state">${icon("file", "big-ico")}<p>Load the planogram PDF to see its drawing. Click a product to change its facings.</p></div>`;
      return;
    }
    c.innerHTML = `
      <div class="card-head draw-head">
        <h3>${icon("pin")} Planogram</h3>
        <div class="draw-tools">
          <div class="seg seg-tabs" id="segTabs" role="tablist"></div>
          <div class="zoom" aria-label="Zoom">
            <button class="icon-btn-sm" id="zoomOut" title="Zoom out">${icon("minus")}</button>
            <button class="zoom-fit" id="zoomFit" title="Fit the window">Fit</button>
            <button class="icon-btn-sm" id="zoomIn" title="Zoom in">${icon("plus")}</button>
          </div>
        </div>
      </div>
      <div class="sel-bar" id="selBar"></div>
      <div class="draw-scroll" id="drawScroll">
        <div class="draw-wrap" id="drawWrap"><div class="draw-loading">Drawing…</div></div>
      </div>
      <p class="f-help draw-key"><span class="key-chip k-sel"></span>selected <span class="key-chip k-red"></span>fewer facings <span class="key-chip k-drop"></span>dropped · Keys: <kbd>−</kbd> <kbd>+</kbd> change facings, <kbd>Esc</kbd> deselect</p>`;
    const setZoom = (z) => {
      this.zoom = Math.max(1, Math.min(4, Math.round(z * 4) / 4));
      $("#zoomFit").textContent = this.zoom === 1 ? "Fit" : Math.round(this.zoom * 100) + "%";
      $("#zoomOut").disabled = this.zoom <= 1;
      $("#zoomIn").disabled = this.zoom >= 4;
      this.renderPage();
    };
    $("#zoomOut").onclick = () => setZoom(this.zoom - 0.5);
    $("#zoomIn").onclick = () => setZoom(this.zoom + 0.5);
    $("#zoomFit").onclick = () => setZoom(1);
    $("#zoomFit").textContent = this.zoom === 1 ? "Fit" : Math.round(this.zoom * 100) + "%";
    $("#zoomOut").disabled = this.zoom <= 1;
    this.renderTabs();
    this.renderSelBar();
    this.renderPage();
  },

  renderTabs() {
    const host = $("#segTabs");
    if (!host || !this.plan) return;
    const tabs = this.plan.drawings.map((d) => {
      const code = this.codes[d.seg];
      const changed = this.plan.items.filter((i) => i.seg === d.seg && this.facings[i.sku] != null).length;
      return `<button data-tab="${d.seg}" class="${this.tab === d.seg ? "active" : ""}">Section ${d.seg}${code ? " · " + esc(code.toUpperCase()) : ""}${changed ? ` <span class="tab-n">${changed}</span>` : ""}</button>`;
    });
    tabs.push(`<button data-tab="cover" class="${this.tab === "cover" ? "active" : ""}">Cover picture</button>`);
    host.innerHTML = tabs.join("");
    $$("[data-tab]", host).forEach((b) => (b.onclick = () => {
      const t = b.dataset.tab === "cover" ? "cover" : Number(b.dataset.tab);
      if (t === this.tab) return;
      this.tab = t;
      this.renderTabs();
      this.renderPage();
    }));
  },

  drawingFor(tab) { return this.plan.drawings.find((d) => d.seg === tab) || null; },

  async renderPage() {
    const wrap = $("#drawWrap");
    if (!wrap || !this.doc) return;
    const token = ++this._renderToken;
    const d = this.tab === "cover" ? null : this.drawingFor(this.tab);
    const pageNum = d ? d.page : this.plan.coverPage;
    const page = await this.doc.getPage(pageNum);
    if (token !== this._renderToken) return;
    const base = page.getViewport({ scale: 1 });
    // Crop to the drawing: drop the page header/footer, and on drawing
    // pages the empty margins beside the fixture.
    let x0 = 0, x1 = base.width;
    if (d && d.labels.length) {
      x0 = Math.max(0, Math.min(...d.labels.map((l) => l.x0)) - CROP_SIDE);
      x1 = Math.min(base.width, Math.max(...d.labels.map((l) => l.x1)) + CROP_SIDE);
    }
    const top = CROP_TOP, bottom = base.height - CROP_BOTTOM;
    const cropW = x1 - x0, cropH = bottom - top;
    // Fit the whole section in view: as wide as the card allows, and no
    // taller than the window leaves room for.
    const availW = Math.max(320, ($("#drawScroll") || wrap).clientWidth - 2);
    const availH = Math.max(460, window.innerHeight - 290);
    const cssScale = Math.min(availW / cropW, availH / cropH, 3) * this.zoom;
    const dpr = window.devicePixelRatio || 1;
    const vp = page.getViewport({ scale: cssScale * dpr, offsetX: -x0 * cssScale * dpr, offsetY: -top * cssScale * dpr });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(cropW * cssScale * dpr);
    canvas.height = Math.round(cropH * cssScale * dpr);
    canvas.style.width = Math.round(cropW * cssScale) + "px";
    canvas.style.height = Math.round(cropH * cssScale) + "px";
    canvas.className = "draw-canvas";
    try {
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    } catch (e) {
      if (token === this._renderToken) wrap.innerHTML = `<div class="notice bad">${icon("x")}<span>Couldn't draw this page: ${esc(friendlyError(e))}</span></div>`;
      return;
    }
    if (token !== this._renderToken) return;
    this._view = { vp, dpr, d };
    wrap.innerHTML = "";
    wrap.style.width = canvas.style.width;
    wrap.style.height = canvas.style.height;
    wrap.appendChild(canvas);
    const layer = el("div", "hotspots");
    layer.id = "hotspots";
    wrap.appendChild(layer);
    this.renderHotspots();
    if (this.selected) this.scrollToHotspot(this.selected);
  },

  renderHotspots() {
    const layer = $("#hotspots");
    if (!layer || !this._view) return;
    const { vp, dpr, d } = this._view;
    if (!d) { layer.innerHTML = ""; return; }
    layer.innerHTML = d.labels.map((l) => {
      const it = this.item(l.sku);
      if (!it) return "";
      const r = vp.convertToViewportRectangle([l.x0, l.y0, l.x1, l.y1]);
      let left = Math.min(r[0], r[2]) / dpr, right = Math.max(r[0], r[2]) / dpr;
      let topY = Math.min(r[1], r[3]) / dpr, bot = Math.max(r[1], r[3]) / dpr;
      // Labels are small; give each a comfortable click target.
      const minW = 22, minH = 22;
      if (right - left < minW) { const cx = (left + right) / 2; left = cx - minW / 2; right = cx + minW / 2; }
      if (bot - topY < minH) { const cy = (topY + bot) / 2; topY = cy - minH / 2; bot = cy + minH / 2; }
      const fc = this.facingsOf(it);
      const cls = ["hs"];
      if (this.selected === it.sku) cls.push("sel");
      if (fc === 0) cls.push("dropped");
      else if (fc < it.facings) cls.push("reduced");
      if (it.seg !== d.seg) cls.push("other-seg");
      const badge = fc === 0 ? `<span class="hs-badge">✕</span>` : fc < it.facings ? `<span class="hs-badge">${fc}/${it.facings}</span>` : "";
      return `<button class="${cls.join(" ")}" data-sku="${esc(it.sku)}" title="${esc(it.sku)} · ${esc(it.desc)} · ${fc} of ${it.facings} facing${it.facings === 1 ? "" : "s"}" style="left:${left.toFixed(1)}px;top:${topY.toFixed(1)}px;width:${(right - left).toFixed(1)}px;height:${(bot - topY).toFixed(1)}px">${badge}</button>`;
    }).join("");
    $$(".hs", layer).forEach((b) => (b.onclick = () => this.select(b.dataset.sku)));
  },

  select(sku, opts) {
    this.selected = sku;
    if (sku && opts && opts.reveal) {
      const it = this.item(sku);
      const onTab = this.tab !== "cover" && this.drawingFor(this.tab) && this.drawingFor(this.tab).labels.some((l) => l.sku === sku);
      if (it && !onTab && this.drawingFor(it.seg)) {
        this.tab = it.seg;
        this.renderTabs();
        this.renderPage().then(() => this.scrollToHotspot(sku));
      } else {
        this.scrollToHotspot(sku);
      }
    }
    this.renderHotspots();
    this.renderSelBar();
    this.renderList();
  },

  scrollToHotspot(sku) {
    const b = $(`#hotspots .hs[data-sku="${CSS.escape(sku)}"]`);
    if (b) b.scrollIntoView({ block: "nearest", inline: "nearest" });
  },

  renderSelBar() {
    const c = $("#selBar");
    if (!c) return;
    const it = this.selected && this.item(this.selected);
    if (!it) {
      c.className = "sel-bar empty";
      c.innerHTML = `${icon("info")}<span>Click a product on the drawing (or a row in the list) to change its facings.</span>`;
      return;
    }
    const fc = this.facingsOf(it);
    const cap = Pog.capacity(it.rec, it.facings, fc);
    const code = this.codes[it.seg] ? this.codes[it.seg].toUpperCase() : "";
    const where = [`Section ${it.seg}${code ? " · " + esc(code) : ""}`];
    if (it.row) where.push(`peg row ${esc(it.row)}, col ${esc(it.col)}`);
    else if (it.peg) where.push(esc(it.peg.toLowerCase()));
    let capText;
    if (fc === 0) capText = `<b class="drop-text">Dropped</b> — not in the import or labels`;
    else if (it.rec == null) capText = "No REC QTY — Location 3 left blank";
    else if (cap !== it.rec) capText = `Shelf cap (Loc 3): <s>${it.rec}</s> → <b id="selCap">${cap}</b>`;
    else capText = `Shelf cap (Loc 3): <b id="selCap">${cap}</b>`;
    c.className = "sel-bar";
    c.innerHTML = `
      <div class="sel-main">
        <div class="sel-sku" title="${esc(it.sku)} ${esc(it.desc)}"><b>${esc(it.sku)}</b> ${esc(it.desc)}</div>
        <div class="sel-where" title="${where.join(" · ")}">${where.join(" · ")}</div>
      </div>
      <div class="facing-ctl">
        <button class="fc-step" id="selMinus" title="One less facing (−)" ${fc <= 0 ? "disabled" : ""}>${icon("minus")}</button>
        <div class="fc-num"><b id="selFacings">${fc}</b><span>of ${it.facings} facing${it.facings === 1 ? "" : "s"}</span></div>
        <button class="fc-step" id="selPlus" title="One more facing (+)" ${fc >= it.facings ? "disabled" : ""}>${icon("plus")}</button>
      </div>
      <div class="sel-cap">
        <div class="sel-cap-text">${capText}</div>
        <button class="link small sel-reset" id="selReset" ${fc === it.facings ? `disabled tabindex="-1"` : ""}>Back to plan</button>
      </div>
      <button class="icon-btn-sm" id="selClose" title="Deselect (Esc)">${icon("x")}</button>`;
    $("#selMinus").onclick = () => this.bump(it.sku, -1);
    $("#selPlus").onclick = () => this.bump(it.sku, 1);
    $("#selClose").onclick = () => this.select(null);
    $("#selReset").onclick = () => this.setFacings(it.sku, it.facings);
  },

  bump(sku, delta) {
    const it = this.item(sku);
    if (it) this.setFacings(sku, this.facingsOf(it) + delta);
  },

  setFacings(sku, n) {
    const it = this.item(sku);
    if (!it) return;
    const v = Math.max(0, Math.min(it.facings, n));
    if (v === it.facings) delete this.facings[sku];
    else this.facings[sku] = v;
    this.update();
  },

  /* ---------------- list ---------------- */

  renderList() {
    const c = $("#planListCard");
    const p = this.plan;
    if (!p) { c.style.display = "none"; return; }
    c.style.display = "";
    const q = this.filter.trim().toUpperCase();
    const segOrder = new Map(p.segments.map((s, i) => [s.seg, i]));
    let items = p.items.map((it, i) => ({ it, i })).sort((a, b) => segOrder.get(a.it.seg) - segOrder.get(b.it.seg) || a.i - b.i).map((x) => x.it);
    if (q) items = items.filter((it) => it.sku.includes(q) || it.desc.toUpperCase().includes(q) || it.upc.includes(q));
    const changed = p.items.filter((it) => this.facings[it.sku] != null && this.facings[it.sku] > 0).length;
    const dropped = p.items.filter((it) => this.facings[it.sku] === 0).length;
    const rows = items.map((it) => {
      const fc = this.facingsOf(it);
      const cap = Pog.capacity(it.rec, it.facings, fc);
      const code = this.codes[it.seg] ? this.codes[it.seg].toUpperCase() : "";
      const cls = [this.selected === it.sku ? "sel" : "", fc === 0 ? "dropped" : fc < it.facings ? "reduced" : ""].join(" ");
      return `
        <tr class="${cls}" data-sku="${esc(it.sku)}">
          <td class="sku">${esc(it.sku)}</td>
          <td class="desc" title="${esc(it.desc)}">${esc(it.desc)}</td>
          <td class="nowrap">${it.seg}${code ? ` <span class="mini-code">${esc(code)}</span>` : ""}</td>
          <td class="center"><div class="mini-facing">
            <button class="fc-step sm" data-bump="-1" ${fc <= 0 ? "disabled" : ""} title="One less facing">${icon("minus")}</button>
            <b>${fc}</b><span>/${it.facings}</span>
            <button class="fc-step sm" data-bump="1" ${fc >= it.facings ? "disabled" : ""} title="One more facing">${icon("plus")}</button>
          </div></td>
          <td class="r num">${it.rec == null ? `<span class="muted">—</span>` : it.rec}</td>
          <td class="r num cap">${fc === 0 ? `<span class="drop-text">dropped</span>` : cap == null ? `<span class="muted">blank</span>` : cap !== it.rec ? `<b class="cap-new">${cap}</b>` : cap}</td>
        </tr>`;
    }).join("");
    const scroller = $(".plan-scroll", c);
    const scrollTop = scroller ? scroller.scrollTop : 0;
    c.innerHTML = `
      <div class="card-head">
        <h3>${icon("list")} SKUs in the plan</h3>
        <div class="prev-tools">
          <span class="muted small" id="planCounts">${p.items.length} SKUs${changed ? ` · ${changed} with fewer facings` : ""}${dropped ? ` · ${dropped} dropped` : ""}</span>
          <label class="search">${icon("search")}<input class="f-input" id="planFilter" placeholder="Find SKU or item" value="${esc(this.filter)}"></label>
        </div>
      </div>
      <div class="tbl-scroll plan-scroll">
        <table class="tbl compact plan-tbl" id="planTable">
          <thead><tr><th>SKU</th><th>Description</th><th>Section</th><th class="center c-fac">Facings</th><th class="r c-rec">REC QTY</th><th class="r c-cap">Loc 3</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="6" class="center muted">Nothing matches that search.</td></tr>`}</tbody>
        </table>
      </div>`;
    // Redrawing the list must not scroll it back to the top — the row whose
    // facings you just changed (and its − / + buttons) stays where it was.
    $(".plan-scroll", c).scrollTop = scrollTop;
    $$("#planTable tbody tr[data-sku]").forEach((tr) => {
      tr.onclick = (e) => {
        const b = e.target.closest("[data-bump]");
        if (b) { e.stopPropagation(); this.selected = tr.dataset.sku; this.bump(tr.dataset.sku, Number(b.dataset.bump)); return; }
        this.select(tr.dataset.sku, { reveal: true });
      };
    });
    const fi = $("#planFilter");
    fi.oninput = () => {
      this.filter = fi.value;
      const pos = fi.selectionStart;
      this.renderList();
      const n = $("#planFilter");
      n.focus();
      n.setSelectionRange(pos, pos);
    };
  },

  renderLog() { /* the saved-files list lives on the Clear Locations tab */ ClearView.renderLog(); },

  /* ---------------- memory ---------------- */

  /** Record the plan's codes and facings in the saved document right
   *  away (so any other save carries them too), and save it shortly — or
   *  at once if the window is closing (see init). */
  persist() {
    if (!this.plan || !this.plan.pogId) return;
    const plans = Store.doc.plans || (Store.doc.plans = {});
    plans[this.plan.pogId] = { codes: Object.assign({}, this.codes), facings: Object.assign({}, this.facings), ts: Date.now() };
    const keys = Object.keys(plans).sort((a, b) => (plans[b].ts || 0) - (plans[a].ts || 0));
    keys.slice(PLAN_MEMORY).forEach((k) => delete plans[k]);
    clearTimeout(this._persistT);
    this._persistT = setTimeout(() => { this._persistT = null; Store.save(); }, 300);
  },

  /** Send a save that's still waiting, before the page goes away. */
  flush() {
    if (!this._persistT) return;
    clearTimeout(this._persistT);
    this._persistT = null;
    Store.save({ keepalive: true });
  },
};
