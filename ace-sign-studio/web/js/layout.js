/* ============================================================
   Sheet layout optimizer.

   Packs queued signs (physical inch sizes) onto US Letter sheets,
   fitting as many per page as possible while keeping cuts easy:
   shelf rows → straight full-width cuts between rows, vertical cuts
   within a row. 90° rotation is used when it fits more per page.

   Signs that can't fit inside the cutting margin (Full Page 8.5×11 /
   11×8.5, Sign Holder 11×7) get a dedicated sheet, centered — their
   own internal white frame keeps content inside the printable area
   of the Brother MFC-L9160CDN (~0.25" non-printable edge).

   Default packing margin 0.375", zero gap → neighboring signs share
   a single guillotine cut. Cut guides are drawn as ticks in the page
   margins aligned with every cut line, plus a hairline outline.
   ============================================================ */
"use strict";

const PAGE_W = 8.5, PAGE_H = 11;

function shelfPack(items, pageW, pageH, margin, gap) {
  const availW = pageW - 2 * margin;
  const availH = pageH - 2 * margin;
  const sorted = items.slice().sort((a, b) => b.h - a.h || b.w - a.w);
  const pages = [];
  let page = null, rows = null, yCur = 0;
  const newPage = () => {
    page = { items: [], usedArea: 0, dedicated: false };
    pages.push(page);
    rows = [];
    yCur = 0;
  };
  newPage();
  for (const it of sorted) {
    let placed = false;
    for (const row of rows) {
      if (it.h <= row.h + 1e-6 && row.xCur + it.w <= availW + 1e-6) {
        page.items.push({ x: margin + row.xCur, y: margin + row.y, w: it.w, h: it.h, item: it });
        row.xCur += it.w + gap;
        page.usedArea += it.w * it.h;
        placed = true;
        break;
      }
    }
    if (placed) continue;
    if (yCur + it.h > availH + 1e-6) newPage();
    const row = { y: yCur, h: it.h, xCur: 0 };
    rows.push(row);
    page.items.push({ x: margin, y: margin + row.y, w: it.w, h: it.h, item: it });
    row.xCur = it.w + gap;
    yCur += it.h + gap;
    page.usedArea += it.w * it.h;
  }
  return pages.filter((p) => p.items.length);
}

/* Pack the queue. Returns {pages:[{items,landscape,dedicated}], margin, gap}. */
function packQueue(queueItems, opts) {
  const margin = (opts && opts.margin) || 0.375;
  const gap = (opts && opts.gap) != null ? opts.gap : 0;
  const small = [], big = [];
  for (const q of queueItems) {
    const { w, h } = q.size;
    const fitsMargins =
      (w <= PAGE_W - 2 * margin && h <= PAGE_H - 2 * margin) ||
      (h <= PAGE_W - 2 * margin && w <= PAGE_H - 2 * margin);
    (fitsMargins ? small : big).push(q);
  }

  // Shelf-packable signs: try portrait/landscape page × rotation allowed/not.
  let bestSmall = null;
  if (small.length) {
    for (const landscape of [false, true]) {
      const pw = landscape ? PAGE_H : PAGE_W;
      const ph = landscape ? PAGE_W : PAGE_H;
      for (const allowRot of [false, true]) {
        const items = small.map((q) => {
          let w = q.size.w, h = q.size.h, rot = false;
          const uprightFits = w <= pw - 2 * margin && h <= ph - 2 * margin;
          const rotFits = h <= pw - 2 * margin && w <= ph - 2 * margin;
          if (!uprightFits && rotFits) { [w, h] = [h, w]; rot = true; }
          else if (allowRot && uprightFits && rotFits && w < h === pw > ph) { [w, h] = [h, w]; rot = true; }
          return { w, h, rot, q };
        });
        const pages = shelfPack(items, pw, ph, margin, gap).map((p) => Object.assign(p, { landscape }));
        const cand = { pages, score: pages.length, area: pages.reduce((a, p) => a + p.usedArea, 0) };
        if (!bestSmall || cand.score < bestSmall.score || (cand.score === bestSmall.score && cand.area > bestSmall.area)) {
          bestSmall = cand;
        }
      }
    }
  }

  const pages = bestSmall ? bestSmall.pages.slice() : [];
  // Dedicated sheets for page-scale signs, centered at true size.
  for (const q of big) {
    let { w, h } = q.size;
    let landscape = w > h;
    const pw = landscape ? PAGE_H : PAGE_W;
    const ph = landscape ? PAGE_W : PAGE_H;
    const cw = Math.min(w, pw), ch = Math.min(h, ph);
    pages.push({
      items: [{ x: (pw - cw) / 2, y: (ph - ch) / 2, w: cw, h: ch, item: { w: cw, h: ch, rot: false, q } }],
      usedArea: cw * ch,
      dedicated: true,
      landscape,
    });
  }
  return { pages, margin, gap };
}

/* Margin-tick cut guides: short ticks in the page margins (top/bottom for
   vertical cuts, left/right for horizontal), so a straightedge can line up
   without marking the signs themselves.

   Two constraints shape them:
   - Every tick is clamped into the printable band. The printer lays no
     toner within ≈0.25" of the paper edge, and the old ticks lived almost
     entirely in that dead zone — at the default margin only a ~1.5mm stub
     printed, and at tighter margins nothing did.
   - A margin tick advertises a full-length straightedge cut, so it is only
     emitted when that cut passes through no sign's interior. Rows of
     different widths otherwise produce ticks that would slice a wider
     sign in another row. (The dashed per-sign outlines still mark the
     row-local cuts.) */
function cutGuides(page, pageW, pageH) {
  if (page.dedicated) return [];
  const EDGE = 0.26; // stay outside the printer's ≈0.25" non-printable edge
  const xs = new Set(), ys = new Set();
  for (const p of page.items) {
    xs.add(+p.x.toFixed(3)); xs.add(+(p.x + p.w).toFixed(3));
    ys.add(+p.y.toFixed(3)); ys.add(+(p.y + p.h).toFixed(3));
  }
  const minX = Math.min(...[...xs]), maxX = Math.max(...[...xs]);
  const minY = Math.min(...[...ys]), maxY = Math.max(...[...ys]);
  const safeX = [...xs].filter((x) => page.items.every((p) => x <= p.x + 1e-6 || x >= p.x + p.w - 1e-6));
  const safeY = [...ys].filter((y) => page.items.every((p) => y <= p.y + 1e-6 || y >= p.y + p.h - 1e-6));
  // A tick runs from just clear of the packed block toward the paper edge,
  // clamped to the printable band; keep at least a 0.04" visible stroke.
  const beforeTick = (edge) => {
    const outer = Math.max(EDGE, edge - 0.28);
    let inner = edge - 0.06;
    if (inner - outer < 0.04) inner = Math.min(edge - 0.02, outer + 0.04);
    return inner > outer ? [outer, inner] : null;
  };
  const afterTick = (edge, limit) => {
    const outer = Math.min(limit - EDGE, edge + 0.28);
    let inner = edge + 0.06;
    if (outer - inner < 0.04) inner = Math.max(edge + 0.02, outer - 0.04);
    return outer > inner ? [inner, outer] : null;
  };
  const lines = [];
  const top = beforeTick(minY), bottom = afterTick(maxY, pageH);
  for (const x of safeX) {
    if (top) lines.push({ x1: x, y1: top[0], x2: x, y2: top[1] });
    if (bottom) lines.push({ x1: x, y1: bottom[0], x2: x, y2: bottom[1] });
  }
  const left = beforeTick(minX), right = afterTick(maxX, pageW);
  for (const y of safeY) {
    if (left) lines.push({ x1: left[0], y1: y, x2: left[1], y2: y });
    if (right) lines.push({ x1: right[0], y1: y, x2: right[1], y2: y });
  }
  return lines;
}
