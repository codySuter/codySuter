/**
 * Ace Location Studio end-to-end suite: builds the Go binary, serves a mock
 * update manifest, and drives the real app in headless Chromium — loading
 * an Eagle export, typing codes, the preview, saving the import file (and
 * checking the bytes on disk), the replace-file prompt, the warnings, a
 * bad file, the big file, settings + persistence, the update banner, and
 * the New Planogram tab (synthetic planogram PDF: section locations,
 * facings on the drawing, the import + label files, picking back up), and
 * the Compass export folder (the newest export loading by itself, a newer
 * one arriving mid-way, the stale warning, a hand-loaded file left alone),
 * Settings → Live data from Compass (a refused connection, the password
 * never leaving the backend, and — with ACE_TEST_COMPASS set — a live
 * MySQL: test + Explore).
 *
 * Usage: node e2e/run.mjs            (from ace-location-studio/ or e2e/)
 * Env:   CHROMIUM_PATH — explicit browser executable
 */
import { spawn, execFileSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "fs";
import http from "http";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const E2E = path.dirname(fileURLToPath(import.meta.url));
const APPDIR = path.join(E2E, "..");
const DATA = path.join(APPDIR, "testdata");
const SHOTS = path.join(E2E, "screenshots");
mkdirSync(SHOTS, { recursive: true });

const { chromium } = await import("playwright");
const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const EXECUTABLE = process.env.CHROMIUM_PATH || (existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined);

let appProc = null, mockSrv = null, page = null;
const pageErrors = [];
function cleanup() {
  try { if (appProc) appProc.kill(); } catch {}
  try { if (mockSrv) mockSrv.close(); } catch {}
}
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { cleanup(); process.exit(130); });

let failures = 0;
function ok(name, cond, extra) {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${name}${!cond && extra !== undefined ? ` — ${typeof extra === "string" ? extra : JSON.stringify(extra)}` : ""}`);
  if (!cond) { failures++; process.exitCode = 1; }
}
async function shot(name) { await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); }
const text = (sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, " ").trim());
const val = (sel) => page.$eval(sel, (e) => e.value);
const has = async (sel) => !!(await page.$(sel));

/* Mock GitHub release: a manifest advertising a newer build. */
function startMockUpdate() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.url.startsWith("/dist/version.json")) {
        const port = srv.address().port;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ version: "9.9.9", url: `http://127.0.0.1:${port}/dist/AceLocationStudio.exe`, sha256: "0".repeat(64), notes: "Test build notes." }));
      } else { res.statusCode = 404; res.end(); }
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

async function addCode(code) {
  await page.fill("#codeInput", code);
  await page.press("#codeInput", "Enter");
  await page.waitForTimeout(80);
}

const HEADER = "SKU,Location 1,Location 2,Location 3,Location 4,Location 5,Location 6";

async function run() {
  console.log("→ Building ace-location-studio…");
  const bin = path.join(mkdtempSync(path.join(os.tmpdir(), "als-e2e-")), "acelocationstudio");
  execFileSync("go", ["build", "-o", bin, "."], { cwd: APPDIR, stdio: "inherit" });

  mockSrv = await startMockUpdate();
  const manifest = `http://127.0.0.1:${mockSrv.address().port}/dist/version.json`;
  const cfgDir = mkdtempSync(path.join(os.tmpdir(), "als-cfg-"));
  const outRoot = mkdtempSync(path.join(os.tmpdir(), "als-out-"));
  const exportDir = path.join(outRoot, "3apps", "Temp"); // created by the app on first save
  const watchDir = path.join(outRoot, "Epicor Exports");  // where Compass saves its exports
  mkdirSync(watchDir);
  // A stand-in Compass: when it starts, its "startup task" saves an export
  // into the watched folder a moment later; it runs until asked to close.
  const fakeCompass = path.join(outRoot, "Compass", "Conductor.exe");
  mkdirSync(path.dirname(fakeCompass));
  writeFileSync(fakeCompass, `#!/bin/sh
trap 'kill $! 2>/dev/null; exit 0' TERM
sleep 1
cp "${path.join(DATA, "compass-export.xlsx")}" "$ACE_WATCH_DIR/ALS Locations.xlsx"
sleep 300 &
wait
`, { mode: 0o755 });
  process.on("exit", () => { try { execFileSync("pkill", ["-f", fakeCompass]); } catch {} });
  appProc = spawn(bin, ["-no-browser", "-no-exit", "-port=0"], {
    env: { ...process.env, ACE_CONFIG_DIR: cfgDir, ACE_EXPORT_DIR: exportDir, ACE_WATCH_DIR: watchDir, ACE_COMPASS_EXE: fakeCompass, ACE_UPDATE_MANIFEST: manifest },
  });
  const url = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("app didn't start")), 15000);
    appProc.stdout.on("data", (d) => { const m = String(d).match(/ACE_LOCATION_STUDIO_URL (\S+)/); if (m) { clearTimeout(t); resolve(m[1]); } });
    appProc.stderr.on("data", (d) => process.stderr.write(d));
  });
  console.log(`→ App at ${url}`);

  const browser = await chromium.launch({ ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}), args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: url });
  page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of 4\d\d/.test(m.text())) pageErrors.push(m.text()); });
  await page.goto(url);
  await page.waitForSelector("#stepFile .dropzone");

  /* ---------- update banner ---------- */
  console.log("\n# Update banner");
  await page.waitForSelector("#updateBar.show", { timeout: 8000 }).catch(() => {});
  ok("banner shows the newer version", (await text("#updateText")).includes("v9.9.9"), await text("#updateText"));
  ok("banner offers Update & Restart", (await text("#updateBtn")) === "Update & Restart");
  await page.click("#updateDismiss");

  /* ---------- empty state ---------- */
  console.log("\n# Before a file is loaded");
  ok("version tag", (await text("#verTag")) === "v1.4.0", await text("#verTag"));
  ok("preview explains what to do", (await text("#previewCard")).includes("Load the location data"));
  ok("save is disabled", await page.$eval("#saveBtn", (b) => b.disabled));
  ok("says why", (await text("#saveBlocker")).includes("Load the location data first"));
  ok("watching the empty Compass folder", (await text("#watchHint")).includes("no Compass export there yet"), await text("#watchHint").catch(() => ""));
  ok("destination is the export folder", (await text("#destDir")) === exportDir, await text("#destDir"));
  await shot("01-empty");

  /* ---------- load the export ---------- */
  console.log("\n# Load the Eagle export");
  await page.setInputFiles("#fileInput", path.join(DATA, "eagle-sample.xls"));
  await page.waitForSelector("#stepFile .file-meta");
  ok("file loaded", (await text("#stepFile .file-meta")).includes("eagle-sample.xls"));
  ok("SKU count + layout", (await text("#stepFile .file-meta")).includes("9 SKUs · Sheet1 · Eagle location export"), await text("#stepFile .file-meta"));
  ok("step 1 ticked", await has("#stepFile .step-n.done"));
  ok("preview shows the file as loaded", (await page.$$("#previewTable tbody tr")).length === 9);
  ok("still asks for codes", (await text("#saveBlocker")).includes("Add the location codes"));

  /* ---------- codes ---------- */
  console.log("\n# Type a code");
  await addCode("12r");
  ok("code upper-cased into a chip", (await text(".code-chip")).startsWith("12R"), await text(".code-chip"));
  ok("chip shows the count", (await text(".code-chip .chip-n")) === "8", await text(".code-chip .chip-n"));
  ok("detail: 8 locations on 7 SKUs", (await text(".code-detail .cd-head")).includes("8 locations on 7 SKUs"), await text(".code-detail .cd-head"));
  ok("detail lists the matched codes", (await text(".cd-values")).includes("12R01, 12R02, 12R04"), await text(".cd-values"));
  ok("detail splits shelf vs overstock", (await text(".cd-where")) === "Location 1: 5 · Overstock: 3", await text(".cd-where"));
  ok("Location 2 match is left alone + reported", (await text("#protectedNote")).includes("12R06 in Location 2 on SKU 6209563"), await text("#protectedNote"));
  ok("tiles: in import", (await text("#tSkus")) === "7");
  ok("tiles: cleared", (await text("#tCells")) === "8");
  ok("tiles: left out", (await text("#tSame")) === "2");
  const prev = await page.$$eval("#previewTable tbody tr", (rs) => rs.map((r) => [...r.cells].map((c) => c.innerText.replace(/\s+/g, " ").trim())));
  ok("preview has only the import rows", prev.length === 7 && prev.every((r) => r[0] !== "6209563" && r[0] !== "5555555"), prev.map((r) => r[0]));
  ok("cleared cell shows ? and the old code", prev[0][2] === "? 12R02", prev[0]);
  ok("capacity untouched", prev[0][4] === "6");
  ok("other aisle kept, overstock cleared", prev[3][2] === "14L05" && prev[3][5] === "? 12R01", prev[3]);
  ok("flag kept", prev[4][3] === "MDONE", prev[4]);
  ok("auto file name", (await val("#nameInput")) === "12R LOCCLEAR - Eagle Import.csv", await val("#nameInput"));
  ok("save button counts SKUs", (await text("#saveBtn")).includes("7 SKUs"));
  await page.click('[data-mode="all"]');
  ok("All SKUs view shows every row", (await page.$$("#previewTable tbody tr")).length === 9);
  ok("unchanged rows are dimmed", (await page.$$("#previewTable tbody tr.same")).length === 2);
  await page.click('[data-mode="import"]');
  await page.fill("#prevFilter", "MDONE");
  ok("search filters the preview", (await page.$$("#previewTable tbody tr")).length === 1);
  await page.fill("#prevFilter", "");
  await shot("02-preview");

  console.log("\n# Which locations a code clears");
  const pick = (code, slot) => page.click(`[data-slot-code="${code}"][data-slot="${slot}"]`);
  const pressed = () => page.$$eval('[data-slot-code="12R"]', (bs) => bs.map((b) => b.getAttribute("aria-pressed") === "true" ? 1 : 0).join(""));
  ok("slots: Loc 1, 4, 5, 6 ticked by default", (await pressed()) === "100111", await pressed());
  for (const s of [3, 4, 5]) await pick("12R", s); // shelf only
  ok("slots: Loc 1 only → shelf locations only", (await text("#tSkus")) === "5" && (await text("#tCells")) === "5" && (await text(".cd-where")) === "Location 1: 5", [await text("#tSkus"), await text(".cd-where")]);
  ok("slots: unticked overstock reported as left alone", (await text("#protectedNote")).includes("12R06 in Location 4 on SKU 779600"), await text("#protectedNote"));
  ok("slots: preview locks the unticked columns", await page.$$eval("#previewTable thead th.loc-h", (hs) => hs.map((h) => h.classList.contains("locked") ? 1 : 0).join("")) === "011111");
  for (const s of [3, 4, 5]) await pick("12R", s);
  await pick("12R", 1); // Location 2 too
  ok("slots: ticking Loc 2 warns", (await text(".risky-slots")).includes("Location 2 (flag)"), await text(".risky-slots").catch(() => ""));
  ok("slots: and clears the flag match", (await text("#tSkus")) === "8" && (await text("#tCells")) === "9");
  await pick("12R", 1);
  for (const s of [0, 3, 4, 5]) await pick("12R", s);
  ok("slots: none ticked says so", (await text(".no-slots")).includes("won't clear anything") && (await page.$eval("#saveBtn", (b) => b.disabled)));
  for (const s of [0, 3, 4, 5]) await pick("12R", s);
  ok("slots: back to the default", (await pressed()) === "100111" && (await text("#tSkus")) === "7" && (await text("#tCells")) === "8");

  /* ---------- save ---------- */
  console.log("\n# Save the import file");
  await page.click("#saveBtn");
  await page.waitForSelector("#savedNote");
  const file = path.join(exportDir, "12R LOCCLEAR - Eagle Import.csv");
  ok("export folder created + file written", existsSync(file));
  const want = [HEADER,
    "70013,?,,6,,,",
    "70018,?,,5,USTOR,,",
    "779600,?,,100,?,,",
    "3008391,14L05,,4,?,,",
    "6707640,?,MDONE,,,,",
    "7000137D,?,,3,,,",
    "9087035,,,,?,,"].join("\r\n");
  const got = readFileSync(file, "utf8");
  ok("file is exactly the Eagle import layout", got === want, JSON.stringify(got));
  ok("saved note shows the path", (await text("#savedNote")).includes(file));
  ok("step 3 ticked", await has("#stepSave .step-n.done"));
  ok("logged", (await text("#logCard")).includes("12R LOCCLEAR - Eagle Import.csv"));
  await page.click("#savedCopy");
  ok("copy path", (await page.evaluate(() => navigator.clipboard.readText())) === file);
  await shot("03-saved");

  console.log("\n# Saving over an existing file asks first");
  writeFileSync(file, "SENTINEL");
  await page.click("#saveBtn");
  await page.waitForSelector(".modal");
  ok("asks to replace", (await text(".modal")).includes("Replace the existing file?"));
  await page.click('.modal [data-act="cancel"]');
  await page.waitForTimeout(150);
  ok("cancel keeps the old file", readFileSync(file, "utf8") === "SENTINEL");
  await page.click("#saveBtn");
  await page.waitForSelector(".modal");
  await page.click('.modal [data-act="ok"]');
  await page.waitForSelector("#savedNote");
  ok("replace writes the new file", readFileSync(file, "utf8") === want);

  /* ---------- more codes + warnings ---------- */
  console.log("\n# More codes and warnings");
  await addCode("14L05, zzz");
  ok("comma list adds both", (await page.$$(".code-chip")).length === 3);
  ok("name follows the codes", (await val("#nameInput")) === "12R 14L05 ZZZ LOCCLEAR - Eagle Import.csv", await val("#nameInput"));
  ok("no-match warning", (await text("#stepCodes")).includes("starts with ZZZ"));
  const r3008391 = await page.$$eval("#previewTable tbody tr", (rs) => rs.map((r) => r.innerText.replace(/\s+/g, " ").trim()).find((t) => t.startsWith("3008391")));
  ok("both slots cleared on one SKU", r3008391.includes("? 14L05") && r3008391.includes("? 12R01"), r3008391);
  await page.click('[data-remove="ZZZ"]');
  await page.click('[data-remove="14L05"]');
  ok("chips removed", (await page.$$(".code-chip")).length === 1);
  await addCode("12R03");
  ok("covered code noted", (await text("#stepCodes")).includes("Already covered by 12R"));
  await page.click('[data-remove="12R03"]');
  await addCode("1");
  ok("short-code warning", (await text("#stepCodes")).includes("Short code"));
  await page.click('[data-remove="1"]');
  await page.fill("#codeInput", "12R034");
  await page.press("#codeInput", "Enter");
  ok("too-long code refused", (await text("#codeError")).includes("at most 5 characters"));
  ok("…and left in the box to fix", (await val("#codeInput")) === "12R034");
  await page.fill("#codeInput", "");

  console.log("\n# Custom file name");
  await page.fill("#nameInput", "aisle 12 reset");
  await page.$eval("#nameInput", (i) => i.blur());
  ok(".csv added", (await val("#nameInput")) === "aisle 12 reset.csv");
  ok("reset link offered", await has("#nameReset"));
  await page.fill("#nameInput", "bad/name.csv");
  ok("bad name disables save", await page.$eval("#saveBtn", (b) => b.disabled));
  await page.$eval("#nameInput", (i) => i.blur());
  await page.click("#nameReset");
  ok("back to the auto name", (await val("#nameInput")) === "12R LOCCLEAR - Eagle Import.csv");

  /* ---------- bad file, big file ---------- */
  console.log("\n# A file that isn't an Eagle export");
  await page.setInputFiles("#fileInput", { name: "notes.csv", mimeType: "text/csv", buffer: Buffer.from("Item,Bin\n1,2\n") });
  await page.waitForSelector("#fileError");
  ok("explains the problem", (await text("#fileError")).includes("SKU"), await text("#fileError"));
  ok("keeps the loaded file", (await text("#stepFile .file-meta")).includes("eagle-sample.xls"));

  console.log("\n# A big export");
  await page.setInputFiles("#fileInput", path.join(DATA, "eagle-big.xls"));
  await page.waitForFunction(() => document.querySelector("#stepFile .file-meta")?.innerText.includes("eagle-big.xls"));
  ok("1,209 SKUs", (await text("#stepFile .file-meta")).includes("1,209 SKUs"));
  ok("codes carry over", (await page.$$(".code-chip")).length === 1);
  await page.click('[data-mode="all"]');
  ok("preview capped, with a note", (await page.$$("#previewTable tbody tr")).length === 1000 && (await text("#previewCard")).includes("Showing the first 1,000 of 1,209"));
  await page.click('[data-mode="import"]');
  await shot("04-big");

  /* ---------- settings + persistence ---------- */
  console.log("\n# Settings");
  await page.click('.tab[data-view="settings"]');
  const other = path.join(outRoot, "other");
  await page.fill("#sDir", other);
  await page.waitForTimeout(600);
  ok("settings show the folder", (await text("#sDirNow")).includes(other));
  await page.click('.tab[data-view="clear"]');
  ok("save step uses the new folder", (await text("#destDir")) === other);
  await page.click("#saveBtn");
  await page.waitForSelector("#savedNote");
  ok("saved into the new folder", readdirSync(other).includes("12R LOCCLEAR - Eagle Import.csv"));
  await shot("05-settings-folder");

  await page.reload();
  await page.waitForSelector("#stepFile .dropzone");
  ok("folder setting persisted", (await text("#destDir")) === other);
  const st = await page.evaluate(() => fetch("/api/state").then((r) => r.json()));
  ok("log records which locations each code cleared", JSON.stringify(st.exports[0].slots) === JSON.stringify({ "12R": [0, 3, 4, 5] }), st.exports[0].slots);
  ok("export log persisted", st.exports.length === 3 && st.exports[0].skus > 7 && st.exports[2].skus === 7, st.exports.map((e) => e.skus));
  ok("log card after reload", (await page.$$("#logCard tbody tr")).length === 3);
  await page.click('.tab[data-view="settings"]');
  await page.click("#sDirReset");
  await page.waitForTimeout(600);
  ok("reset to default folder", (await text("#sDirNow")).includes(exportDir));
  await shot("06-settings");

  /* ---------- the Compass export folder ---------- */
  console.log("\n# Compass export folder");
  const sWatch = () => page.waitForFunction(() => document.querySelector("#sWatchNow")?.innerText.trim()).then(() => text("#sWatchNow"));
  ok("watch: settings show the empty folder", (await sWatch()).includes("no export there yet"), await text("#sWatchNow"));
  const exportFile = path.join(watchDir, "ALS Locations.xlsx");
  const putExport = (agoMs) => {
    copyFileSync(path.join(DATA, "compass-export.xlsx"), exportFile);
    const t = new Date(Date.now() - agoMs);
    utimesSync(exportFile, t, t);
  };
  putExport(10 * 60000);
  await page.click('.tab[data-view="clear"]'); // opening the tab checks the folder
  await page.waitForSelector("#freshLine");
  ok("watch: loads the newest export by itself", (await text("#stepFile .file-meta")).includes("ALS Locations.xlsx") && (await text("#stepFile .file-meta")).includes("9 SKUs · Sheet1 · Compass export"), await text("#stepFile .file-meta"));
  ok("watch: says when Compass saved it", (await text("#freshLine")).includes("(10 min ago)"), await text("#freshLine"));
  ok("watch: not stale", !(await has("#staleNote")));
  await addCode("12R");
  ok("watch: clearing works on Compass data", (await text("#tSkus")) === "7" && (await text("#tCells")) === "8", [await text("#tSkus"), await text("#tCells")]);
  await shot("06b-compass-export");

  putExport(90 * 1000); // Compass saved again while codes are typed
  await page.evaluate(() => ClearView.checkWatch());
  await page.waitForSelector("#newerNote");
  ok("watch: newer export mid-way shows a banner", (await text("#newerNote")).includes("Your codes stay"), await text("#newerNote"));
  ok("watch: data not swapped underneath", (await text("#freshLine")).includes("(10 min ago)"));
  await page.click("#newerLoad");
  await page.waitForFunction(() => document.querySelector("#freshLine")?.innerText.includes("(1 min ago)"));
  ok("watch: Load it switches to the newer export, codes kept", (await page.$$(".code-chip")).length === 1 && (await text("#tSkus")) === "7");
  ok("watch: banner gone", !(await has("#newerNote")));

  await page.click('[data-remove="12R"]'); // idle again
  putExport(20 * 1000);
  await page.evaluate(() => ClearView.checkWatch());
  await page.waitForFunction(() => document.querySelector("#freshLine")?.innerText.includes("just now"));
  ok("watch: with no codes typed, a newer export loads by itself", !(await has("#newerNote")));

  putExport(2 * 3600000 + 5 * 60000); // the schedule stopped two hours ago
  await page.reload();
  await page.waitForSelector("#staleNote");
  ok("watch: warns when the export is over an hour old", (await text("#staleNote")).includes("2 h 5 min old"), await text("#staleNote"));
  await shot("06c-compass-stale");

  await page.setInputFiles("#fileInput", path.join(DATA, "eagle-sample.xls")); // loaded by hand
  await page.waitForFunction(() => document.querySelector("#stepFile .file-meta")?.innerText.includes("eagle-sample.xls"));
  await page.waitForTimeout(6500);
  putExport(5500);
  await page.evaluate(() => ClearView.checkWatch());
  await page.waitForSelector("#newerNote");
  ok("watch: a hand-loaded file isn't replaced by itself", (await text("#stepFile .file-meta")).includes("eagle-sample.xls"));

  /* "Get fresh data from Compass": starts Compass, whose startup task saves an export */
  await addCode("12R");
  await page.click("#freshBtn");
  // "Starting Compass…" first, then the waiting note once Compass has started.
  const waiting = await page.waitForFunction(() => document.querySelector("#freshNote")?.innerText.includes("Waiting for Compass's export"), null, { timeout: 15000 }).then(() => true, () => false);
  ok("fresh: waits for Compass's export", waiting, await text("#freshNote").catch(() => "(no note)"));
  await page.waitForFunction(() => document.querySelector("#freshLine")?.innerText.includes("just now"), null, { timeout: 30000 });
  ok("fresh: Compass's new export loads, even with codes typed", (await text("#stepFile .file-meta")).includes("ALS Locations.xlsx") && (await page.$$(".code-chip")).length === 1 && (await text("#tSkus")) === "7");
  ok("fresh: waiting note gone, button back", !(await has("#freshNote")) && (await has("#freshBtn")));
  ok("fresh: Compass is running", execFileSync("pgrep", ["-f", fakeCompass]).toString().trim().split("\n").length === 1);
  await shot("06d-fresh-from-compass");

  const pidBefore = execFileSync("pgrep", ["-f", fakeCompass]).toString().trim();
  await page.click("#freshBtn"); // Compass is open now: asks before restarting it
  await page.waitForSelector(".modal");
  ok("fresh: asks before restarting an open Compass", (await text(".modal")).includes("Restart Compass?"));
  await page.click('.modal [data-act="cancel"]');
  await page.waitForTimeout(300);
  ok("fresh: cancel leaves Compass alone", execFileSync("pgrep", ["-f", fakeCompass]).toString().trim() === pidBefore && !(await has("#freshNote")));
  await page.waitForTimeout(1100); // so the next export's time is clearly newer
  await page.click("#freshBtn");
  await page.waitForSelector(".modal");
  await page.click('.modal [data-act="ok"]');
  await page.waitForSelector("#freshNote");
  await page.waitForFunction(() => !document.querySelector("#freshNote"), null, { timeout: 30000 });
  const pidAfter = execFileSync("pgrep", ["-f", fakeCompass]).toString().trim();
  ok("fresh: restart closes Compass and starts it again", pidAfter && pidAfter !== pidBefore && pidAfter.split("\n").length === 1, [pidBefore, pidAfter]);
  ok("fresh: and loads its new export", (await text("#freshLine")).includes("just now"));
  await page.click('[data-remove="12R"]');

  await page.click('.tab[data-view="settings"]');
  await page.fill("#sWatch", path.join(outRoot, "nowhere"));
  await page.waitForFunction(() => document.querySelector("#sWatchNow")?.innerText.includes("doesn't exist yet"));
  ok("watch: a missing folder is explained", true);
  await page.click("#sWatchReset");
  await page.waitForFunction(() => document.querySelector("#sWatchNow")?.innerText.includes("ALS Locations.xlsx"));
  ok("watch: settings show the newest export", (await text("#sWatchNow")).includes("over an hour old") === false, await text("#sWatchNow"));
  await page.uncheck("#sWatchOn");
  await page.waitForFunction(() => document.querySelector("#sWatchNow")?.innerText.startsWith("Off"));
  await page.waitForTimeout(500);
  await page.reload();
  await page.click('.tab[data-view="clear"]');
  await page.waitForSelector("#stepFile .dropzone");
  await page.waitForTimeout(800);
  ok("watch: turned off, nothing loads by itself", await has("#stepFile .dropzone") && !(await has("#watchHint")));

  /* ---------- new planogram ---------- */
  console.log("\n# New planogram");
  await page.click('.tab[data-view="plan"]');
  ok("plan: save disabled before a PDF", await page.$eval("#planSaveBtn", (b) => b.disabled));
  ok("plan: says why", (await text("#planBlocker")).includes("Load the planogram PDF first"));
  await page.setInputFiles("#pogInput", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await page.waitForSelector("#pogError");
  ok("plan: non-PDF refused", (await text("#pogError")).includes("isn't a PDF"), await text("#pogError"));
  await page.setInputFiles("#pogInput", path.join(DATA, "pog-sample.pdf"));
  await page.waitForSelector("#hotspots .hs", { timeout: 20000 });
  ok("plan: POG + title", (await text("#planFileStep .file-meta b")).startsWith("SYNTH8FT · TEST SHELF 8FT NA NATIONAL"), await text("#planFileStep .file-meta b"));
  ok("plan: counts + live date", (await text("#planMeta")) === "7 SKUs · 2 sections · live 9/22/2026", await text("#planMeta"));
  ok("plan: tabs per section + cover", (await page.$$eval("#segTabs button", (bs) => bs.map((b) => b.innerText.trim()))).join("|") === "Section 1|Section 2|Cover picture");
  ok("plan: section 1 drawing is clickable", (await page.$$("#hotspots .hs")).length === 4);
  const size0 = await page.$eval("#drawWrap canvas", (c) => [c.clientWidth, c.clientHeight]);
  ok("plan: drawing fits the window", size0[0] > 80 && size0[1] > 400 && size0[1] <= 900 - 250, size0);
  await page.click("#zoomIn");
  await page.waitForFunction((h) => document.querySelector("#drawWrap canvas")?.clientHeight > h * 1.4, size0[1]);
  ok("plan: zoom in", (await text("#zoomFit")) === "150%");
  ok("plan: hotspots follow the zoom", await page.$eval('#hotspots .hs[data-sku="7000001"]', (b) => b.offsetLeft > 0));
  await page.click("#zoomFit");
  await page.waitForFunction((h) => Math.abs(document.querySelector("#drawWrap canvas")?.clientHeight - h) < 2, size0[1]);
  ok("plan: list has every SKU", (await page.$$("#planTable tbody tr")).length === 7);
  ok("plan: needs locations", (await text("#planBlocker")).includes("Give 2 sections a location first"));

  await page.fill("#loc-1", "12r03");
  ok("plan: next section suggested", (await page.$eval("#loc-2", (i) => i.placeholder)) === "12R04");
  await page.click("#locFill");
  ok("plan: fill the rest", (await val("#loc-2")) === "12R04");
  ok("plan: step 2 ticked", await has("#planLocStep .step-n.done"));
  ok("plan: tab shows location", (await text('#segTabs [data-tab="1"]')) === "Section 1 · 12R03");
  const names = await page.$$eval("#planFiles .pf-name", (ns) => ns.map((n) => n.textContent));
  ok("plan: four files listed", names.join("|") === "SYNTH8FT NEWLOC - Eagle Import.csv|SYNTH8FT LABELS 12R03.csv|SYNTH8FT LABELS 12R04.csv|SYNTH8FT LABELS ALL.csv", names);
  await page.fill("#loc-2", "12R0345");
  await page.press("#loc-2", "Tab");
  ok("plan: maxlength keeps codes to 5", (await val("#loc-2")).length === 5);
  await page.fill("#loc-2", "12R?");
  await page.press("#loc-2", "Tab");
  ok("plan: bad code flagged", (await text("#locErr-2")).includes("letters, numbers"));
  ok("plan: bad code blocks saving", await page.$eval("#planSaveBtn", (b) => b.disabled));
  await page.fill("#loc-2", "12R04");
  ok("plan: error clears once fixed", !(await text("#locErr-2")));

  console.log("\n# Facings");
  await page.click('#hotspots .hs[data-sku="7000001"]');
  ok("plan: click selects", (await text("#selBar")).includes("7000001") && (await text("#selBar")).includes("of 2 facings"));
  ok("plan: plan capacity", (await text("#selCap")) === "12");
  await page.keyboard.press("-");
  ok("plan: − key takes a facing", (await text("#selFacings")) === "1");
  ok("plan: capacity scales 12 → 6", (await text("#selCap")) === "6" && (await text("#selBar")).includes("12 → 6"), await text("#selBar"));
  ok("plan: drawing marks it", await page.$eval('#hotspots .hs[data-sku="7000001"]', (b) => b.classList.contains("reduced") && b.innerText.trim() === "1/2"));
  ok("plan: tab counts the change", (await text('#segTabs [data-tab="1"] .tab-n')) === "1");
  ok("plan: list shows it", (await page.$eval('#planTable tr[data-sku="7000001"] td.cap', (td) => td.innerText.trim())) === "6");
  ok("plan: + capped at the plan", await page.$eval("#selPlus", (b) => !b.disabled) && (await page.click("#selPlus"), (await text("#selFacings")) === "2") && await page.$eval("#selPlus", (b) => b.disabled));
  await page.click("#selMinus");
  await page.click('#planTable tr[data-sku="7000006"]');
  await page.waitForFunction(() => document.querySelector("#segTabs button.active")?.dataset.tab === "2");
  await page.waitForSelector('#hotspots .hs.sel[data-sku="7000006"]');
  ok("plan: list click jumps to its section", true);
  await page.click("#selMinus");
  ok("plan: 5 at 2 facings → 2", (await text("#selCap")) === "2");
  await page.click("#selMinus");
  ok("plan: 0 facings drops it", (await text("#selBar")).includes("Dropped"));
  ok("plan: dropped on drawing", await page.$eval('#hotspots .hs[data-sku="7000006"]', (b) => b.classList.contains("dropped")));
  ok("plan: overhanging label shown faded", await page.$eval('#hotspots .hs[data-sku="7000004"]', (b) => b.classList.contains("other-seg")));
  ok("plan: list counts", (await text("#planCounts")) === "7 SKUs · 1 with fewer facings · 1 dropped", await text("#planCounts"));
  await page.click('#planTable tr[data-sku="7000004"]');
  ok("plan: no REC QTY explained", (await text("#selBar")).includes("No REC QTY"));
  await page.keyboard.press("Escape");
  ok("plan: Esc deselects", (await text("#selBar")).includes("Click a product"));
  await page.click('[data-tab="cover"]');
  await page.waitForFunction(() => document.querySelector("#drawWrap canvas") && !document.querySelector("#hotspots .hs"));
  ok("plan: cover picture tab", true);
  await page.click('[data-tab="1"]');
  await page.waitForSelector("#hotspots .hs");
  await shot("07-plan");

  console.log("\n# Save the plan files");
  await page.click("#planSaveBtn");
  await page.waitForSelector("#planSavedNote");
  const pf = (n) => readFileSync(path.join(exportDir, n), "utf8");
  ok("plan: Eagle import", pf("SYNTH8FT NEWLOC - Eagle Import.csv") === ["SKU,Location 1,Location 3", "7000001,12R03,6", "7000002,12R03,3", "7000003,12R03,3", "7000004,12R03,", "7000005,12R04,2", "7000137D,12R04,4"].join("\r\n"), JSON.stringify(pf("SYNTH8FT NEWLOC - Eagle Import.csv")));
  ok("plan: labels 12R03", pf("SYNTH8FT LABELS 12R03.csv") === ["1,7000001", "1,7000002", "3,7000003", "1,7000004"].join("\r\n"), JSON.stringify(pf("SYNTH8FT LABELS 12R03.csv")));
  ok("plan: labels 12R04", pf("SYNTH8FT LABELS 12R04.csv") === ["1,7000005", "1,7000137D"].join("\r\n"), JSON.stringify(pf("SYNTH8FT LABELS 12R04.csv")));
  ok("plan: labels ALL", pf("SYNTH8FT LABELS ALL.csv") === pf("SYNTH8FT LABELS 12R03.csv") + "\r\n" + pf("SYNTH8FT LABELS 12R04.csv"));
  ok("plan: saved note lists 4 files", (await page.$$("#planSavedNote .saved-list li")).length === 4);
  await shot("08-plan-saved");

  console.log("\n# Picks up where you left off");
  await page.waitForFunction(async () => {
    const st = await fetch("/api/state", { cache: "no-store" }).then((r) => r.json());
    const p = st.plans && st.plans.SYNTH8FT;
    return !!p && p.facings["7000006"] === 0 && p.codes["2"] === "12R04";
  }, null, { polling: 100, timeout: 5000 });
  ok("plan: changes saved to disk", true);
  await page.reload();
  await page.waitForSelector('.tab.active[data-view="plan"]');
  ok("plan: reopens on the last tab", true);
  await page.setInputFiles("#pogInput", path.join(DATA, "pog-sample.pdf"));
  await page.waitForSelector("#hotspots .hs", { timeout: 20000 });
  ok("plan: restored notice", (await text("#planRestored")).includes("Picked up where you left off"));
  ok("plan: codes restored", (await val("#loc-1")) === "12R03" && (await val("#loc-2")) === "12R04");
  ok("plan: facings restored", (await page.$eval('#planTable tr[data-sku="7000001"] td.cap', (td) => td.innerText.trim())) === "6");

  // A change made right before the window closes still gets saved: close
  // the page outright (its timers die with it) and open a fresh one.
  await page.click('#planTable tr[data-sku="7000002"]');
  await page.keyboard.press("-");
  await page.close();
  page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of 4\d\d/.test(m.text())) pageErrors.push(m.text()); });
  await page.goto(url);
  await page.waitForSelector('.tab.active[data-view="plan"]');
  const flushed = await page.waitForFunction(async () => {
    const st = await fetch("/api/state", { cache: "no-store" }).then((r) => r.json());
    return st.plans && st.plans.SYNTH8FT && st.plans.SYNTH8FT.facings["7000002"] === 0;
  }, null, { polling: 100, timeout: 5000 }).then(() => true, () => false);
  ok("plan: last change saved as the window closes", flushed);
  await page.setInputFiles("#pogInput", path.join(DATA, "pog-sample.pdf"));
  await page.waitForSelector("#hotspots .hs", { timeout: 20000 });

  console.log("\n# Same location for both sections, replacing files");
  await page.fill("#loc-2", "12R03");
  const names2 = await page.$$eval("#planFiles .pf-name", (ns) => ns.map((n) => n.textContent));
  ok("plan: one location → one label file", names2.join("|") === "SYNTH8FT NEWLOC - Eagle Import.csv|SYNTH8FT LABELS.csv", names2);
  await page.click("#planSaveBtn");
  await page.waitForSelector(".modal");
  ok("plan: asks before replacing the import", (await text(".modal")).includes("Replace the existing file?") && (await text(".modal")).includes("NEWLOC"));
  await page.click('.modal [data-act="ok"]');
  await page.waitForSelector("#planSavedNote");
  ok("plan: replaced import uses one location", pf("SYNTH8FT NEWLOC - Eagle Import.csv").includes("7000005,12R03,2"));
  ok("plan: single label file (both drops left out)", pf("SYNTH8FT LABELS.csv").split("\r\n").length === 5 && !pf("SYNTH8FT LABELS.csv").includes("7000002"));

  await page.click("#planStartOver");
  await page.click('.modal [data-act="ok"]');
  ok("plan: start over clears codes and facings", (await val("#loc-1")) === "" && (await page.$$("#planTable tr.reduced, #planTable tr.dropped")).length === 0);

  await page.click('.tab[data-view="clear"]');
  ok("plan saves in the log", (await text("#logCard")).includes("New plan"));

  /* ---------- live data from Compass ---------- */
  console.log("\n# Compass connection");
  await page.click('.tab[data-view="settings"]');
  await page.waitForSelector("#cpServer");
  ok("compass: not set up yet", (await text("#compassCard .cp-status")) === "Not set up");
  ok("compass: explore needs settings first", await page.$eval("#cpExplore", (b) => b.disabled));
  const closed = await new Promise((resolve) => { const s = http.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  await page.fill("#cpServer", "127.0.0.1");
  await page.fill("#cpPort", String(closed));
  await page.fill("#cpDb", "compass");
  await page.fill("#cpUser", "mm");
  await page.fill("#cpPass", "pw-e2e-secret");
  await page.click("#cpSave");
  await page.waitForSelector("#cpCheckList", { timeout: 30000 });
  const checks = await page.$$eval("#cpCheckList li", (ls) => ls.map((l) => l.className + ":" + l.querySelector("b").textContent));
  ok("compass: closed port caught", checks.includes("fail:MySQL port") && checks.includes("skip:MySQL login"), checks);
  ok("compass: says it isn't connected", (await text("#compassCard .cp-status")).includes("Not connected"));
  ok("compass: password field cleared", (await val("#cpPass")) === "" && (await page.$eval("#cpPass", (i) => i.placeholder)).includes("Saved"));
  const pub = await page.evaluate(() => fetch("/api/compass/settings").then((r) => r.text()));
  ok("compass: password never sent back", !pub.includes("pw-e2e-secret") && pub.includes('"hasPassword":true'), pub);
  const stTxt = await page.evaluate(() => fetch("/api/state").then((r) => r.text()));
  ok("compass: password not in state.json", !stTxt.includes("pw-e2e-secret"));
  ok("compass: password not on the page", !(await page.content()).includes("pw-e2e-secret"));
  ok("compass: password not stored in plain text", !readFileSync(path.join(cfgDir, "compass.json"), "utf8").includes("pw-e2e-secret"));
  await shot("09-compass-fail");

  // A live server, when one is available (CI loads testdata/compass-seed.sql).
  if (process.env.ACE_TEST_COMPASS) {
    const [h, p, db, u, pw] = process.env.ACE_TEST_COMPASS.split(":");
    await page.fill("#cpServer", h);
    await page.fill("#cpPort", p);
    await page.fill("#cpDb", db);
    await page.fill("#cpUser", u);
    await page.fill("#cpPass", pw);
    await page.click("#cpSave");
    await page.waitForFunction(() => document.querySelector("#cpCheckList") && !document.querySelector("#cpSave").disabled, null, { timeout: 60000 });
    const live = await page.$$eval("#cpCheckList li", (ls) => ls.map((l) => l.className + ":" + l.querySelector("b").textContent));
    ok("compass: live server passes", live.every((c) => c.startsWith("pass:") || c.startsWith("warn:")) && (await text("#compassCard .cp-status")).includes("Connected"), live);
    ok("compass: inventory rows counted", (await text("#cpCheckList")).includes("IN table has 3 rows"));
    await page.fill("#cpSku", "70013");
    await page.fill("#cpLoc", "12r02");
    await page.click("#cpExplore");
    await page.waitForSelector("#cpReportText", { timeout: 120000 });
    const found = await text("#cpFound");
    ok("compass: explore finds the SKU and location columns", found.includes("IN.ITEMNO") && found.includes("IN.LCD1"), found);
    ok("compass: report lists the location-like columns", (await text("#cpReportText")).includes("BINS.BINLOC"));
    await page.click('.tab[data-view="clear"]');
    await page.click('.tab[data-view="settings"]');
    ok("compass: remembered as connected", (await text("#compassCard .cp-status")).includes("Connected"));
    await shot("10-compass-live");
  } else {
    console.log("  (no ACE_TEST_COMPASS — skipping the live-server checks)");
  }

  ok("no page errors", pageErrors.length === 0, pageErrors);
  await browser.close();
}

run().then(() => {
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed.");
  cleanup();
  process.exit(failures ? 1 : 0);
}).catch((e) => {
  console.error(e);
  if (page) page.screenshot({ path: path.join(SHOTS, "zz-crash.png") }).catch(() => {}).finally(() => { cleanup(); process.exit(1); });
  else { cleanup(); process.exit(1); }
});
