/* Shared helpers: DOM, debounce, money, text measurement, SVG escaping. */
"use strict";

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function debounce(fn, ms) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* Split a price into dollars (grouped) and cents. "1299.9" → {d:"1,299", c:"90"} */
function moneyParts(v) {
  const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.]/g, ""));
  if (isNaN(n)) return { d: "—", c: "" };
  const [d, c] = n.toFixed(2).split(".");
  return { d: Number(d).toLocaleString("en-US"), c };
}

function fmtMoney(v) {
  const m = moneyParts(v);
  return m.c === "" ? m.d : `$${m.d}.${m.c}`;
}

/* ---- Text measurement (canvas-based, uses loaded @font-face fonts) ---- */
const _measureCtx = document.createElement("canvas").getContext("2d");
function textWidth(text, family, sizePx) {
  _measureCtx.font = `${sizePx}px "${family}"`;
  return _measureCtx.measureText(String(text)).width;
}

/* Largest font size (≤ max) at which text fits width. */
function fitTextSize(text, family, maxSize, maxWidth, minSize) {
  let size = maxSize;
  const w = textWidth(text, family, 100); // width at 100px
  if (w > 0) size = Math.min(maxSize, (maxWidth / w) * 100);
  return Math.max(minSize || 6, size);
}

/* Balanced split of a name into up to `maxLines` lines that maximizes font
   size within maxWidth — port of the legacy large-text balancing logic. */
function balancedLines(text, family, maxSize, maxWidth, maxLines) {
  const clean = String(text || "").trim().replace(/\s+/g, " ");
  if (!clean) return { size: maxSize, lines: [""] };
  const one = fitTextSize(clean, family, maxSize, maxWidth, 4);
  let best = { size: one, lines: [clean] };
  if ((maxLines || 2) < 2) return best;
  const words = clean.split(" ");
  if (words.length < 2) return best;
  let bestTwo = null;
  for (let i = 1; i < words.length; i++) {
    const l1 = words.slice(0, i).join(" ");
    const l2 = words.slice(i).join(" ");
    const s = Math.min(
      fitTextSize(l1, family, maxSize, maxWidth, 4),
      fitTextSize(l2, family, maxSize, maxWidth, 4)
    );
    if (!bestTwo || s > bestTwo.size) bestTwo = { size: s, lines: [l1, l2] };
  }
  if (bestTwo && bestTwo.size > best.size) best = bestTwo;
  return best;
}

/* Sale date pill text — port of format_sale_dates. */
function formatSaleDates(startISO, endISO) {
  const parse = (s) => {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  };
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const s = parse(startISO), e = parse(endISO);
  if (s && e) {
    if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear())
      return `${MON[s.getMonth()]} ${s.getDate()} – ${e.getDate()}`;
    return `${MON[s.getMonth()]} ${s.getDate()} – ${MON[e.getMonth()]} ${e.getDate()}`;
  }
  if (s) return `Begins ${MON[s.getMonth()]} ${s.getDate()}`;
  if (e) return `Through ${MON[e.getMonth()]} ${e.getDate()}`;
  return "";
}

function plusDaysISO(iso, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  const d = new Date(+m[1], +m[2] - 1, +m[3] + days);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* Extract every run of 4+ digits — the smart bulk-paste rule. */
function parseBulkSkus(text) {
  const runs = String(text || "").match(/\d{4,}/g) || [];
  return [...new Set(runs)];
}

function sanitizeFilename(s) {
  return String(s || "sign").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
}

/* Fetch an image URL (via our proxy for remote ones) and return a data URI. */
const _dataURICache = new Map();
async function toDataURI(url) {
  if (!url) return null;
  if (_dataURICache.has(url)) return _dataURICache.get(url);
  const p = (async () => {
    const src = /^https?:\/\//.test(url) ? `/api/img?u=${encodeURIComponent(url)}` : url;
    const resp = await fetch(src);
    if (!resp.ok) throw new Error(`image fetch failed (${resp.status})`);
    const blob = await resp.blob();
    return await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  })();
  _dataURICache.set(url, p);
  try { return await p; } catch (e) { _dataURICache.delete(url); throw e; }
}

/* Natural size of a data-URI image. */
const _imgSizeCache = new Map();
function imageSize(dataURI) {
  if (_imgSizeCache.has(dataURI)) return _imgSizeCache.get(dataURI);
  const p = new Promise((res) => {
    const im = new Image();
    im.onload = () => res({ w: im.naturalWidth || 1, h: im.naturalHeight || 1 });
    im.onerror = () => res({ w: 1, h: 1 });
    im.src = dataURI;
  });
  _imgSizeCache.set(dataURI, p);
  return p;
}
