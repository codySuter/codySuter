/**
 * UI tour: boots the app against the mock store and screenshots every major
 * surface, for design review. Writes to e2e/screenshots/ui/.
 * Usage: node e2e/ui-tour.mjs
 */
import { spawn, execFileSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { startMockAce } from "./mock-ace.mjs";

const E2E = path.dirname(fileURLToPath(import.meta.url));
const APPDIR = path.join(E2E, "..");
const SHOTS = path.join(E2E, "screenshots", "ui");
mkdirSync(SHOTS, { recursive: true });

let chromiumMod;
try { chromiumMod = await import("playwright"); }
catch { chromiumMod = await import("playwright-core"); }
const { chromium } = chromiumMod;
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;

let appProc = null, mockSrv = null;
function cleanup() { try { appProc?.kill(); } catch {} try { mockSrv?.close(); } catch {} }
process.on("exit", cleanup);

let page;
const shot = async (name) => {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  console.log(`📸 ${name}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("→ building…");
const bin = path.join(mkdtempSync(path.join(os.tmpdir(), "ass-ui-")), "acesignstudio");
execFileSync("go", ["build", "-o", bin, "."], { cwd: APPDIR, stdio: "inherit" });
const mock = await startMockAce();
mockSrv = mock;
const cfgDir = mkdtempSync(path.join(os.tmpdir(), "ass-ui-cfg-"));
appProc = spawn(bin, ["-no-browser", "-no-exit", "-port", "0"], {
  env: { ...process.env, ACE_BASE_URL: mock.url, ACE_LOOKUP_MODE: "http", ACE_CONFIG_DIR: cfgDir, XDG_CONFIG_HOME: cfgDir },
});
const appUrl = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("app did not start")), 15000);
  const scan = (b) => { const m = String(b).match(/serving at (http:\/\/[\d.:]+)/); if (m) { clearTimeout(t); resolve(m[1]); } };
  appProc.stderr.on("data", scan); appProc.stdout.on("data", scan);
});
console.log("→ app at", appUrl);

const browser = await chromium.launch({
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 }, deviceScaleFactor: 2 });
page = await ctx.newPage();
await page.goto(appUrl);
await page.waitForSelector(".g-card", { timeout: 20000 });
await page.waitForSelector("#g-prev-regular svg", { timeout: 20000 });
await sleep(800);
await shot("01-gallery-home");

// Regular editor with a looked-up product
await page.click('.nav-item[data-type="regular"]');
await page.waitForSelector("#editorFields");
await page.fill('#editorFields input.f-input', "3000003");
await page.press('#editorFields input.f-input', "Enter");
await sleep(2500);
await shot("02-editor-regular");

// add to queue a few times for a populated rail
for (let i = 0; i < 3; i++) { await page.click("#addQueueBtn"); await sleep(300); }

// promo editor with extra fields
await page.click('.nav-item[data-type="instant_savings"]');
await page.waitForSelector("#editorFields");
await sleep(600);
await shot("03-editor-instant-savings");

// element sizes / presets popover if present
const presets = await page.$("#presetBtn, .preset-btn, [id*='reset']");
await page.evaluate(() => { const d = document.querySelector("details.scale-box, details"); if (d) d.open = true; });
await sleep(400);
await shot("04-editor-details-open");

// queue rail state
await page.click('.nav-item[data-type="regular"]');
await sleep(500);
await shot("05-queue-rail");

// bulk add (a <details> inside the queue rail)
await page.evaluate(() => { document.querySelector(".bulk-box").open = true; });
await sleep(500);
await shot("07-bulk-add-open");
await page.evaluate(() => { document.querySelector(".bulk-box").open = false; });

// scroll the queue rail to show sheet layout previews
await page.evaluate(() => { const s = document.querySelector(".queue-scroll"); if (s) s.scrollTop = s.scrollHeight; });
await sleep(400);
await shot("06-queue-rail-bottom");
await page.evaluate(() => { const s = document.querySelector(".queue-scroll"); if (s) s.scrollTop = 0; });

// batches modal
await page.click("#batchesBtn"); await sleep(500); await shot("08-batches");
await page.click("#batchModal .modal-close");

// history modal
await page.click("#historyBtn"); await sleep(500); await shot("09-history");
const hClose = await page.$(".modal-back.show .modal-close"); if (hClose) await hClose.click();

// settings — capture full scroll
await page.click("#settingsBtn");
await sleep(600);
await shot("10-settings-top");
await page.evaluate(() => { const b = document.querySelector(".modal-back.show .modal-body"); if (b) b.scrollTop = b.scrollHeight / 2; });
await sleep(300);
await shot("11-settings-mid");
await page.evaluate(() => { const b = document.querySelector(".modal-back.show .modal-body"); if (b) b.scrollTop = b.scrollHeight; });
await sleep(300);
await shot("12-settings-bottom");
const closeS = await page.$(".modal-back.show .modal-close"); if (closeS) await closeS.click();

// full-page DOM snapshot of header/sidebar/footer button inventory
const inventory = await page.evaluate(() => {
  const vis = (el) => el.offsetParent !== null;
  const label = (el) => (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60);
  const out = { header: [], sidebar: [], queueRail: [], editorButtons: [], footers: [] };
  document.querySelectorAll("header button, header .icon-btn").forEach((b) => vis(b) && out.header.push(label(b)));
  document.querySelectorAll(".nav button, .nav-item, aside.nav *[onclick]").forEach((b) => vis(b) && out.sidebar.push(label(b)));
  document.querySelectorAll("#queuePanel button, .queue-rail button, [id*='queue'] button").forEach((b) => vis(b) && out.queueRail.push(label(b)));
  document.querySelectorAll("main button").forEach((b) => vis(b) && out.editorButtons.push(label(b)));
  return out;
});
console.log(JSON.stringify(inventory, null, 2));

await browser.close();
cleanup();
console.log("done →", SHOTS);
