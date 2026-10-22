/**
 * Builds testdata/pog-sample.pdf — a synthetic Ace planogram for the tests.
 *
 * It copies the layout pdf.js sees in a real Ace planogram PDF (cover page
 * with POG ID / title / live date, one "ACE NUMBER" drawing page per
 * segment with each SKU label rotated 90°, and the ACE HARDWARE PRODUCT
 * REPORT with its column headings at the real x positions), but every
 * SKU, UPC and description is made up.
 *
 *   node testdata/make_pog_fixture.mjs
 */
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// sku, upc, desc, part#, vendor, facings, rec ("" = not listed), seg, peg, row, col
export const ITEMS = [
  ["7000001", "00011111000017", "TEST PRUNER BYPASS 8\"", "PR-100", "TEST VENDOR A", 2, 12, 1, "PEG_HOOK_04IN", 1, 2],
  ["7000002", "00011111000024", "TEST SNIPS 6\"", "2008255", "TEST VENDOR B", 1, 3, 1, "PEG_HOOK_04IN", 1, 10],
  ["7000003", "00011111000031", "TEST LOPPER 28\"", "LP-28", "TEST VENDOR A", 3, 3, 1, "PEG_HOOK_04IN", 14, 2],
  ["7000004", "00011111000048", "TEST BOW SAW 21\"", "BS-21", "TEST VENDOR A", 1, "", 1, "SHELF", "N/A", "N/A"],
  ["7000005", "00011111000055", "TEST HEDGE SHEAR", "HS-1", "TEST VENDOR B", 1, 2, 2, "PEG_HOOK_04IN", 1, 2],
  ["7000006", "00011111000062", "TEST POLE SAW 12'", "1086217", "TEST VENDOR B", 2, 5, 2, "PEG_HOOK_04IN", 1, 14],
  ["7000137D", "00011111000079", "TEST MACHETE 18\"", "MC-18", "TEST VENDOR A", 1, 4, 2, "<None>", "N/A", "N/A"],
];

/* ---------------- a tiny PDF writer ---------------- */

const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const text = (s, x, y, size, rot) =>
  rot === 90
    ? `BT /F1 ${size} Tf 0 1 -1 0 ${x} ${y} Tm (${esc(s)}) Tj ET\n`
    : `BT /F1 ${size} Tf ${x} ${y} Td (${esc(s)}) Tj ET\n`;
const rect = (x, y, w, h) => `${x} ${y} ${w} ${h} re S\n`;

function footer(pogId, label, page, of) {
  return text(pogId, 72.48, 43.2, 12) + text("POG ID:", 17.76, 55.92, 7.92) + text(`Page: ${page} of ${of}`, 30.72, 19.92, 10.08) +
    text("9/22/2026", 126.96, 19.92, 10.08) + text(label, 315.84, 35.52, 12) +
    text("TEST SHELF 8FT NA NATIONAL", 18, 763.44, 13.92) + text("CON/COR/SUP", 409.44, 763.44, 13.92);
}

function buildPages(pogId) {
  const of = 4;
  const pages = [];
  // 1: cover
  pages.push(text("TEST SHELF 8FT NA NATIONAL", 21.6, 762.72, 13.92) + text("CON/COR/SUP", 407.76, 762.72, 13.92) +
    text("POG ID:", 17.52, 32.88, 7.92) + text(pogId, 68.88, 20.16, 12) + text("COVER PAGE", 270.48, 24, 12) +
    text("Page: 1 of 4", 446.4, 20.88, 10.08) + text("9/22/2026", 534.24, 20.88, 10.08) +
    rect(120, 180, 380, 420) + rect(310, 180, 0.5, 420));
  // 2, 3: one drawing page per segment, labels rotated like the real ones
  const spots = {
    7000001: [190, 470], 7000002: [230, 470], 7000003: [190, 330], 7000004: [300, 200],
    7000005: [190, 470], 7000006: [260, 400], "7000137D": [330, 260],
  };
  for (const seg of [1, 2]) {
    let c = footer(pogId, "ACE NUMBER", seg + 1, of) + text("Segment: 1", 522.96, 48.48, 10.08) + rect(150, 150, 260, 450);
    for (const it of ITEMS.filter((i) => i[7] === seg)) {
      const [x, y] = spots[it[0]];
      c += rect(x - 14, y - 10, 22, 90) + text(it[0], x, y, 6.96, 90);
    }
    // A long seg-1 item hangs over into segment 2's page, like real plans.
    if (seg === 2) c += text("7000004", 160, 200, 6.96, 90);
    pages.push(c);
  }
  // 4: product report
  let r = footer(pogId, "FIXTURE LOCATION NOTES", 4, of) + text("ACE HARDWARE PRODUCT REPORT", 238.8, 704.4, 7.44);
  const head = (y) =>
    text("SKU CODE", 18.24, y, 4.8) + text("UPC", 62.64, y, 4.8) + text("DESCRIPTION", 114.72, y, 4.8) +
    text("VENDOR'S PART#", 173.52, y, 4.8) + text("VENDOR NAME", 237.12, y, 4.8) + text("FACINGS", 295.68, y, 4.8) +
    text("REC", 324.72, y, 4.8) + text("SEG", 342.96, y, 4.8) + text("PEG ID", 429.6, y, 4.8) +
    text("ROW", 521.52, y, 4.8) + text("COL", 536.64, y, 4.8) + text("MFG#", 187.44, y - 6.96, 4.8) + text("QTY", 324.72, y - 6.96, 4.8);
  let y = 690;
  for (const seg of [1, 2]) {
    r += text(`In Segment: ${seg}`, 16.56, y, 4.8) + text("On Fixture Description: GONDOLA ASSEMBLY", 69.84, y, 4.8) + text(`Fixture Location: ${seg * 4}`, 287.28, y, 4.8);
    y -= 6.96;
    r += head(y);
    y -= 13.92;
    for (const it of ITEMS.filter((i) => i[7] === seg)) {
      const [sku, upc, desc, part, vendor, fac, rec, sg, peg, row, col] = it;
      r += text(sku, 21.6, y, 4.8) + text(upc, 49.2, y, 4.8) + text(desc, 108, y, 4.8) + text(part, 182, y, 4.8) +
        text(vendor, 228, y, 4.8) + text(String(fac), 304.8, y, 4.8) + (rec === "" ? "" : text(String(rec), 328.32, y, 4.8)) +
        text(String(sg), 346.8, y, 4.8) + text(peg, 356.16, y, 4.8) + text(String(row), row === "N/A" ? 523.44 : 524.64, y, 4.8) +
        text(String(col), col === "N/A" ? 537.84 : 540.48, y, 4.8);
      y -= 6.72;
    }
    y -= 14;
  }
  pages.push(r);
  return pages;
}

export function buildPdf(pogId) {
  const contents = buildPages(pogId || "SYNTH8FT");
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalog = add(null);
  const pagesId = add(null);
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const kids = [];
  for (const c of contents) {
    const stream = add(`<< /Length ${Buffer.byteLength(c, "latin1")} >>\nstream\n${c}endstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${stream} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(path.join(HERE, "pog-sample.pdf"), buildPdf("SYNTH8FT"));
  console.log("wrote testdata/pog-sample.pdf");
}
