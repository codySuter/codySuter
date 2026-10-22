/**
 * Unit tests for the planogram rules in web/js/pog.js — no browser, no
 * pdf.js: pages are built from text items shaped like the ones pdf.js
 * returns for a real Ace planogram PDF.
 * Usage: node tests/pog.mjs
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const loaded = require("../web/js/pog.js");
const Pog = loaded && loaded.parsePlan ? loaded : globalThis.Pog;

let failed = 0, passed = 0;
function ok(name, cond, extra) {
  if (cond) passed++;
  else { failed++; console.log(`  ✗ FAIL ${name}${extra !== undefined ? " — " + JSON.stringify(extra) : ""}`); }
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });

/* A pdf.js-style text item: upright, or rotated 90° like drawing labels. */
const W = 0.52; // rough Helvetica width per point of size per character
function ti(str, x, y, size, rot) {
  const s = size || 4.8;
  const t = rot === 90 ? [0, s, -s, 0, x, y] : [s, 0, 0, s, x, y];
  return Pog.normItem({ str, transform: t, width: String(str).length * s * W });
}

/* ---------------- normItem ---------------- */
const up = ti("7035488", 21.6, 668.88);
eq("upright rot", up.rot, 0);
ok("upright box", Math.abs(up.box.x0 - 21.6) < 1e-6 && Math.abs(up.box.y0 - 668.88) < 1e-6 && up.box.y1 > up.box.y0);
const lab = ti("7035561", 393.36, 232.8, 6, 90);
eq("label rot", lab.rot, 90);
ok("label box runs up and to the left", Math.abs(lab.box.x0 - (393.36 - 6)) < 1e-6 && Math.abs(lab.box.x1 - 393.36) < 1e-6 && Math.abs(lab.box.y0 - 232.8) < 1e-6 && lab.box.y1 > 250);

/* ---------------- a two-section plan ---------------- */
function headRow(y) {
  return [ti("SKU CODE", 18.24, y), ti("UPC", 62.64, y), ti("DESCRIPTION", 114.72, y), ti("VENDOR'S PART#", 173.52, y),
    ti("VENDOR NAME", 237.12, y), ti("FACINGS", 295.68, y), ti("REC", 324.72, y), ti("SEG", 342.96, y),
    ti("PEG ID", 429.6, y), ti("ROW", 521.52, y), ti("COL", 536.64, y), ti("MFG#", 187.44, y - 7), ti("QTY", 324.72, y - 7)];
}
function prodRow(y, sku, upc, desc, part, fac, rec, seg, peg, row, col) {
  const out = [ti(sku, 21.6, y), ti(upc, 49.2, y), ti(desc, 108, y), ti(part, 182, y), ti("TEST VENDOR", 228, y), ti(String(fac), 304.8, y)];
  if (rec !== "") out.push(ti(String(rec), 328.32, y));
  out.push(ti(String(seg), 346.8, y), ti(peg, 356.16, y), ti(String(row), 524, y), ti(String(col), 539, y));
  return out;
}
const cover = { num: 1, width: 612, height: 792, items: [
  ti("TEST SHELF 8FT", 21.6, 762.72, 13.92), ti("CON/COR/SUP", 407.76, 762.72, 13.92), ti("POG ID:", 17.52, 32.88, 7.92),
  ti("SYNTH8FT", 68.88, 20.16, 12), ti("COVER PAGE", 270.48, 24, 12), ti("9/22/2026", 534.24, 20.88, 10.08)] };
const draw1 = { num: 2, width: 612, height: 792, items: [ti("ACE NUMBER", 319.92, 35.52, 12), ti("Segment: 1", 522, 48, 10),
  ti("7000001", 190, 470, 6.96, 90), ti("7000002", 230, 470, 6.96, 90), ti("7000003", 190, 330, 6.96, 90), ti("7000004", 300, 200, 6.96, 90),
  ti("7000005", 400, 300, 6.96, 90) /* a seg-2 item hanging over */] };
const draw2 = { num: 3, width: 612, height: 792, items: [ti("ACE NUMBER", 319.92, 35.52, 12), ti("Segment: 1", 522, 48, 10) /* the real PDFs say 1 here too */,
  ti("7000005", 190, 470, 6.96, 90), ti("7000006", 260, 400, 6.96, 90), ti("7000004", 160, 200, 6.96, 90)] };
const report = { num: 4, width: 612, height: 792, items: [
  ti("ACE HARDWARE PRODUCT REPORT", 238.8, 704.4, 7.44),
  ti("In Segment: 1", 16.56, 690), ti("On Fixture Description: GONDOLA ASSEMBLY", 69.84, 690), ti("Fixture Location: 4", 287.28, 690),
  ...headRow(683),
  ...prodRow(669, "7000001", "00011111000017", "PRUNER BYPASS 8\"", "PR-100", 2, 12, 1, "PEG_HOOK_04IN", 1, 2),
  ...prodRow(662, "7000002", "00011111000024", "SNIPS 6\"", "2008255", 1, 3, 1, "PEG_HOOK_04IN", 1, 10),
  ...prodRow(655, "7000003", "00011111000031", "LOPPER 28\"", "LP-28", 3, 3, 1, "PEG_HOOK_04IN", 14, 2),
  ...prodRow(648, "7000004", "00011111000048", "BOW SAW 21\"", "BS-21", 1, "", 1, "SHELF", "N/A", "N/A"),
  ti("In Segment: 2", 16.56, 630), ti("On Fixture Description: GONDOLA ASSEMBLY", 69.84, 630), ti("Fixture Location: 8", 287.28, 630),
  ...headRow(623),
  ...prodRow(609, "7000005", "00011111000055", "HEDGE SHEAR", "HS-1", 1, 2, 2, "PEG_HOOK_04IN", 1, 2),
  ...prodRow(602, "7000006", "00011111000062", "POLE SAW 12'", "1086217", 2, 5, 2, "<None>", "N/A", "N/A"),
] };
const pages = [cover, draw1, draw2, report];
const plan = Pog.parsePlan(pages);

eq("pog id", plan.pogId, "SYNTH8FT");
eq("title", plan.title, "TEST SHELF 8FT");
eq("live date", plan.liveDate, "9/22/2026");
eq("cover page", plan.coverPage, 1);
eq("segments", plan.segments, [{ seg: 1, skus: 4 }, { seg: 2, skus: 2 }]);
eq("skus in order", plan.items.map((i) => i.sku), ["7000001", "7000002", "7000003", "7000004", "7000005", "7000006"]);
const it1 = plan.items[0];
eq("row fields", [it1.upc, it1.desc, it1.facings, it1.rec, it1.seg, it1.peg, it1.row, it1.col], ["00011111000017", "PRUNER BYPASS 8\"", 2, 12, 1, "PEG_HOOK_04IN", "1", "2"]);
eq("numeric part# isn't taken as a number column", [plan.items[1].facings, plan.items[1].rec, plan.items[1].seg], [1, 3, 1]);
eq("blank REC QTY → null", plan.items[3].rec, null);
eq("shelf item", [plan.items[3].peg, plan.items[3].row, plan.items[3].col], ["SHELF", "", ""]);
eq("<None> peg", plan.items[5].peg, "<None>");
eq("drawing pages → segments by majority", plan.drawings.map((d) => [d.page, d.seg, d.labels.length]), [[2, 1, 5], [3, 2, 3]]);
ok("label boxes kept", plan.drawings[0].labels.every((l) => l.y1 > l.y0 && l.x1 > l.x0));
eq("no warnings", plan.warnings, []);

eq("not a planogram", Pog.parsePlan([cover]).warnings.length, 1);
eq("not a planogram has no items", Pog.parsePlan([cover]).items, []);
const noDraw = Pog.parsePlan([cover, report]);
ok("no drawing → warns per segment", noDraw.warnings.length === 2 && /Segment 1 has no drawing/.test(noDraw.warnings[0]), noDraw.warnings);
const partial = Pog.parsePlan([cover, draw2, report]);
ok("unlabeled SKUs warned", partial.warnings.some((w) => /7000001, 7000002, 7000003/.test(w)), partial.warnings);

/* duplicate SKUs */
const w = [];
const merged = Pog.mergeRows([
  { sku: "1", facings: 1, rec: 2, seg: 1 }, { sku: "1", facings: 2, rec: 4, seg: 1 },
  { sku: "2", facings: 1, rec: null, seg: 1 }, { sku: "2", facings: 1, rec: 3, seg: 2 },
], w);
eq("same-section duplicate adds up", [merged[0].facings, merged[0].rec, merged[0].segs], [3, 6, [1]]);
eq("cross-section keeps first section", [merged[1].seg, merged[1].facings, merged[1].rec, merged[1].segs], [1, 2, 3, [1, 2]]);
ok("cross-section warned", w.length === 1 && /2\b/.test(w[0]), w);

/* ---------------- capacity ---------------- */
eq("plan facings → REC QTY", Pog.capacity(12, 2, 2), 12);
eq("user's example: 12 at 2 facings → 1 facing = 6", Pog.capacity(12, 2, 1), 6);
eq("rounds down 3/2", Pog.capacity(3, 2, 1), 1);
eq("rounds down 5/2", Pog.capacity(5, 2, 1), 2);
eq("3 facings rec 3 → 2", Pog.capacity(3, 3, 2), 2);
eq("never below 1", Pog.capacity(2, 3, 1), 1);
eq("0 facings → dropped", Pog.capacity(12, 2, 0), null);
eq("no REC QTY → blank", Pog.capacity(null, 2, 1), null);

/* ---------------- location codes ---------------- */
eq("next panel", Pog.nextCode("12R03"), "12R04");
eq("next panel keeps padding", Pog.nextCode("12R09"), "12R10");
eq("step 2", Pog.nextCode("12R03", 2), "12R05");
eq("lowercase", Pog.nextCode("12r03"), "12R04");
eq("no number", Pog.nextCode("USTOR"), "");
eq("too long", Pog.nextCode("1R999"), "");
eq("code ok", Pog.codeProblem("12R03"), "");
ok("code empty", Pog.codeProblem(" ") !== "");
ok("code too long", /at most 5/.test(Pog.codeProblem("12R034")));
ok("code bad chars", /letters, numbers/.test(Pog.codeProblem("12R?")));

/* ---------------- files ---------------- */
const codes = { 1: "12r03", 2: "12R04" };
let files = Pog.planFiles(plan, codes, {});
eq("file names (two locations)", files.map((f) => f.name), ["SYNTH8FT NEWLOC - Eagle Import.csv", "SYNTH8FT LABELS 12R03.csv", "SYNTH8FT LABELS 12R04.csv", "SYNTH8FT LABELS ALL.csv"]);
eq("import", files[0].csv, ["SKU,Location 1,Location 3", "7000001,12R03,12", "7000002,12R03,3", "7000003,12R03,3", "7000004,12R03,", "7000005,12R04,2", "7000006,12R04,5"].join("\r\n"));
eq("labels 12R03: facings,SKU no header", files[1].csv, ["2,7000001", "1,7000002", "3,7000003", "1,7000004"].join("\r\n"));
eq("labels 12R04", files[2].csv, ["1,7000005", "2,7000006"].join("\r\n"));
eq("labels ALL", files[3].csv, files[1].csv + "\r\n" + files[2].csv);
eq("row counts", files.map((f) => f.rows), [6, 4, 2, 6]);

files = Pog.planFiles(plan, codes, { 7000001: 1, 7000003: 2, 7000006: 0 });
eq("fewer facings scale Location 3", files[0].csv.split("\r\n").slice(1, 4), ["7000001,12R03,6", "7000002,12R03,3", "7000003,12R03,2"]);
ok("dropped SKU in no file", files.every((f) => !f.csv.includes("7000006")));
eq("labels use the new facings", files[1].csv.split("\r\n")[0], "1,7000001");
eq("ALL count after drop", files[3].rows, 5);

files = Pog.planFiles(plan, { 1: "12R03", 2: "12R03" }, {});
eq("one location → one label file", files.map((f) => f.name), ["SYNTH8FT NEWLOC - Eagle Import.csv", "SYNTH8FT LABELS.csv"]);
eq("one location labels has every SKU", files[1].rows, 6);

const single = { pogId: "S7LOPPR4", segments: [{ seg: 1, skus: 1 }], items: [{ sku: "7035488", seg: 1, facings: 1, rec: 2 }] };
eq("single section", Pog.planFiles(single, { 1: "12R03" }, {}).map((f) => [f.name, f.csv]), [["S7LOPPR4 NEWLOC - Eagle Import.csv", "SKU,Location 1,Location 3\r\n7035488,12R03,2"], ["S7LOPPR4 LABELS.csv", "1,7035488"]]);
eq("odd POG id characters dropped", Pog.planFiles({ ...single, pogId: "s7/lop pr4" }, { 1: "12R03" }, {})[0].name, "S7LOPPR4 NEWLOC - Eagle Import.csv");
eq("no POG id", Pog.planFiles({ ...single, pogId: "" }, { 1: "12R03" }, {})[1].name, "PLAN LABELS.csv");
ok("CRLF only, no trailing newline", Pog.planFiles(plan, codes, {}).every((f) => !/[^\r]\n/.test(f.csv) && !f.csv.endsWith("\n")));

/* Sections listed out of order in the report still save in section order. */
const shuffled = { ...plan, items: [plan.items[4], plan.items[0], plan.items[5], plan.items[1]] };
eq("section order", Pog.planFiles(shuffled, codes, {})[3].csv, ["2,7000001", "1,7000002", "1,7000005", "2,7000006"].join("\r\n"));

console.log(`${failed ? "✗" : "✓"} pog.js: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
