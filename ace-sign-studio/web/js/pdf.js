/* ============================================================
   PDF pipeline: sign SVGs → sheet SVGs → vector PDF via svg2pdf,
   with the brand TTFs embedded so PDFs match previews exactly.
   ============================================================ */
"use strict";

/* jsPDF (~365 KB) + svg2pdf (~85 KB) are only needed once the user prints
   or saves. Loading them from index.html cost a parse/compile of ~450 KB of
   minified JS on every launch — before the gallery could build — for
   something most sessions use later or not at all. They are fetched on the
   first export instead; the promise is cached so later exports are instant. */
const PDF_LIB_SCRIPTS = ["vendor/jspdf.umd.min.js", "vendor/svg2pdf.umd.min.js"];
let _pdfLibsReady = null;
function ensurePdfLibs() {
  if (_pdfLibsReady) return _pdfLibsReady;
  const loadScript = (src) =>
    new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`could not load ${src}`));
      document.head.appendChild(s);
    });
  // svg2pdf registers itself onto jsPDF, so order matters.
  _pdfLibsReady = PDF_LIB_SCRIPTS.reduce(
    (chain, src) => chain.then(() => loadScript(src)),
    Promise.resolve()
  ).catch((e) => { _pdfLibsReady = null; throw e; }); // let a failed load retry
  return _pdfLibsReady;
}

/* Hand the renderer a frame so progress text actually paints. The export
   loop is otherwise an unbroken microtask chain (fonts, images and sign
   SVGs all resolve from cache), which never yields — so "Sheet 3/8…" and
   the disabled button state were computed but never shown, and the window
   simply froze until the save dialog appeared. */
function yieldToPaint() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/* Compose one sheet SVG (inches → 96dpi px) with nested sign SVGs. */
let _sheetClipSeq = 0;
async function composeSheetSVG(page, showGuides) {
  const pw = page.landscape ? PAGE_H : PAGE_W;
  const ph = page.landscape ? PAGE_W : PAGE_H;
  const W = pw * PPI, H = ph * PPI;
  let inner = `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`;
  let defs = "";
  const clipBase = ++_sheetClipSeq; // ids must be unique across the sheet previews living in one document

  let idx = 0;
  for (const p of page.items) {
    const q = p.item.q;
    const rot = p.item.rot;
    const svg = await renderQueueItemSVG(q);
    const body = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
    const tx = p.x * PPI, ty = p.y * PPI;
    // Stripping the sign's <svg> wrapper also strips the viewBox clipping
    // the standalone preview relies on — an overflowing renderer (a long
    // unbreakable name, a wide unit label) would paint over the neighboring
    // sign. Re-clip each sign to its own slot (in its local, pre-rotation
    // frame; svg2pdf honors clip paths).
    const cw = (rot ? p.h : p.w) * PPI, ch = (rot ? p.w : p.h) * PPI;
    const cid = `shclip${clipBase}x${idx++}`;
    defs += `<clipPath id="${cid}"><rect x="0" y="0" width="${cw.toFixed(2)}" height="${ch.toFixed(2)}"/></clipPath>`;
    const clipped = `<g clip-path="url(#${cid})">${body}</g>`;
    if (rot) {
      inner += `<g transform="translate(${(tx + p.w * PPI).toFixed(2)},${ty.toFixed(2)}) rotate(90)">${clipped}</g>`;
    } else {
      inner += `<g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)})">${clipped}</g>`;
    }
    // No per-placement outline: every sign now carries its own dashed
    // laminate cut line (1/8" inside its nominal edge, from withCutGuide),
    // so an outline at the nominal boundary would just be a second,
    // wrong-place rectangle. The margin ticks still mark the shared
    // nominal edges for the first rough separation cuts.
  }
  if (defs) inner = `<defs>${defs}</defs>` + inner;
  if (showGuides) {
    for (const l of cutGuides(page, pw, ph)) {
      inner += `<line x1="${(l.x1 * PPI).toFixed(2)}" y1="${(l.y1 * PPI).toFixed(2)}" x2="${(l.x2 * PPI).toFixed(2)}" y2="${(l.y2 * PPI).toFixed(2)}" stroke="#9A9A9A" stroke-width="0.8"/>`;
    }
  }
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${inner}</svg>`, pw, ph };
}

/* Render pages → jsPDF document. pages from packQueue().pages. */
async function pagesToPdf(pages, showGuides, onProgress) {
  await Promise.all([ensureFontsLoaded(), ensurePdfLibs()]);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "in", format: "letter", orientation: pages.length && pages[0].landscape ? "landscape" : "portrait", compress: true });
  await ensurePdfFonts(doc);
  doc.deletePage(1);
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-12000px;top:0;";
  document.body.appendChild(host);
  try {
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (onProgress) onProgress(i + 1, pages.length);
      await yieldToPaint();
      const { svg, pw, ph } = await composeSheetSVG(page, showGuides);
      doc.addPage([pw, ph], pw > ph ? "landscape" : "portrait");
      host.innerHTML = svg;
      const node = host.firstElementChild;
      await doc.svg(node, { x: 0, y: 0, width: pw, height: ph });
    }
  } finally {
    host.remove();
  }
  return doc;
}

/* Single sign → its own PDF at true size. Accepts either a queue-packable
   item ({size}) or an editor item ({sizeId}). */
/* Single-sign export: composed onto a US Letter sheet through the same
   packer as the queue, so printing at 100% yields the sign's true physical
   size. The old sign-sized PDF page got "fit to paper"-scaled by the print
   dialog — a 5×3 shelf sign came out nearly double size. */
async function signToPdf(q) {
  const packed = packQueue(
    [{ uid: (q.uid || "single") + ":0", size: sizeOfQueueItem(q), q }],
    { margin: Settings.get().margin }
  );
  return pagesToPdf(packed.pages, Settings.get().cutGuides);
}

let _printBlobUrl = null;
function printPdfDoc(doc) {
  doc.autoPrint();
  const blob = doc.output("blob");
  if (_printBlobUrl) URL.revokeObjectURL(_printBlobUrl);
  _printBlobUrl = URL.createObjectURL(blob);
  const frame = $("#printFrame");
  frame.onload = () => {
    setTimeout(() => {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { window.open(_printBlobUrl, "_blank"); }
    }, 300);
  };
  frame.src = _printBlobUrl;
}

function downloadPdfDoc(doc, filename) {
  doc.save(filename);
}
