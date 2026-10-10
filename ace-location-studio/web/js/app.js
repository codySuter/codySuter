/* ============================================================
   Ace Location Studio — boot, tabs, heartbeat, and self-update
   (the same "Update & Restart" flow as Ace Sign Studio).
   ============================================================ */
"use strict";

const DOWNLOAD_URL = "https://github.com/codysuter/codysuter/releases/download/ace-location-studio-windows/AceLocationStudio.exe";

const App = {
  view: "home",
  workflow: null,  // the open workflow's id (see workflows.js)
  lastStep: "clear",
  views: { home: HomeView, clear: ClearView, plan: PlanView, settings: SettingsView },

  /** Open a workflow at its first step. */
  openWorkflow(id) {
    if (!WORKFLOW[id]) return;
    this.workflow = id;
    ClearView.setWorkflow(id);
    this.show(WORKFLOW[id].steps[0].view);
  },

  show(name) {
    if (name === "workflow") name = this.workflow ? this.lastStep : "home";
    const w = this.workflow && WORKFLOW[this.workflow];
    // A view outside the open workflow's steps goes back to the menu.
    if ((name === "clear" || name === "plan") && !(w && w.steps.some((s) => s.view === name))) name = "home";
    if (!this.views[name]) name = "home";
    this.view = name;
    if (name === "clear" || name === "plan") this.lastStep = name;
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
    const inFlow = name === "clear" || name === "plan";
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name || (inFlow && t.dataset.view === "workflow")));
    const tab = $("#wfTab");
    tab.hidden = !w;
    if (w) tab.innerHTML = `${icon(w.icon)}${esc(w.title)}`;
    FlowBar.render();
    if (name === "home") HomeView.render();
    if (name === "settings") SettingsView.render();
    if (name === "plan") PlanView.shown();
    if (name === "clear") ClearView.checkWatch();
    $("#work").scrollTop = 0;
  },

  refreshAll(opts) {
    for (const [k, v] of Object.entries(this.views)) {
      if (opts && opts.skipSettings && k === "settings") continue;
      try { v.refresh(); } catch (e) { console.error(k, e); }
    }
  },
};

window.addEventListener("DOMContentLoaded", async () => {
  startHeartbeat();
  // Health first: the default export folder comes from the backend.
  try {
    const h = await fetch("/api/health", { cache: "no-store" }).then((r) => r.json());
    window.__appVersion = h.version;
    window.__dataDir = h.dataDir;
    window.__defaultExportDir = h.defaultExportDir;
    window.__defaultWatchDir = h.defaultWatchDir;
    window.__defaultCompassExe = h.defaultCompassExe;
    $("#verTag").textContent = "v" + h.version;
  } catch (e) { /* the conn bar will say so */ }
  await Store.load();
  $("#storeLineTop").textContent = Store.settings.storeLine;
  ClearView.init();
  PlanView.init();
  SettingsView.init();
  HomeView.init();
  $$(".tab").forEach((t) => (t.onclick = () => App.show(t.dataset.view)));
  App.show("home"); // always start at the workflow menu
  checkForUpdate();
  // Keyboard: Ctrl+1 workflows, Ctrl+2 back to the open workflow, Ctrl+3 settings.
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && ["1", "2", "3"].includes(e.key)) {
      e.preventDefault();
      App.show(["home", "workflow", "settings"][Number(e.key) - 1]);
    }
  });
});

/* Heartbeat: tells the backend the window is still open. Worker timers
   aren't throttled in minimized windows, so the ping runs in a tiny inline
   worker; repeated failures show a "relaunch the app" banner. */
let _connFails = 0;
function reportPing(ok) {
  _connFails = ok ? 0 : _connFails + 1;
  const bar = $("#connBar");
  if (!bar) return;
  if (ok) bar.classList.remove("show");
  else if (_connFails >= 3) bar.classList.add("show");
}

function startHeartbeat() {
  const PING_MS = 20000;
  const RETRY_MS = 2000;
  const pingURL = location.origin + "/__ping";
  const pingNow = () => fetch(pingURL, { cache: "no-store" }).then(() => reportPing(true)).catch(() => reportPing(false));
  try {
    const src = `const PING_MS = ${PING_MS}, RETRY_MS = ${RETRY_MS};
      let timer = null;
      const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(beat, ms); };
      function beat() {
        try {
          fetch(${JSON.stringify(pingURL)}, { cache: "no-store" })
            .then(() => { postMessage(true); schedule(PING_MS); })
            .catch(() => { postMessage(false); schedule(RETRY_MS); });
        } catch (e) { postMessage(false); schedule(RETRY_MS); }
      }
      beat();`;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    w.onmessage = (e) => reportPing(!!e.data);
    w.onerror = () => { try { w.terminate(); } catch (_) {} setInterval(pingNow, PING_MS); };
  } catch (e) {
    setInterval(pingNow, PING_MS);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pingNow(); });
}

/* ---------------- self-update ---------------- */
async function checkForUpdate() {
  let st;
  try {
    st = await fetch("/api/update/check").then((r) => r.json());
  } catch (e) { return; }
  renderUpdateBar(st);
}

function renderUpdateBar(st) {
  const bar = $("#updateBar");
  if (!st || !st.available) { if (bar) bar.classList.remove("show"); return; }
  bar.querySelector("#updateText").innerHTML =
    `<b>Update available</b> — v${esc(st.latest)} is ready (you have v${esc(st.current)}).` +
    (st.notes ? ` <span class="upd-notes">${esc(st.notes)}</span>` : "");
  const btn = bar.querySelector("#updateBtn");
  if (!st.canApply) {
    btn.textContent = "Download";
    btn.onclick = () => window.open(DOWNLOAD_URL, "_blank");
  } else {
    btn.textContent = "Update & Restart";
    btn.onclick = () => applyUpdate(btn, bar);
  }
  bar.querySelector("#updateDismiss").onclick = () => bar.classList.remove("show");
  bar.classList.add("show");
}

async function applyUpdate(btn, bar) {
  btn.disabled = true;
  btn.textContent = "Downloading…";
  bar.querySelector("#updateDismiss").style.display = "none";
  try {
    const res = await fetch("/api/update/apply", { method: "POST" }).then((r) => r.json());
    if (!res.ok) throw new Error(res.error || "update failed");
    bar.querySelector("#updateText").innerHTML = `<b>Updating to v${esc(res.version)}…</b> The app will reopen in a moment. You can close this window.`;
    btn.style.display = "none";
    let tries = 0;
    const poll = setInterval(async () => {
      tries++;
      try {
        const h = await fetch("/api/health", { cache: "no-store" }).then((r) => r.json());
        if (h && h.version === res.version) { clearInterval(poll); location.reload(); }
      } catch (e) { /* server restarting */ }
      if (tries > 40) clearInterval(poll);
    }, 1000);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "Retry";
    bar.querySelector("#updateText").innerHTML = `<b>Update failed:</b> ${esc(e.message)}. You can download it manually instead.`;
  }
}

/* Settings → Updates: on-demand check + the version history. */
function initSettingsUpdates() {
  const status = $("#settingsUpdateStatus");
  const btn = $("#settingsUpdateBtn");
  if (!status || !btn) return;
  status.textContent = window.__appVersion ? `You have v${window.__appVersion}.` : "";
  btn.onclick = async () => {
    btn.disabled = true;
    status.textContent = "Checking…";
    try {
      const st = await fetch("/api/update/check", { cache: "no-store" }).then((r) => r.json());
      if (st.available) status.textContent = `v${st.latest} is available — use the “${st.canApply ? "Update & Restart" : "Download"}” banner at the top.`;
      else if (st.error) status.textContent = `Couldn't check for updates: ${st.error}. Are you online?`;
      else status.textContent = `You're up to date — v${st.current} is the latest.`;
      if (!st.error) renderUpdateBar(st);
    } catch (e) {
      status.textContent = "Couldn't check for updates: " + friendlyError(e) + ".";
    } finally {
      btn.disabled = false;
    }
  };
  const list = $("#changelogList");
  if (!list || typeof CHANGELOG === "undefined") return;
  list.innerHTML = "";
  for (const entry of CHANGELOG) {
    const head = el("div", "cl-head");
    head.appendChild(el("span", "cl-version", "v" + esc(entry.version)));
    if (entry.version === window.__appVersion) head.appendChild(el("span", "cl-current", "installed"));
    if (entry.date) head.appendChild(el("span", "cl-date", esc(entry.date)));
    list.appendChild(head);
    const ul = el("ul", "cl-notes");
    for (const n of entry.notes) ul.appendChild(el("li", null, esc(n)));
    list.appendChild(ul);
  }
}
