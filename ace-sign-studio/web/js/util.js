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

/* Run work once the browser is idle, so background warm-ups don't compete
   with first paint. Falls back to a plain timer where requestIdleCallback
   isn't available. */
function whenIdle(fn, timeout) {
  if (typeof requestIdleCallback === "function") requestIdleCallback(fn, { timeout: timeout || 3000 });
  else setTimeout(fn, timeout || 1200);
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

/* The browser reports any network-level failure as a bare TypeError
   ("Failed to fetch"). For this app that almost always means the local
   backend process has exited, so translate it into something actionable. */
function friendlyError(e) {
  if (e instanceof TypeError) {
    return "can't reach the app's background process. Close this window and start Ace Sign Studio again (your queue is saved)";
  }
  return e && e.message ? e.message : String(e);
}

/* Fetch an image URL (via our proxy for remote ones) and return a data URI.
   `reencode` normalizes the image through a canvas to a baseline format that
   jsPDF's decoders accept — real product photos are often progressive or
   CMYK JPEGs, WebP or AVIF, which browsers render (so the preview looks
   fine) but jsPDF.addImage silently rejects (so they vanish from the PDF).
   Passing "jpeg" (opaque, small) or "png" (keeps alpha) re-bakes them to
   baseline so preview and PDF match. */
/* Bounded so a long bulk-add session (hundreds of product photos, each a
   few hundred KB of base64) can't grow the heap without limit. Insertion
   order = eviction order; a re-read refreshes an entry's position. */
const DATA_URI_CACHE_MAX = 60;
const _dataURICache = new Map();
function _cacheTouch(map, key, max) {
  const v = map.get(key);
  map.delete(key);
  map.set(key, v);
  while (map.size > max) map.delete(map.keys().next().value);
  return v;
}
async function toDataURI(url, reencode) {
  if (!url) return null;
  const key = url + "|" + (reencode || "");
  if (_dataURICache.has(key)) return _cacheTouch(_dataURICache, key, DATA_URI_CACHE_MAX);
  const p = (async () => {
    const src = /^https?:\/\//.test(url) ? `/api/img?u=${encodeURIComponent(url)}` : url;
    const resp = await fetch(src);
    if (!resp.ok) throw new Error(`image fetch failed (${resp.status})`);
    const blob = await resp.blob();
    const raw = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
    if (!reencode) return raw;
    return await reencodeImage(raw, reencode);
  })();
  _dataURICache.set(key, p);
  while (_dataURICache.size > DATA_URI_CACHE_MAX) _dataURICache.delete(_dataURICache.keys().next().value);
  try { return await p; } catch (e) { _dataURICache.delete(key); throw e; }
}

/* Decode an image data URI and re-encode it via canvas to a baseline
   JPEG (white-matted) or PNG (alpha preserved) that jsPDF can embed.
   Guarded so a pathological image can never hang the app — on any timeout
   or error it falls back to the original data URI (which still renders in
   the preview even if the PDF can't embed it). */
async function reencodeImage(dataURI, mode) {
  const img = new Image();
  const loaded = new Promise((res) => {
    img.onload = () => res(true);
    img.onerror = () => res(false);
  });
  img.src = dataURI;
  const ok = await Promise.race([
    loaded,
    new Promise((res) => setTimeout(() => res(false), 8000)),
  ]);
  if (!ok || !(img.naturalWidth > 0)) return dataURI;
  const w = img.naturalWidth, h = img.naturalHeight;
  try {
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d");
    if (mode === "jpeg") {
      ctx.fillStyle = "#ffffff"; // JPEG has no alpha — matte onto white
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);
    return mode === "png" ? cv.toDataURL("image/png") : cv.toDataURL("image/jpeg", 0.92);
  } catch (e) {
    return dataURI; // tainted/oversized canvas — fall back to the original
  }
}

/* Downscale a (usually huge) camera/phone data URL to a bounded baseline
   JPEG before it ever enters the queue spec. A raw 12MP drop is ~3-5 MB of
   base64 that would then be JSON.stringify'd, POSTed to /api/state, and
   deep-copied into every saved batch on each queue mutation; capping the
   long edge keeps state.json small and the app responsive. Anything already
   under the cap, or that fails to decode, is returned unchanged. */
function downscaleDataURL(dataURL, maxEdge, quality) {
  return new Promise((resolve) => {
    if (!dataURL || typeof dataURL !== "string") { resolve(dataURL); return; }
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      const scale = Math.min(1, maxEdge / Math.max(w || 1, h || 1));
      if (!(w > 0) || scale >= 1) { resolve(dataURL); return; } // already small enough
      try {
        const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
        const cv = document.createElement("canvas");
        cv.width = cw; cv.height = ch;
        const ctx = cv.getContext("2d");
        ctx.fillStyle = "#ffffff"; // JPEG has no alpha — matte onto white
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        resolve(cv.toDataURL("image/jpeg", quality || 0.85));
      } catch (e) { resolve(dataURL); }
    };
    img.onerror = () => resolve(dataURL);
    img.src = dataURL;
  });
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
