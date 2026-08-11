import { spawn, execFileSync } from "child_process";
import { mkdirSync, mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { startMockAce } from "./mock-ace.mjs";
const APPDIR = "/home/user/codySuter/ace-sign-studio";
const SHOTS = "/home/user/codySuter/ace-sign-studio/e2e/screenshots/ui";
mkdirSync(SHOTS, { recursive: true });
const { chromium } = await import("playwright");
let appProc = null, mockSrv = null;
process.on("exit", () => { try { appProc?.kill(); } catch {} try { mockSrv?.close(); } catch {} });
const bin = path.join(mkdtempSync(path.join(os.tmpdir(), "ass-ar-")), "app");
execFileSync("go", ["build", "-o", bin, "."], { cwd: APPDIR, stdio: "inherit" });
mockSrv = await startMockAce();
const cfg = mkdtempSync(path.join(os.tmpdir(), "ass-ar-cfg-"));
appProc = spawn(bin, ["-no-browser", "-no-exit", "-port", "0"], { env: { ...process.env, ACE_BASE_URL: mockSrv.url, ACE_LOOKUP_MODE: "http", ACE_CONFIG_DIR: cfg, XDG_CONFIG_HOME: cfg } });
const url = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("no start")), 15000);
  const scan = (b) => { const m = String(b).match(/serving at (http:\/\/[\d.:]+)/); if (m) { clearTimeout(t); res(m[1]); } };
  appProc.stderr.on("data", scan); appProc.stdout.on("data", scan);
});
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", headless: true, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 940 }, deviceScaleFactor: 2 })).newPage();
await page.goto(url);
await page.waitForSelector(".g-card", { timeout: 20000 });
for (const dir of ["up", "down", "left", "right"]) {
  await page.click(`.nav-item[data-type="arrow_${dir}"]`);
  await page.waitForSelector("#editorFields");
  await page.fill("#editorFields input.f-input", "3000003");
  await page.waitForSelector(".lookup-status.ok", { timeout: 20000 });
  await page.waitForSelector("#signHolder svg", { timeout: 20000 });
  await page.waitForTimeout(600);
  const el = await page.$("#signHolder");
  await el.screenshot({ path: path.join(SHOTS, `arrow-${dir}.png`) });
  console.log("shot", dir);
}
// also a small size (shelf 5x3) for the down arrow
await page.selectOption("#sizeSelect", "shelf-5x3");
await page.waitForTimeout(700);
await (await page.$("#signHolder")).screenshot({ path: path.join(SHOTS, "arrow-right-shelf.png") });
console.log("shot shelf");
await browser.close();
process.exit(0);
