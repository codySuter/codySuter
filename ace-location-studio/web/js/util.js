/* ============================================================
   Ace Location Studio — small DOM helpers, icons, dialogs and
   toasts (shared with Ace Change Studio).
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
/** "just now", "12 min ago", "2 h 5 min ago", "3 days ago". */
function agoText(ts, now) {
  const mins = Math.floor(((now || Date.now()) - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return mins % 60 ? `${h} h ${mins % 60} min ago` : `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}
/** Today: "10:30 AM"; another day: "Oct 9 · 10:30 AM". */
function whenText(ts) {
  return new Date(ts).toDateString() === new Date().toDateString() ? fmtTime(ts) : fmtDateTime(ts).replace(/, \d{4}/, "");
}
function daysAgoText(iso) {
  const days = Math.round((parseISODate(todayISO()) - parseISODate(iso)) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/* ---------------- icons (inline SVG, currentColor) ---------------- */
const ICONS = {
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  alert: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  x: '<path d="M18 6L6 18"/><path d="M6 6l12 12"/>',
  up: '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
  down: '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  refresh: '<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  sheet: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h8"/><path d="M12 11v8"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  eraser: '<path d="M20 20H7L3 16a2 2 0 0 1 0-2.8L13.2 3a2 2 0 0 1 2.8 0l5 5a2 2 0 0 1 0 2.8L11 21"/><path d="M6 11l7 7"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/>',
  boxes: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  sliders: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>',
  next: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5"/><path d="M11 18l-6-6 6-6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
};
function icon(name, cls) {
  return `<svg class="ico ${cls || ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
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
