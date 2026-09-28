/**
 * Ace Change Studio end-to-end suite: builds the Go binary, serves a mock
 * update manifest, and drives every major flow in headless Chromium —
 * drawer counts (reset plan, over/short, coin $-mode, edit, delete/undo),
 * the change-box order (even swap, copy, print sheet, save), settings,
 * persistence + backups, the history charts on seeded data, the smart
 * layout suggestion, and the "Update & Restart" banner.
 *
 * Usage: node e2e/run.mjs            (from ace-change-studio/ or e2e/)
 * Env:   CHROMIUM_PATH — explicit browser executable
 */
import { spawn, execFileSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from "fs";
import http from "http";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const E2E = path.dirname(fileURLToPath(import.meta.url));
const APPDIR = path.join(E2E, "..");
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
async function shot(name, opts) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), ...(opts || {}) });
}
const text = (sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, " ").trim());
const tall = async (h) => page.setViewportSize({ width: 1400, height: h || 900 });

/* Mock GitHub release: a manifest advertising a newer build. */
function startMockUpdate() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.url.startsWith("/dist/version.json")) {
        const port = srv.address().port;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ version: "9.9.9", url: `http://127.0.0.1:${port}/dist/AceChangeStudio.exe`, sha256: "0".repeat(64), notes: "Test build notes." }));
      } else { res.statusCode = 404; res.end(); }
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

/* ~6 weeks of realistic history: most drawers land within $1, some
   yellow, a few red, and Downstairs 2 drifts short. */
function seedDoc(settings) {
  const day = 86400000;
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const people = ["Alex", "Jordan", "Sam", "Taylor", "Casey"];
  const counts = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let d = 44; d >= 0; d--) {
    const date = new Date(today.getTime() - d * day);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    for (const dr of settings.drawers) {
      if (dr.id === "swap" && rnd() < 0.55) continue;
      if (dr.id !== "up1" && rnd() < 0.12) continue;
      const r = rnd();
      let os = r < 0.62 ? 0 : r < 0.82 ? Math.round((rnd() * 2 - 1) * 100) : r < 0.95 ? Math.round((rnd() * 2 - 1) * 500) : Math.round((rnd() * 2 - 1) * 2000);
      if (dr.id === "dn2" && rnd() < 0.7) os = -Math.round(300 + rnd() * 900);
      os = Math.round(os / 5) * 5;
      const expected = Math.round((200 + rnd() * 600) * 100 / 5) * 5;
      const pull = expected + os;
      counts.push({
        id: `seed-${d}-${dr.id}`, ts: date.getTime() + (17 + rnd() * 4) * 3600000, date: iso,
        drawerId: dr.id, drawerName: dr.name, start: 15000,
        cashier: people[Math.floor(rnd() * people.length)], counter: people[Math.floor(rnd() * 2)],
        counts: { b20: Math.floor(pull / 2000), b1: 60, b5: 8, b10: 3, cq: 50, cd: 50, cn: 50 },
        leave: { b10: 3, b5: 8, b1: 60, cq: 50, cd: 50, cn: 50 }, pull: { b20: Math.floor(pull / 2000) },
        totalCents: 15000 + pull, leaveCents: 15000, pullCents: pull, expectedCents: expected, overShortCents: os, exact: true, note: rnd() < 0.05 ? "Found a $5 under the tray" : "",
      });
    }
  }
  // Change box: dimes go fast, nickels barely move.
  const ideal = settings.ideal;
  const boxLogs = [];
  for (let i = 0; i < 7; i++) {
    const ts = today.getTime() - (42 - i * 6) * day + 10 * 3600000;
    const have = { rq: ideal.rq - 7, rd: ideal.rd - 6, rn: ideal.rn - 1, b1: ideal.b1 - 140, b5: ideal.b5 - 18, b10: ideal.b10, b20: 12, b50: 0, b100: 0 };
    const date = new Date(ts);
    boxLogs.push({
      id: `box-${i}`, ts, date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`, counter: "Alex",
      have, order: { rq: 7, rd: 6, rn: 1, b1: 140, b5: 18, b10: 0 }, take: { b20: 12 }, after: Object.assign({}, ideal, { b20: 0 }), ideal,
      orderValue: 70 + 30 + 2 + 140 + 90, takeValue: 240, boxTotal: 2170 - 332 + 240, idealTotal: 2170, variance: -92,
    });
  }
  return { version: 1, settings: Object.assign({}, settings, { people }), counts, boxLogs };
}

async function run() {
  console.log("→ Building ace-change-studio…");
  const bin = path.join(mkdtempSync(path.join(os.tmpdir(), "acs-e2e-")), "acechangestudio");
  execFileSync("go", ["build", "-o", bin, "."], { cwd: APPDIR, stdio: "inherit" });

  mockSrv = await startMockUpdate();
  const manifest = `http://127.0.0.1:${mockSrv.address().port}/dist/version.json`;
  const cfgDir = mkdtempSync(path.join(os.tmpdir(), "acs-cfg-"));
  appProc = spawn(bin, ["-no-browser", "-no-exit", "-port=0"], { env: { ...process.env, ACE_CONFIG_DIR: cfgDir, ACE_UPDATE_MANIFEST: manifest } });
  const url = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("app didn't start")), 15000);
    appProc.stdout.on("data", (d) => { const m = String(d).match(/ACE_CHANGE_STUDIO_URL (\S+)/); if (m) { clearTimeout(t); resolve(m[1]); } });
    appProc.stderr.on("data", (d) => process.stderr.write(d));
  });
  console.log(`→ App at ${url}`);

  const browser = await chromium.launch({ ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}), args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: url });
  page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });
  await page.goto(url);
  await page.waitForSelector(".drawer-tile");

  /* ---------- update banner ---------- */
  console.log("\n# Update banner");
  await page.waitForSelector("#updateBar.show", { timeout: 8000 }).catch(() => {});
  ok("banner shows the newer version", (await text("#updateText")).includes("v9.9.9"), await text("#updateText"));
  ok("banner offers Update & Restart", (await text("#updateBtn")) === "Update & Restart");
  ok("banner shows manifest notes", (await text("#updateText")).includes("Test build notes."));
  await shot("01-update-banner");
  await page.click("#updateDismiss");
  ok("banner dismisses", !(await page.$("#updateBar.show")));

  /* ---------- count a drawer ---------- */
  console.log("\n# Count a drawer");
  await page.click("#cSave");
  ok("save without a drawer is refused", (await text("#toastHost")).includes("Pick which drawer"));
  await page.evaluate(() => (document.querySelector("#toastHost").innerHTML = ""));
  await page.click('.drawer-tile[data-drawer="up1"]');
  ok("drawer tile selected", await page.$('.drawer-tile.active[data-drawer="up1"]'));
  // add a person through the dropdown
  await page.selectOption("#cCashier", "__add");
  await page.fill("#dlgInput", "Alex");
  await page.click('.modal [data-act="ok"]');
  await page.waitForTimeout(150);
  ok("new name selected as cashier", (await page.$eval("#cCashier", (s) => s.value)) === "Alex");
  await page.selectOption("#cCounter", "Alex");
  const fill = async (id, v) => page.fill(`.c-row[data-id="${id}"] input.cnt`, String(v));
  await fill("b1", 82); await fill("b5", 14); await fill("b10", 7); await fill("b20", 11); await fill("b50", 1);
  await fill("cq", 63); await fill("cd", 58); await fill("cn", 60);
  // total = 82+70+70+220+50 + 15.75+5.80+3.00 = 516.55
  ok("drawer total", (await text("#cTotal")) === "$516.55", await text("#cTotal"));
  ok("pull = total − $150", (await text("#cPull")) === "$366.55", await text("#cPull"));
  const tray = await page.$$eval(".tray .slot .slot-n", (ns) => ns.map((n) => n.textContent));
  ok("tray leaves the recipe (60 ones, 8 fives, 3 tens, 50/50/50 coin)", JSON.stringify(tray) === JSON.stringify(["60", "8", "3", "0", "0", "50", "50", "50", "0"]), tray);
  // + / − steppers
  await page.click('.c-row[data-id="b100"] .step[data-step="1"]');
  ok("stepper adds one", (await page.$eval('.c-row[data-id="b100"] input.cnt', (i) => i.value)) === "1");
  await page.click('.c-row[data-id="b100"] .step[data-step="-1"]');
  // coin $ mode
  await page.click('.c-row[data-id="cq"] .mode-toggle');
  await page.fill('.c-row[data-id="cq"] input.cnt', "15.75");
  ok("coin $ mode converts to a count", (await text("#cv-cq")).includes("63 coins"), await text("#cv-cq"));
  await page.fill('.c-row[data-id="cq"] input.cnt', "15.80");
  ok("coin $ mode flags an impossible amount", (await text("#cv-cq")).includes("not a whole number"));
  await page.fill('.c-row[data-id="cq"] input.cnt', "15.75");
  ok("total unchanged in $ mode", (await text("#cTotal")) === "$516.55");
  // register number → short $2.00
  await page.fill("#cExpected", "368.55");
  ok("short $2.00 shown", (await text("#cOS")).includes("Short $2.00"), await text("#cOS"));
  ok("$2 short is yellow", !!(await page.$("#cOS .os-badge.warn")));
  await page.fill("#cNote", "Recounted twice");
  await shot("02-count-filled");
  await tall(1500); await shot("02b-count-full"); await tall();
  await page.click("#cSave");
  await page.waitForTimeout(300);
  ok("save toast", (await text("#toastHost")).includes("Saved — Upstairs 1 is short $2.00"), await text("#toastHost"));
  ok("form cleared after save", (await text("#cTotal")) === "$0.00");
  ok("counter kept for the next count", (await page.$eval("#cCounter", (s) => s.value)) === "Alex");
  ok("drawer tile shows the last result", (await text('.drawer-tile[data-drawer="up1"] .dt-last')).includes("Short $2.00"));

  // exact count on another drawer
  await page.click('.drawer-tile[data-drawer="dn1"]');
  await fill("b1", 60); await fill("b5", 8); await fill("b10", 3); await fill("b20", 10);
  await page.click('.c-row[data-id="cq"] .mode-toggle'); // back to count mode
  await fill("cq", 50); await fill("cd", 50); await fill("cn", 50);
  await page.fill("#cExpected", "200");
  ok("balanced shown", (await text("#cOS")).includes("Balanced"));
  await page.click("#cSave");
  await page.waitForSelector(".modal", { timeout: 3000 });
  ok("asks before saving without a cashier", (await text(".modal h2")).includes("Save without names"));
  await page.click('.modal [data-act="ok"]');
  await page.waitForTimeout(300);

  /* ---------- history: list, edit, delete/undo ---------- */
  console.log("\n# History list");
  await page.click('.tab[data-view="history"]');
  await page.waitForTimeout(200);
  const rows = await page.$$("#hList tr[data-id]");
  ok("two counts listed", rows.length === 2, rows.length);
  ok("tiles show net −$2.00", (await text("#hTiles")).includes("−$2.00"), await text("#hTiles"));
  await page.click('#hList tr[data-id] [data-act="view"]');
  ok("detail modal opens", (await text(".modal h2")).includes("Downstairs 1") || (await text(".modal h2")).includes("Upstairs 1"));
  await page.click(".modal-close");
  // edit the Upstairs 1 count: register actually said 366.55 → balanced
  const up1Id = await page.$$eval("#hList tr[data-id]", (trs) => trs.find((t) => t.textContent.includes("Upstairs 1")).dataset.id);
  await page.click(`#hList tr[data-id="${up1Id}"] [data-act="edit"]`);
  await page.waitForTimeout(200);
  ok("edit loads the count", (await text("#cTotal")) === "$516.55" && (await page.$("#cEditBanner.show")), await text("#cTotal"));
  await page.fill("#cExpected", "366.55");
  await page.click("#cSave");
  await page.waitForTimeout(300);
  await page.click('.tab[data-view="history"]');
  ok("edited count now balanced", (await text(`#hList tr[data-id="${up1Id}"]`)).includes("Balanced"));
  ok("still two counts (edited, not duplicated)", (await page.$$("#hList tr[data-id]")).length === 2);
  await page.click(`#hList tr[data-id="${up1Id}"] [data-act="del"]`);
  await page.click('.modal [data-act="ok"]');
  await page.waitForTimeout(250);
  ok("deleted", (await page.$$("#hList tr[data-id]")).length === 1);
  await page.click(".toast-undo");
  await page.waitForTimeout(250);
  ok("undo restores it", (await page.$$("#hList tr[data-id]")).length === 2);

  /* ---------- change box ---------- */
  console.log("\n# Change box");
  await page.click('.tab[data-view="box"]');
  const bfill = (id, k, v) => page.fill(`.box-row[data-id="${id}"] input.cnt[data-k="${k}"]`, String(v));
  await bfill("rq", "rolls", 14); await bfill("rd", "rolls", 8); await bfill("rn", "rolls", 10);
  await bfill("b1", "straps", 3); await bfill("b1", "loose", 20); await bfill("b5", "loose", 92); await bfill("b10", "straps", 1);
  await bfill("b20", "big", 7); await bfill("b50", "big", 1);
  const res = await text("#bResult");
  ok("box adds up to ideal", res.includes("adds up to its ideal $2,170"), res);
  ok("orders 6 rolls of quarters", res.includes("Quarters 6 rolls $60"), res);
  ok("orders 80 ones (1 half strap + 30)", res.includes("Ones 1 half strap + 30 bills $80"), res);
  ok("takes 7 twenties and a fifty", res.includes("$20 bills 7 bills $140") && res.includes("$50 bills 1 bill $50"), res);
  ok("even swap", res.includes("Even swap — $190 out, $190 back"), res);
  await page.click("#bCopy");
  await page.waitForTimeout(150);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  ok("copied order text", clip.includes("Quarters: 6 rolls ($60)") && clip.includes("7 × $20 ($140)"), clip);
  await page.evaluate(() => { window.__printed = 0; });
  await page.click("#bPrint");
  await page.waitForTimeout(600);
  const sheet = await page.$eval("#printFrame", (f) => f.srcdoc);
  ok("print sheet built", sheet.includes("Change Order") && sheet.includes("Order total") && sheet.includes("$190"));
  await shot("03-change-box");
  await page.selectOption("#bCounter", "Alex");
  await page.click("#bSave");
  await page.waitForTimeout(300);
  ok("order saved", (await text("#toastHost")).includes("Order saved — $190"), await text("#toastHost"));

  /* ---------- settings ---------- */
  console.log("\n# Settings");
  await page.click('.tab[data-view="settings"]');
  await page.fill("#sGreen", "0.50");
  await page.waitForTimeout(600);
  await page.fill("#sPersonNew", "Jordan");
  await page.click("#sPersonAdd");
  await page.fill('#sIdeal .mini-row[data-id="rd"] input.cnt', "12");
  await page.waitForTimeout(600);
  ok("ideal total updates", (await text("#sIdealTotal")).includes("$2,180"), await text("#sIdealTotal"));
  ok("reset recipe matches $150", (await text("#sResetTotal")).includes("matches"));
  await tall(1700); await shot("05-settings"); await tall();

  /* ---------- persistence ---------- */
  console.log("\n# Persistence");
  await page.reload();
  await page.waitForSelector(".drawer-tile", { state: "attached" });
  await page.click('.tab[data-view="settings"]');
  ok("flag setting persisted", (await page.$eval("#sGreen", (i) => i.value)) === "0.50");
  ok("people persisted", (await text("#sPeople")).includes("Jordan"));
  const onDisk = JSON.parse(readFileSync(path.join(cfgDir, "state.json"), "utf8"));
  ok("state.json has the counts", onDisk.counts.length === 2 && onDisk.boxLogs.length === 1, { c: onDisk.counts.length, b: onDisk.boxLogs.length });
  ok("state.json has the ideal edit", onDisk.settings.ideal.rd === 12);
  ok("daily backup taken", existsSync(path.join(cfgDir, "backups")) && readdirSync(path.join(cfgDir, "backups")).length === 1);
  const up1 = onDisk.counts.find((c) => c.drawerId === "up1");
  ok("saved count has leave/pull/expected", up1 && up1.leaveCents === 15000 && up1.pullCents === 36655 && up1.expectedCents === 36655 && up1.overShortCents === 0 && up1.cashier === "Alex", up1);

  /* ---------- seeded history + smart layout ---------- */
  console.log("\n# History charts (seeded)");
  const seeded = seedDoc(onDisk.settings);
  seeded.settings.flags = { green: 100, yellow: 500 };
  seeded.settings.ideal = { rq: 20, rd: 10, rn: 10, b1: 400, b5: 100, b10: 100 };
  await page.evaluate(async (doc) => {
    await fetch("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(doc) });
    localStorage.setItem("acs.view", "history");
  }, seeded);
  await page.reload();
  await page.waitForSelector("#hTiles .tile");
  ok("six trend panels", (await page.$$("#hTrends .mult")).length === 6);
  ok("bars drawn", (await page.$$("#hTrends .mark")).length > 50);
  ok("calendar has colored days", (await page.$$(".cal-cell.has")).length >= 20);
  ok("cashier table", (await page.$$("#hPeople tbody tr")).length === 5);
  ok("Downstairs 2 is most off", (await text("#hTiles")).includes("Downstairs 2"), await text("#hTiles"));
  await page.hover("#hTrends .hit");
  ok("tooltip on hover", await page.$("#tip.show"));
  await tall(2300); await shot("04-history"); await tall();
  // click a calendar day → list filters to it
  await page.click(".cal-cell.has");
  await page.waitForTimeout(300);
  ok("calendar day filters the list", !!(await page.$("#hDayClear")));
  await page.click('#hRange button[data-r="7"]');
  ok("range filter narrows tiles", Number((await text("#hTiles .tile:nth-child(2) .t-value"))) < seeded.counts.length);

  console.log("\n# Smart layout");
  await page.click('.tab[data-view="box"]');
  const smart = await text("#smartCard");
  ok("suggestion ready", /suggested/i.test(smart), smart);
  ok("suggests more dimes", await page.$eval("#smartCard tbody", (tb) => {
    const r = [...tb.rows].find((x) => x.textContent.includes("Dimes"));
    return !!r && r.classList.contains("chg") && !!r.querySelector(".chg-up");
  }));
  await tall(1900); await shot("06-smart-layout"); await tall();
  await page.click("#smartApply");
  await page.click('.modal [data-act="ok"]');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => fetch("/api/state").then((r) => r.json()));
  ok("applying updates the ideal box", after.settings.ideal.rd > 10, after.settings.ideal);

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
