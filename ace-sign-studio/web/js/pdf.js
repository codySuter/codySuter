/* ============================================================
   PDF pipeline: sign SVGs → sheet SVGs → vector PDF via svg2pdf,
   with the brand TTFs embedded so PDFs match previews exactly.
   ============================================================ */
"use strict";

/* Compose one sheet SVG (inches → 96dpi px) with nested sign SVGs. */
async function composeSheetSVG(page, showGuides) {
  const pw = page.landscape ? PAGE_H : PAGE_W;
  const ph = page.landscape ? PAGE_W : PAGE_H;
  const W = pw * PPI, H = ph * PPI;
  let inner = `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`;

  for (const p of page.items) {
    const q = p.item.q;
    const rot = p.item.rot;
    const specW = rot ? p.h : p.w;
    const specH = rot ? p.w : p.h;
    const svg = await renderQueueItemSVG(q, specW, specH);
    const body = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
    const tx = p.x * PPI, ty = p.y * PPI;
    if (rot) {
      inner += `<g transform="translate(${(tx + p.w * PPI).toFixed(2)},${ty.toFixed(2)}) rotate(90)">${body}</g>`;
    } else {
      inner += `<g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)})">${body}</g>`;
    }
    if (!page.dedicated) {
      inner += `<rect x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" width="${(p.w * PPI).toFixed(2)}" height="${(p.h * PPI).toFixed(2)}" fill="none" stroke="#AAAAAA" stroke-width="0.75"/>`;
    }
  }
  if (showGuides) {
    for (const l of cutGuides(page, pw, ph)) {
      inner += `<line x1="${(l.x1 * PPI).toFixed(2)}" y1="${(l.y1 * PPI).toFixed(2)}" x2="${(l.x2 * PPI).toFixed(2)}" y2="${(l.y2 * PPI).toFixed(2)}" stroke="#9A9A9A" stroke-width="0.8"/>`;
    }
  }
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${inner}</svg>`, pw, ph };
}

/* Render pages → jsPDF document. pages from packQueue().pages. */
async function pagesToPdf(pages, showGuides, onProgress) {
  await ensureFontsLoaded();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "in", format: "letter", orientation: pages.length && pages[0].landscape ? "landscape" : "portrait" });
  await ensurePdfFonts(doc);
  doc.deletePage(1);
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-12000px;top:0;";
  document.body.appendChild(host);
  try {
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (onProgress) onProgress(i + 1, pages.length);
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

/* Single sign → its own PDF at true size. */
async function signToPdf(q) {
  await ensureFontsLoaded();
  const { jsPDF } = window.jspdf;
  const w = q.size.w, h = q.size.h;
  const doc = new jsPDF({ unit: "in", format: [w, h], orientation: w > h ? "landscape" : "portrait" });
  await ensurePdfFonts(doc);
  const svg = await renderQueueItemSVG(q, w, h);
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-12000px;top:0;";
  host.innerHTML = svg;
  document.body.appendChild(host);
  try {
    await doc.svg(host.firstElementChild, { x: 0, y: 0, width: w, height: h });
  } finally {
    host.remove();
  }
  return doc;
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
