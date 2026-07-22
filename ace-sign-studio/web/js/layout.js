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

/* Margin-tick cut guides: for every unique cut coordinate, short ticks in
   the page margins (top/bottom for vertical cuts, left/right for horizontal),
   so a straightedge can line up without marking the signs themselves. */
function cutGuides(page, pageW, pageH) {
  if (page.dedicated) return [];
  const xs = new Set(), ys = new Set();
  for (const p of page.items) {
    xs.add(+p.x.toFixed(3)); xs.add(+(p.x + p.w).toFixed(3));
    ys.add(+p.y.toFixed(3)); ys.add(+(p.y + p.h).toFixed(3));
  }
  const lines = [];
  const minX = Math.min(...[...xs]), maxX = Math.max(...[...xs]);
  const minY = Math.min(...[...ys]), maxY = Math.max(...[...ys]);
  for (const x of xs) {
    lines.push({ x1: x, y1: Math.max(0.08, minY - 0.28), x2: x, y2: Math.max(0.1, minY - 0.06) });
    lines.push({ x1: x, y1: Math.min(pageH - 0.1, maxY + 0.06), x2: x, y2: Math.min(pageH - 0.08, maxY + 0.28) });
  }
  for (const y of ys) {
    lines.push({ x1: Math.max(0.08, minX - 0.28), y1: y, x2: Math.max(0.1, minX - 0.06), y2: y });
    lines.push({ x1: Math.min(pageW - 0.1, maxX + 0.06), y1: y, x2: Math.min(pageW - 0.08, maxX + 0.28), y2: y });
  }
  return lines;
}
