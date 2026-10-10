/**
 * Unit tests for the clearing rules in web/js/clear.js — no browser needed.
 * Usage: node tests/unit.mjs
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
// The repo root package.json is "type": "module", so clear.js loads as ESM
// and attaches itself to globalThis instead of module.exports.
const loaded = require("../web/js/clear.js");
const Clear = loaded && loaded.planClear ? loaded : globalThis.Clear;

let failed = 0, passed = 0;
function ok(name, cond, extra) {
  if (cond) passed++;
  else { failed++; console.log(`  ✗ FAIL ${name}${extra !== undefined ? " — " + JSON.stringify(extra) : ""}`); }
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });

/* ---------- typing codes ---------- */
eq("parse one", Clear.parseCodes("12R"), ["12R"]);
eq("parse many + case + dupes", Clear.parseCodes(" 12r, 14L05;12R  ustor\n"), ["12R", "14L05", "USTOR"]);
eq("parse empty", Clear.parseCodes("  , ;"), []);
eq("problem ok", Clear.codeProblem("12R03"), "");
ok("problem too long", /at most 5/.test(Clear.codeProblem("12R034")));
ok("problem ?", /question mark/.test(Clear.codeProblem("12?")));
ok("problem empty", Clear.codeProblem("  ") !== "");
eq("covered", Clear.coveredCodes(["12R", "12R03", "14L", "14L05"]), [{ code: "12R03", by: "12R" }, { code: "14L05", by: "14L" }]);
eq("covered none", Clear.coveredCodes(["12R", "12L"]), []);

/* ---------- matching ---------- */
eq("match prefix", Clear.matchCode("12R03", ["12R"]), "12R");
eq("match exact", Clear.matchCode("12R03", ["12R03"]), "12R03");
eq("match case/space", Clear.matchCode(" 12r03 ", ["12R"]), "12R");
eq("no match other side", Clear.matchCode("12L03", ["12R"]), null);
eq("no match longer code", Clear.matchCode("12R0", ["12R03"]), null);
eq("blank never matches", Clear.matchCode("", ["12R"]), null);
eq("? never matches", Clear.matchCode("?", ["?"]), null);
eq("first code wins", Clear.matchCode("12R03", ["12R0", "12R"]), "12R0");

/* ---------- the plan: a slice shaped like the real 12LOCCLEAR export ---------- */
const rows = [
  { sku: "70013", desc: "ACE SHVL SQRPT D-HND 27\"", locs: ["12R02", "", "6", "", "", ""] },
  { sku: "70018", desc: "ACE SHVL RNDPT LONG-HND", locs: ["12R02", "", "5", "USTOR", "", ""] },
  { sku: "779600", desc: "X", locs: ["12R07", "", "100", "12R06", "", ""] },        // Loc 1 and Loc 4 both clear
  { sku: "3008391", desc: "X", locs: ["14L05", "", "4", "12R01", "", ""] },         // Loc 1 kept, Loc 4 clears
  { sku: "6209563", desc: "X", locs: ["", "12R06", "", "", "", ""] },              // only Loc 2 matches → untouched
  { sku: "6707640", desc: "X", locs: ["12R08", "MDONE", "", "", "", ""] },         // flag kept
  { sku: "7024629", desc: "X", locs: ["12R07", "16END", "8", "", "", ""] },
  { sku: "9087035", desc: "X", locs: ["", "", "", "12R04", "", ""] },              // overstock only
  { sku: "7000137D", desc: "PP30, HAND PRUNER", locs: ["12R05", "", "3", "", "", ""] },
  { sku: "5555555", desc: "other aisle", locs: ["14L02", "", "12", "107", "", ""] }, // nothing to clear
  { sku: "5555556", desc: "cap 12", locs: ["", "", "12", "", "", "12RAB"] },        // Loc 6 clears, cap 12 never
];
const plan = Clear.planClear(rows, ["12R"]);
eq("changed SKUs", plan.changed.map((r) => r.sku), ["70013", "70018", "779600", "3008391", "6707640", "7024629", "9087035", "7000137D", "5555556"]);
eq("unchanged count", plan.unchanged, 2);
eq("cells", plan.cells, 10);
eq("loc1 cleared, cap kept", plan.changed[0].after, ["?", "", "6", "", "", ""]);
eq("USTOR kept", plan.changed[1].after, ["?", "", "5", "USTOR", "", ""]);
eq("two slots", plan.changed[2].after, ["?", "", "100", "?", "", ""]);
eq("two slots list", plan.changed[2].cleared, [0, 3]);
eq("other aisle kept in loc1", plan.changed[3].after, ["14L05", "", "4", "?", "", ""]);
eq("flag kept", plan.changed[4].after, ["?", "MDONE", "", "", "", ""]);
eq("overstock only", plan.changed[6].after, ["", "", "", "?", "", ""]);
eq("loc6", plan.changed[8].after, ["", "", "12", "", "", "?"]);
eq("before untouched", plan.changed[0].before, ["12R02", "", "6", "", "", ""]);
eq("protected hit reported", plan.protectedHits, [{ sku: "6209563", slot: 1, value: "12R06", code: "12R" }]);
eq("stats", plan.stats[0].cells, 10);
eq("stats skus", plan.stats[0].skus, 9);
eq("stats values", plan.stats[0].values, ["12R01", "12R02", "12R04", "12R05", "12R06", "12R07", "12R08", "12RAB"]);
eq("stats by slot", plan.stats[0].bySlot, [6, 0, 0, 3, 0, 1]);

const p2 = Clear.planClear(rows, ["12R02", "USTOR", "107", "99Z"]);
eq("multi codes changed", p2.changed.map((r) => r.sku), ["70013", "70018", "5555555"]);
eq("multi codes after", p2.changed[1].after, ["?", "", "5", "?", "", ""]);
eq("overstock bin number", p2.changed[2].after, ["14L02", "", "12", "?", "", ""]);
eq("per-code cells", p2.stats.map((s) => s.cells), [2, 1, 1, 0]);
const capRows = [{ sku: "1", desc: "", locs: ["", "MDONE", "12", "", "", ""] }];
eq("capacity and flag never clear", Clear.planClear(capRows, ["12", "MD"]).changed.length, 0);
eq("capacity hit reported", Clear.planClear(capRows, ["12", "MD"]).protectedHits.map((h) => h.slot), [1, 2]);
eq("short code matches widely", Clear.planClear(rows, ["1"]).stats[0].values.includes("107"), true);
eq("nothing", Clear.planClear(rows, []).changed.length, 0);
eq("no rows", Clear.planClear([], ["12R"]).unchanged, 0);

/* ---------- the import file ---------- */
const csv = Clear.importCSV(plan.changed);
const lines = csv.split("\r\n");
eq("header", lines[0], "SKU,Location 1,Location 2,Location 3,Location 4,Location 5,Location 6");
eq("row", lines[1], "70013,?,,6,,,");
eq("row ustor", lines[2], "70018,?,,5,USTOR,,");
eq("row 2 slots", lines[3], "779600,?,,100,?,,");
eq("row keeps other loc", lines[4], "3008391,14L05,,4,?,,");
eq("row flag", lines[5], "6707640,?,MDONE,,,,");
eq("letter SKU", lines[8], "7000137D,?,,3,,,");
eq("line count", lines.length, plan.changed.length + 1);
ok("CRLF only", !/[^\r]\n/.test(csv));
ok("no trailing newline", !csv.endsWith("\n"));
ok("every row has 7 fields", lines.every((l) => l.split(",").length === 7));
eq("quoting", Clear.csvField('a,"b"'), '"a,""b"""');
eq("no quoting", Clear.csvField("12R03"), "12R03");
eq("empty import is header only", Clear.importCSV([]), "SKU,Location 1,Location 2,Location 3,Location 4,Location 5,Location 6");

/* ---------- file name ---------- */
eq("name", Clear.importFileName(["12R"]), "12R LOCCLEAR - Eagle Import.csv");
eq("name many", Clear.importFileName(["12R", "14L05"]), "12R 14L05 LOCCLEAR - Eagle Import.csv");
eq("name strips odd chars", Clear.importFileName(["12/R"]), "12R LOCCLEAR - Eagle Import.csv");
eq("name caps length", Clear.importFileName(["A", "B", "C", "D", "E", "F", "G", "H"]), "A B C D E F +2 more LOCCLEAR - Eagle Import.csv");
eq("name nothing", Clear.importFileName([]), "LOCCLEAR - Eagle Import.csv");

/* ---------- display helpers ---------- */
eq("natural sort", ["12R10", "12R9", "12R01"].sort(Clear.locCompare), ["12R01", "12R9", "12R10"]);
eq("summary short", Clear.valuesSummary(["A", "B"]), "A, B");
eq("summary long", Clear.valuesSummary(["1", "2", "3", "4", "5", "6", "7", "8", "9"]), "1, 2, 3, 4, 5 … 9 (9)");

console.log(`${failed ? "✗" : "✓"} clear.js: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
