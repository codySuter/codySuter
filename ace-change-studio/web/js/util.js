/* ============================================================
   Ace Change Studio — small DOM helpers, icons, dialogs, toasts,
   and the bill / coin / roll pictures used across the app.
   ============================================================ */
"use strict";

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------------- dates ---------------- */
function todayISO(d) {
  const x = d || new Date();
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}
function parseISODate(s) {
  const [y, m, d] = String(s).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function fmtDate(iso, opts) {
  if (!iso) return "";
  return parseISODate(iso).toLocaleDateString("en-US", opts || { weekday: "short", month: "short", day: "numeric" });
}
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function fmtDateTime(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + " · " + fmtTime(ts);
}
function daysAgoText(iso) {
  const days = Math.round((parseISODate(todayISO()) - parseISODate(iso)) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/* ---------------- icons (inline SVG, currentColor) ---------------- */
const ICONS = {
  drawer: '<path d="M3 7h18v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7l2-3h14l2 3"/><path d="M9 12h6"/>',
  box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
  chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  alert: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  x: '<path d="M18 6L6 18"/><path d="M6 6l12 12"/>',
  up: '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
  down: '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>',
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  spark: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/>',
  bank: '<path d="M3 21h18"/><path d="M5 21V10"/><path d="M19 21V10"/><path d="M9 21V10"/><path d="M15 21V10"/><path d="M12 3l9 5H3z"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  swap: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  refresh: '<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
};
function icon(name, cls) {
  return `<svg class="ico ${cls || ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

/* ---------------- flag badges (status: icon + label, never color alone) ---- */
function overShortWord(cents) {
  if (cents === 0) return "Balanced";
  return cents > 0 ? "Over" : "Short";
}
function flagIcon(level) {
  return level === "good" ? icon("check") : level === "warn" ? icon("alert") : icon("x");
}
function osBadge(cents, flags, opts) {
  const level = Cash.flagLevel(cents, flags);
  const word = overShortWord(cents);
  const amt = cents === 0 ? "" : " " + Cash.money(Math.abs(cents));
  return `<span class="os-badge ${level}${opts && opts.big ? " big" : ""}">${flagIcon(level)}<span>${word}${amt}</span></span>`;
}

/* ---------------- money pictures ----------------
   A bill is a small landscape note, a coin a disc sized like the real
   thing (dime < nickel < quarter), a roll a wrapped capsule. */
function moneyPic(id, size) {
  const d = Cash.DENOM[id];
  const s = size || "";
  if (!d) return "";
  if (d.kind === "bill") {
    const n = d.cents / 100;
    return `<span class="pic bill ${s} ${n >= 20 ? "big" : ""}"><span class="bill-num">${n}</span></span>`;
  }
  if (d.kind === "roll") {
    const coin = { rq: "25¢", rd: "10¢", rn: "5¢" }[id];
    return `<span class="pic roll ${s} roll-${id}"><span>${coin}</span></span>`;
  }
  const label = { cq: "25", cd: "10", cn: "5" }[id];
  return `<span class="pic coin ${s} coin-${id}"><span>${label}</span></span>`;
}

/* ---------------- toasts ---------------- */
function showToast(msg, opts) {
  const host = $("#toastHost");
  const t = el("div", "toast" + (opts && opts.kind ? " " + opts.kind : ""));
  t.innerHTML = `<span>${msg}</span>`;
  if (opts && opts.undo) {
    const b = el("button", "toast-undo", "Undo");
    b.onclick = () => { opts.undo(); t.remove(); };
    t.appendChild(b);
  }
  host.appendChild(t);
  setTimeout(() => t.remove(), (opts && opts.ms) || (opts && opts.undo ? 7000 : 3200));
}

/* ---------------- dialogs ----------------
   Styled replacements for prompt/confirm (the app window's native ones
   look out of place and can't be themed). */
function dialog({ title, body, input, okText, cancelText, danger }) {
  return new Promise((resolve) => {
    const back = el("div", "modal-back show");
    const box = el("div", "modal small");
    box.innerHTML = `
      <div class="modal-head"><h2>${esc(title)}</h2></div>
      <div class="modal-body">
        ${body ? `<p class="dlg-body">${body}</p>` : ""}
        ${input ? `<input class="f-input" id="dlgInput" placeholder="${esc(input.placeholder || "")}" value="${esc(input.value || "")}">` : ""}
      </div>
      <div class="modal-foot">
        ${cancelText === null ? "" : `<button class="btn btn-secondary" data-act="cancel">${esc(cancelText || "Cancel")}</button>`}
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-act="ok">${esc(okText || "OK")}</button>
      </div>`;
    back.appendChild(box);
    document.body.appendChild(back);
    const inp = $("#dlgInput", box);
    const done = (v) => { back.remove(); document.removeEventListener("keydown", onKey, true); resolve(v); };
    const ok = () => done(input ? inp.value.trim() : true);
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); done(input ? null : false); }
      if (e.key === "Enter" && (input || document.activeElement === document.body)) { e.preventDefault(); ok(); }
    };
    document.addEventListener("keydown", onKey, true);
    box.querySelector('[data-act="ok"]').onclick = ok;
    const c = box.querySelector('[data-act="cancel"]');
    if (c) c.onclick = () => done(input ? null : false);
    back.addEventListener("click", (e) => { if (e.target === back) done(input ? null : false); });
    setTimeout(() => (inp ? (inp.focus(), inp.select()) : box.querySelector('[data-act="ok"]').focus()), 20);
  });
}
const askText = (title, opts) => dialog(Object.assign({ title, input: opts || {}, okText: "Add" }, opts && opts.dlg));
const confirmBox = (title, body, opts) => dialog(Object.assign({ title, body, okText: "OK" }, opts));

/* A number input that selects on focus and moves on with Enter. */
function wireNumberInput(inp, onChange, opts) {
  const decimal = !!(opts && opts.decimal);
  inp.setAttribute("inputmode", decimal ? "decimal" : "numeric");
  inp.autocomplete = "off";
  inp.addEventListener("focus", () => setTimeout(() => inp.select(), 0));
  inp.addEventListener("input", () => {
    const clean = decimal
      ? inp.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1")
      : inp.value.replace(/[^\d]/g, "");
    if (clean !== inp.value) inp.value = clean;
    onChange();
  });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const all = $$("input.cnt:not([disabled])", inp.closest(".view") || document);
      const i = all.indexOf(inp);
      if (i >= 0 && all[i + 1]) all[i + 1].focus();
      else inp.dispatchEvent(new CustomEvent("enter-last", { bubbles: true }));
    }
  });
}

function friendlyError(e) {
  const m = (e && e.message) || String(e);
  if (/Failed to fetch|NetworkError/i.test(m)) return "the app's background process isn't answering";
  return m;
}

/* Download a text file through the browser. */
function downloadText(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: type || "text/plain" }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
