/**
 * Ace Location Studio end-to-end suite: builds the Go binary, serves a mock
 * update manifest, and drives the real app in headless Chromium — loading
 * an Eagle export, typing codes, the preview, saving the import file (and
 * checking the bytes on disk), the replace-file prompt, the warnings, a
 * bad file, the big file, settings + persistence, and the update banner.
 *
 * Usage: node e2e/run.mjs            (from ace-location-studio/ or e2e/)
 * Env:   CHROMIUM_PATH — explicit browser executable
 */
import { spawn, execFileSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "fs";
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
  appProc = spawn(bin, ["-no-browser", "-no-exit", "-port=0"], {
    env: { ...process.env, ACE_CONFIG_DIR: cfgDir, ACE_EXPORT_DIR: exportDir, ACE_UPDATE_MANIFEST: manifest },
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
  ok("version tag", (await text("#verTag")) === "v1.0.0", await text("#verTag"));
  ok("preview explains what to do", (await text("#previewCard")).includes("Load the Eagle export"));
  ok("save is disabled", await page.$eval("#saveBtn", (b) => b.disabled));
  ok("says why", (await text("#saveBlocker")).includes("Load the Eagle export first"));
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
  ok("export log persisted", st.exports.length === 3 && st.exports[0].skus > 7 && st.exports[2].skus === 7, st.exports.map((e) => e.skus));
  ok("log card after reload", (await page.$$("#logCard tbody tr")).length === 3);
  await page.click('.tab[data-view="settings"]');
  await page.click("#sDirReset");
  await page.waitForTimeout(600);
  ok("reset to default folder", (await text("#sDirNow")).includes(exportDir));
  await shot("06-settings");

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
