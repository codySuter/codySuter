/** Rasterize build/icon.svg -> build/icon.png (1024²) using headless chromium. */
import { chromium } from "playwright-core";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(path.join(ROOT, "build/icon.svg"), "utf8");

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(
  `<style>html,body{margin:0;background:transparent}</style>${svg}`,
);
await page.screenshot({
  path: path.join(ROOT, "build/icon.png"),
  omitBackground: true,
});
await browser.close();
console.log("build/icon.png written");
