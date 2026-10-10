/* ============================================================
   Ace Location Studio — the workflows and the start menu.

   Each workflow is a curated way of using the same tools: which
   locations its codes search, whether a code can change a location
   instead of clearing it, what its import files are called, and whether
   a New Planogram step follows. Every workflow saves the same
   six-location Eagle import file.
   ============================================================ */
"use strict";

const WORKFLOWS = [
  {
    id: "planogram",
    title: "Planogram Change",
    icon: "pin",
    blurb: "Clear the old locations for the section being reset, then give every SKU on the new planogram its location, shelf capacity and labels.",
    searches: "Location 1 and overstock 4, 5, 6",
    slots: [0, 3, 4, 5],     // fixed: Location 2 (flags) and 3 (capacity) are never touched
    change: false,
    tag: "LOCCLEAR",
    steps: [
      { view: "clear", label: "Clear old locations" },
      { view: "plan", label: "New planogram" },
    ],
    head: "Clear old locations",
    codesTitle: "Codes to clear",
    lead: "Type the codes for the section being reset. Location 1 and the overstock locations (4–6) that start with a code are cleared; Location 2 (flags) and 3 (capacity) are never touched.",
    lockNote: "This workflow searches Location 1 and overstock 4–6 — Location 2 (flags) and Location 3 (capacity) are never touched.",
  },
  {
    id: "opti",
    title: "OPTI Clear",
    icon: "boxes",
    blurb: "Clear overstock locations that match — Locations 4, 5 and 6 only. The shelf location, flags and capacity are never touched.",
    searches: "Overstock 4, 5, 6 only",
    slots: [3, 4, 5],
    change: false,
    tag: "OPTICLEAR",
    steps: [{ view: "clear", label: "Clear overstock" }],
    head: "OPTI Clear",
    codesTitle: "Overstock codes to clear",
    lead: "Type the overstock codes to clear. Only Locations 4, 5 and 6 are searched; Location 1 (shelf), 2 (flags) and 3 (capacity) are never touched.",
    lockNote: "OPTI Clear only searches overstock — Locations 1, 2 and 3 are never touched.",
  },
  {
    id: "custom",
    title: "Custom Location Change",
    icon: "sliders",
    blurb: "Search any location, then clear it or change it to a new location — you choose the locations and the action for each code.",
    searches: "Any of Locations 1–6, per code",
    slots: null,             // chosen per code (default 1, 4, 5, 6)
    change: true,
    tag: "LOCCHANGE",
    steps: [{ view: "clear", label: "Change locations" }],
    head: "Custom Location Change",
    codesTitle: "Codes to search",
    lead: "Type a code, pick the locations it searches (L1–L6), then choose Clear or Change to a new location.",
    lockNote: "Location 2 (flags) and Location 3 (capacity) are left alone unless you tick them for a code.",
  },
];
const WORKFLOW = Object.fromEntries(WORKFLOWS.map((w) => [w.id, w]));

/* ---------------- the start menu ---------------- */

const HomeView = {
  init() {
    this.render();
  },

  refresh() {
    if (App.view === "home") this.renderData();
  },

  render() {
    const v = $("#view-home");
    v.innerHTML = `
      <div class="view-head">
        <div>
          <h2>What are you working on?</h2>
          <p>Pick a workflow. Each one saves the same six-location Eagle import file into <code id="homeDest">${esc(Store.exportDir())}</code>.</p>
        </div>
      </div>
      <div class="wf-grid">
        ${WORKFLOWS.map((w) => `
          <button class="card wf-card" data-workflow="${w.id}">
            <span class="wf-ico">${icon(w.icon)}</span>
            <span class="wf-title">${esc(w.title)}</span>
            <span class="wf-blurb">${esc(w.blurb)}</span>
            <span class="wf-meta"><span class="wf-search">${icon("search")} ${esc(w.searches)}</span>
              ${w.steps.length > 1 ? `<span class="wf-steps">${w.steps.map((s, i) => `${i + 1}. ${esc(s.label)}`).join(" → ")}</span>` : ""}
              ${w.change ? `<span class="wf-steps">Clear or change</span>` : ""}</span>
            <span class="wf-go">Start ${icon("next")}</span>
          </button>`).join("")}
      </div>
      <div class="card home-data" id="homeData"></div>`;
    $$("[data-workflow]", v).forEach((b) => (b.onclick = () => App.openWorkflow(b.dataset.workflow)));
    this.renderData();
  },

  /** Where the location data stands (shared by every workflow). */
  renderData() {
    const c = $("#homeData");
    if (!c) return;
    const f = ClearView.file, src = ClearView.source;
    let line;
    if (f && src && src.kind === "watch") {
      line = `${icon("refresh")} <span><b>Location data ready:</b> ${esc(f.name)}, saved by Compass ${esc(whenText(src.modified))} (${esc(agoText(src.modified))}) — ${f.rows.length.toLocaleString()} SKUs.</span>`;
    } else if (f) {
      line = `${icon("sheet")} <span><b>Location data loaded:</b> ${esc(f.name)} — ${f.rows.length.toLocaleString()} SKUs.</span>`;
    } else if (Store.settings.watchOn) {
      line = `${icon("info")} <span>No location data yet — it loads by itself from the Compass export folder, or drop an export in a workflow.</span>`;
    } else {
      line = `${icon("info")} <span>No location data yet — drop an Eagle or Compass export in a workflow.</span>`;
    }
    c.innerHTML = `<div class="home-line">${line}</div>`;
    const d = $("#homeDest");
    if (d) d.textContent = Store.exportDir();
  },
};

/* ---------------- the bar above a workflow ---------------- */

const FlowBar = {
  render() {
    const bar = $("#flowBar");
    const w = App.workflow && WORKFLOW[App.workflow];
    const inFlow = w && (App.view === "clear" || App.view === "plan");
    bar.classList.toggle("show", !!inFlow);
    if (!inFlow) { bar.innerHTML = ""; return; }
    const idx = Math.max(0, w.steps.findIndex((s) => s.view === App.view));
    const steps = w.steps.length > 1 ? `<ol class="flow-steps">${w.steps.map((s, i) => `
        <li><button class="flow-step${i === idx ? " active" : ""}${i < idx ? " done" : ""}" data-step="${s.view}">
          <span class="fs-n">${i < idx ? icon("check") : i + 1}</span>${esc(s.label)}</button></li>`).join(`<li class="fs-sep">${icon("next")}</li>`)}</ol>` : "";
    const next = w.steps[idx + 1], back = w.steps[idx - 1];
    bar.innerHTML = `
      <button class="btn btn-ghost btn-sm" id="flowHome">${icon("back")} Workflows</button>
      <span class="flow-title">${icon(w.icon)} ${esc(w.title)}</span>
      ${steps}
      <span class="spacer"></span>
      ${back ? `<button class="btn btn-secondary btn-sm" id="flowBack">${icon("back")} ${esc(back.label)}</button>` : ""}
      ${next ? `<button class="btn btn-primary btn-sm" id="flowNext">Next: ${esc(next.label)} ${icon("next")}</button>` : ""}`;
    $("#flowHome").onclick = () => App.show("home");
    $$("[data-step]", bar).forEach((b) => (b.onclick = () => App.show(b.dataset.step)));
    if ($("#flowNext")) $("#flowNext").onclick = () => App.show(next.view);
    if ($("#flowBack")) $("#flowBack").onclick = () => App.show(back.view);
  },
};
