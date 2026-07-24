/* ============================================================
   Support & feedback: bug reports / feature requests emailed to
   csuter@snydersace.net, with auto-gathered diagnostics.
   ============================================================ */
"use strict";

/* Ring buffer of recent runtime errors for troubleshooting. */
const _recentErrors = [];
function recordError(kind, detail) {
  _recentErrors.push(`${new Date().toISOString()} [${kind}] ${String(detail).slice(0, 300)}`);
  if (_recentErrors.length > 25) _recentErrors.shift();
}
window.addEventListener("error", (e) => recordError("error", e.message + " @ " + (e.filename || "") + ":" + (e.lineno || "")));
window.addEventListener("unhandledrejection", (e) => recordError("promise", (e.reason && e.reason.message) || e.reason));

let _supportKind = "bug";

async function gatherDiagnostics() {
  const lines = [];
  lines.push("App version: " + (window.__appVersion || "unknown"));
  lines.push("URL: " + location.href);
  lines.push("User agent: " + navigator.userAgent);
  lines.push("Platform: " + (navigator.platform || "?") + " · language: " + (navigator.language || "?"));
  lines.push("Screen: " + screen.width + "×" + screen.height + " · window: " + window.innerWidth + "×" + window.innerHeight);
  const s = (typeof Settings !== "undefined" && Settings.get()) || {};
  lines.push("Store #: " + (s.storeCode || "?") + " · store line: " + (s.storeLine || ""));
  lines.push("Cut guides: " + s.cutGuides + " · margin: " + s.margin + " · template SKU: " + s.templateSku);

  // Current editor context
  if (typeof App !== "undefined") {
    lines.push("");
    lines.push("View: " + App.view + " · sign type: " + (App.typeId || "-") + " · size: " + (App.sizeId || "-"));
    if (App.spec) {
      const spec = Object.assign({}, App.spec);
      if (spec.image) spec.image = "[image " + (spec.image.length) + " chars, " + spec.image.slice(0, 24) + "…]";
      lines.push("Editor spec: " + JSON.stringify(spec).slice(0, 500));
    }
  }

  // Queue summary
  if (typeof Queue !== "undefined" && Queue.items) {
    lines.push("");
    lines.push("Queue: " + Queue.items.length + " sign(s)");
    Queue.items.slice(0, 15).forEach((q, i) => {
      const t = (typeof typeById === "function" && typeById(q.typeId)) || {};
      lines.push(`  ${i + 1}. ${t.label || q.typeId} · ${q.sizeId} · ${(q.spec && (q.spec.name || q.spec.category)) || ""}`.slice(0, 120));
    });
    try {
      const packed = packQueue(Queue.packable(), { margin: s.margin || 0.375 });
      lines.push("Optimized layout: " + packed.pages.length + " sheet(s)");
    } catch (e) {}
  }

  // Last lookup diagnostics
  if (typeof lastDiagnostics !== "undefined" && lastDiagnostics && lastDiagnostics.length) {
    lines.push("");
    lines.push("Last lookup diagnostics:");
    lastDiagnostics.forEach((d) => lines.push("  - " + d));
  }

  // Recent runtime errors
  lines.push("");
  lines.push("Recent errors (" + _recentErrors.length + "):");
  if (_recentErrors.length) _recentErrors.forEach((e) => lines.push("  " + e));
  else lines.push("  none");

  return lines.join("\n");
}

function openSupport() {
  _supportKind = "bug";
  syncSupportKind();
  $("#supportSummary").value = "";
  $("#supportMessage").value = "";
  showMsgEl($("#supportMsgPanel"), "", "");
  gatherDiagnostics().then((d) => { $("#supportDiagPreview").textContent = d; });
  $("#supportModal").classList.add("show");
}

function syncSupportKind() {
  $$("#supportKind .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.kind === _supportKind));
  const bug = _supportKind === "bug";
  $("#supportSummaryLabel").textContent = bug ? "What went wrong? (short summary)" : "What would you like? (short summary)";
  $("#supportMsgLabel").textContent = bug ? "Details" : "Describe the feature or change";
  $("#supportMessage").placeholder = bug
    ? "What did you do, what did you expect, and what happened instead?"
    : "What should it do, and how would it help in the store?";
  $("#supportDiagRow").style.display = bug ? "flex" : "flex";
}

function showMsgEl(el, cls, text) {
  if (!el) return;
  el.className = "msg" + (cls ? " show " + cls : "");
  el.textContent = text;
}

async function buildSupportPayload() {
  const includeDiag = $("#supportDiag").checked;
  return {
    kind: _supportKind,
    summary: $("#supportSummary").value.trim(),
    message: $("#supportMessage").value.trim(),
    fromName: $("#supportName").value.trim(),
    diagnostics: includeDiag ? await gatherDiagnostics() : "",
    when: new Date().toLocaleString(),
  };
}

async function sendSupport() {
  const payload = await buildSupportPayload();
  if (!payload.summary && !payload.message) {
    showMsgEl($("#supportMsgPanel"), "err", "Please add a short summary or some details first.");
    return;
  }
  const btn = $("#supportSend");
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = "Sending…";
  try {
    const res = await fetch("/api/support", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => r.json());

    if (res.emailed) {
      showMsgEl($("#supportMsgPanel"), "ok", "Sent to csuter@snydersace.net — thank you! A copy was saved on this PC.");
    } else if (res.mailto) {
      showMsgEl($("#supportMsgPanel"), "ok", "Opening your email app — just press Send. (A copy was saved on this PC" + (res.savedPath ? "." : "") + ")");
      window.location.href = res.mailto;
    } else {
      showMsgEl($("#supportMsgPanel"), "warn", "Saved on this PC" + (res.savedPath ? ": " + res.savedPath : "") + ". Couldn't open email automatically — use Copy report and email it to csuter@snydersace.net.");
    }
  } catch (e) {
    showMsgEl($("#supportMsgPanel"), "err", "Couldn't submit: " + friendlyError(e) + ". Use Copy report and email it manually.");
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

async function copySupportReport() {
  const payload = await buildSupportPayload();
  const kindLabel = payload.kind === "feature" ? "Feature Request" : "Bug Report";
  const text =
    `Ace Sign Studio — ${kindLabel}\n` +
    `Summary: ${payload.summary}\nFrom: ${payload.fromName || "-"}\n\n` +
    `--- Description ---\n${payload.message}\n` +
    (payload.diagnostics ? `\n--- Diagnostics ---\n${payload.diagnostics}\n` : "");
  try {
    await navigator.clipboard.writeText(text);
    showMsgEl($("#supportMsgPanel"), "ok", "Report copied — paste it into an email to csuter@snydersace.net.");
  } catch (e) {
    // fallback: select into a temporary textarea
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); showMsgEl($("#supportMsgPanel"), "ok", "Report copied."); }
    catch (_) { showMsgEl($("#supportMsgPanel"), "warn", "Couldn't copy automatically."); }
    ta.remove();
  }
}

function initSupport() {
  const btn = $("#supportBtn");
  if (btn) btn.onclick = openSupport;
  $$("#supportKind .seg-btn").forEach((b) => (b.onclick = () => { _supportKind = b.dataset.kind; syncSupportKind(); gatherDiagnostics().then((d) => { $("#supportDiagPreview").textContent = d; }); }));
  $("#supportSend").onclick = sendSupport;
  $("#supportCopy").onclick = copySupportReport;
}
