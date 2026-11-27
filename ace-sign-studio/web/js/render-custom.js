/* ============================================================
   Sign customizations, applied around any sign type's renderer:
   - spec.extras: extra text boxes and pictures. Each one either
     floats on top of the sign where it was dragged, or ("Make room",
     dock: top|bottom|left|right) takes a band along that edge while
     the rest of the sign re-fits in the space that's left;
   - spec.nudge: small position nudges per element ({key: {x, y}},
     fractions of the sign's width/height);
   - spec.style.accent: the sign's main color (Ace Red by default).
   A sign with none of these renders byte-for-byte as before.
   ============================================================ */
"use strict";

/* Color choices offered in the editor. Ace brand first; the others are
   for seasonal or department signs. Any #RRGGBB also works (custom). */
const SIGN_COLORS = [
  { id: "#D40029", label: "Ace Red" },
  { id: "#9E0620", label: "Dark Red" },
  { id: "#000000", label: "Black" },
  { id: "#1F6F3F", label: "Green" },
  { id: "#1D4E89", label: "Blue" },
  { id: "#E36C0A", label: "Orange" },
  { id: "#6B2C91", label: "Purple" },
];
const EXTRA_TEXT_COLORS = ["#000000", "#D40029", "#FFFFFF", "#6D6E71", "#1D4E89", "#1F6F3F"];
const EXTRA_BG_COLORS = ["", "#D40029", "#000000", "#FFD200", "#E6E7E8", "#FFFFFF"];
const EXTRA_FONTS = { regular: "RobotoRegular", bold: "RobotoBold", black: "RobotoBlack" };
const NUDGE_MAX = 0.25;

const isHex = (c) => /^#[0-9a-f]{6}$/i.test(String(c || ""));

function validExtras(spec) {
  const list = spec && Array.isArray(spec.extras) ? spec.extras : [];
  return list.filter((x) => x && (x.kind === "image" ? !!x.src : String(x.text || "").trim()));
}

function hasNudges(spec) {
  const n = spec && spec.nudge;
  return !!n && Object.keys(n).some((k) => n[k] && (Math.abs(n[k].x || 0) > 1e-4 || Math.abs(n[k].y || 0) > 1e-4));
}

function signAccent(spec) {
  const a = spec && spec.style && spec.style.accent;
  return isHex(a) && a.toUpperCase() !== ACE_RED ? a : null;
}

function isCustomized(spec) {
  return validExtras(spec).length > 0 || hasNudges(spec) || !!signAccent(spec);
}

const stripSvgRoot = (svg) => svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

/* Wrap each nudged g[data-elem] in a translate. DOM-based: element groups
   nest, so a string replace can't find their matching close tags. */
function applyNudges(body, nudge, w, h) {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${body}</svg>`, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName !== "svg") return body; // parse error: leave as is
  for (const g of Array.from(root.querySelectorAll("g[data-elem]"))) {
    const n = nudge[g.getAttribute("data-elem")];
    if (!n) continue;
    const dx = Math.max(-NUDGE_MAX, Math.min(NUDGE_MAX, n.x || 0)) * w;
    const dy = Math.max(-NUDGE_MAX, Math.min(NUDGE_MAX, n.y || 0)) * h;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) continue;
    const wrap = doc.createElementNS("http://www.w3.org/2000/svg", "g");
    wrap.setAttribute("transform", `translate(${dx.toFixed(2)},${dy.toFixed(2)})`);
    g.parentNode.insertBefore(wrap, g);
    wrap.appendChild(g);
  }
  const out = new XMLSerializer().serializeToString(root);
  return stripSvgRoot(out);
}

/* One extra box's markup inside rect r. `i` tags it for the editor's
   drag/select (inert in print). */
async function extraMarkup(x, i, r, opts) {
  let m = "";
  const o = opts || {};
  const rad = Math.min(r.w, r.h) * 0.08;
  if (isHex(x.bg)) m += roundRect(r.x, r.y, r.w, r.h, rad, x.bg, null, 0);
  else if (o.panel) m += roundRect(r.x, r.y, r.w, r.h, rad, "none", GRAY5, Math.max(1.1, o.stroke || 1.2));
  if (x.kind === "image") {
    try {
      const uri = await toDataURI(x.src, "png");
      const nat = await imageSize(uri);
      const pad = Math.min(r.w, r.h) * (isHex(x.bg) ? 0.08 : 0.02);
      const k = Math.min((r.w - 2 * pad) / nat.w, (r.h - 2 * pad) / nat.h);
      const w = nat.w * k, h = nat.h * k;
      m += `<image x="${(r.x + (r.w - w) / 2).toFixed(2)}" y="${(r.y + (r.h - h) / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" href="${uri}"/>`;
    } catch (e) { /* unreadable picture: leave the box empty */ }
  } else {
    const fam = EXTRA_FONTS[x.weight] || EXTRA_FONTS.black;
    const lines = String(x.text || "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8);
    const padX = r.w * (isHex(x.bg) ? 0.06 : 0.02), padY = r.h * (isHex(x.bg) ? 0.1 : 0.04);
    const aw = r.w - 2 * padX, ah = r.h - 2 * padY;
    const lh = 1.14;
    let size = ah / (lines.length * lh);
    for (const l of lines) size = Math.min(size, fitTextSize(l, fam, size, aw, 4));
    size *= Math.max(0.3, Math.min(1, x.scale || 1));
    const color = isHex(x.color) ? x.color : (isHex(x.bg) && x.bg !== "#FFFFFF" && x.bg !== "#E6E7E8" && x.bg !== "#FFD200" ? "#FFFFFF" : INK);
    const anchor = x.align === "left" ? "start" : x.align === "right" ? "end" : "middle";
    const tx = x.align === "left" ? r.x + padX : x.align === "right" ? r.x + r.w - padX : r.x + r.w / 2;
    const blockH = lines.length * size * lh;
    let y = r.y + (r.h - blockH) / 2 + size * 0.86;
    for (const l of lines) {
      m += svgText(tx, y, l, fam, size, color, { anchor });
      y += size * lh;
    }
  }
  return `<g data-extra="${i}">${m}</g>`;
}

/* Render a sign of type t with its customizations at Win × Hin inches. */
async function renderCustomized(t, spec, Win, Hin) {
  if (!isCustomized(spec)) return t.render(spec, Win, Hin);
  const W = Win * PPI, H = Hin * PPI;
  const all = Array.isArray(spec.extras) ? spec.extras : [];
  const extras = validExtras(spec);
  const m = frameMargin(W, H);
  // "Make room" bands come off the edges in list order; the sign itself
  // keeps at least half of each dimension
  let rx = 0, ry = 0, rw = W, rh = H;
  const bands = [];
  for (const x of extras) {
    if (!x.dock) continue;
    const frac = Math.max(0.08, Math.min(0.45, x.band || (x.dock === "top" || x.dock === "bottom" ? 0.2 : 0.3)));
    if (x.dock === "top" || x.dock === "bottom") {
      const bh = Math.min(H * frac, rh - H * 0.5);
      if (bh < 12) continue;
      const by = x.dock === "top" ? ry : ry + rh - bh;
      bands.push({ x, r: { x: rx + m, y: by + m, w: rw - 2 * m, h: bh - m } });
      if (x.dock === "top") ry += bh;
      rh -= bh;
    } else {
      const bw = Math.min(W * frac, rw - W * 0.5);
      if (bw < 12) continue;
      const bx = x.dock === "left" ? rx : rx + rw - bw;
      bands.push({ x, r: { x: bx + m, y: ry + m, w: bw - m, h: rh - 2 * m } });
      if (x.dock === "left") rx += bw;
      rw -= bw;
    }
  }
  // the docked band panels sit flush with the sign's own frame line
  for (const b of bands) {
    if (b.x.dock === "top") b.r.h -= m * 0.5;
    else if (b.x.dock === "bottom") { b.r.y += m * 0.5; b.r.h -= m * 0.5; }
    else if (b.x.dock === "left") b.r.w -= m * 0.5;
    else { b.r.x += m * 0.5; b.r.w -= m * 0.5; }
  }
  let body = stripSvgRoot(await t.render(spec, rw / PPI, rh / PPI));
  if (hasNudges(spec)) body = applyNudges(body, spec.nudge, rw, rh);
  const accent = signAccent(spec);
  if (accent) body = body.replace(/#D40029/gi, accent);
  let out = `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>` +
    (rx || ry ? `<g transform="translate(${rx.toFixed(2)},${ry.toFixed(2)})">${body}</g>` : body);
  const stroke = Math.max(1.1, Math.min(W, H) / 340);
  for (const b of bands) out += await extraMarkup(b.x, all.indexOf(b.x), b.r, { panel: true, stroke });
  for (const x of extras) {
    if (x.dock) continue;
    const r = {
      x: (x.x == null ? 0.3 : x.x) * W, y: (x.y == null ? 0.4 : x.y) * H,
      w: Math.max(0.04, x.w || 0.4) * W, h: Math.max(0.03, x.h || 0.14) * H,
    };
    out += await extraMarkup(x, all.indexOf(x), r);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out}</svg>`;
}
