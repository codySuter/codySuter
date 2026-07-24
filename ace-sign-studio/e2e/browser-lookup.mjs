/**
 * Browser-lookup regression suite.
 *
 * The main e2e run (run.mjs) sets ACE_LOOKUP_MODE=http, so it exercises the
 * direct-HTTP fallback and never the browser path that real lookups take.
 * That gap is how 2.4.0 shipped with a warm tab whose every fetch timed out:
 * lookups still returned correct data — via the slow fallback — so nothing
 * failed, they just took ~17s each instead of ~0.2s.
 *
 * This suite drives the real binary through the real browser path against a
 * mock that reproduces the site's bot protection (challenge page + a price
 * API gated on the cleared-session cookie).
 *
 * The load-bearing assertion is the mock's product-page hit count, not a
 * stopwatch: if the warm tab stops working, every lookup navigates instead,
 * and that count jumps from 0 to one-per-lookup. Timing is asserted too, but
 * only against a ceiling loose enough never to flake on a busy CI runner.
 *
 * Usage: node e2e/browser-lookup.mjs
 * Env:   CHROMIUM_PATH — browser executable to drive
 */
import { spawn, execFileSync } from "child_process";
import { existsSync, mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { startMockBotAce } from "./mock-ace-bot.mjs";

const E2E = path.dirname(fileURLToPath(import.meta.url));
const APPDIR = path.join(E2E, "..");

const CHROME_CANDIDATES = [
  process.env.CHROMIUM_PATH,
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

let CHROME = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!CHROME) {
  // Fall back to whatever Playwright installed, if present.
  try {
    const { chromium } = await import("playwright");
    CHROME = chromium.executablePath();
  } catch {}
}
if (!CHROME || !existsSync(CHROME)) {
  console.error("✗ no Chromium found to drive the browser lookup path");
  process.exit(1);
}
console.log(`→ driving ${CHROME}`);

const results = [];
function ok(name, condition, extra) {
  results.push({ name, pass: Boolean(condition) });
  console.log(`  ${condition ? "✓" : "✗ FAIL"} ${name}${!condition && extra ? ` — ${extra}` : ""}`);
  if (!condition) process.exitCode = 1;
}

let app = null, mock = null;
const cleanup = () => {
  try { if (app) app.kill(); } catch {}
  try { if (mock) mock.close(); } catch {}
};
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { cleanup(); process.exit(130); });

console.log("→ Building ace-sign-studio…");
const bin = path.join(mkdtempSync(path.join(os.tmpdir(), "ass-blookup-")), "acesignstudio");
execFileSync("go", ["build", "-o", bin, "."], { cwd: APPDIR, stdio: "inherit" });

mock = await startMockBotAce();
console.log(`→ Mock acehardware.com (with bot protection) at ${mock.url}`);

const cfgDir = mkdtempSync(path.join(os.tmpdir(), "ass-blookup-cfg-"));
app = spawn(bin, ["-no-browser", "-no-exit", "-port", "0"], {
  env: {
    ...process.env,
    ACE_BASE_URL: mock.url,
    ACE_BROWSER_PATH: CHROME,
    ACE_CONFIG_DIR: cfgDir,
    XDG_CONFIG_HOME: cfgDir,
    // ACE_LOOKUP_MODE deliberately unset: this suite exists to exercise the
    // browser path that the main e2e run bypasses.
  },
});
const appUrl = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("app did not start")), 30000);
  const scan = (b) => {
    const m = String(b).match(/serving at (http:\/\/[\d.:]+)/);
    if (m) { clearTimeout(t); resolve(m[1]); }
  };
  app.stderr.on("data", scan);
  app.stdout.on("data", scan);
  app.on("exit", (c) => reject(new Error(`app exited early (${c})`)));
});
console.log(`→ App at ${appUrl}\n`);

const lookup = async (q, refresh) => {
  const t0 = performance.now();
  const res = await fetch(
    `${appUrl}/api/lookup?q=${encodeURIComponent(q)}&store=12180${refresh ? "&refresh=1" : ""}`
  ).then((r) => r.json());
  return { ms: performance.now() - t0, res };
};

try {
  // ---- cold: launches the browser and clears the challenge ----
  console.log("→ Cold lookup (browser launch + bot challenge)");
  const cold = await lookup("3000003");
  ok("cold lookup returns product data", cold.res.ok && cold.res.name.includes("DeWalt"), JSON.stringify(cold.res.error));
  ok("cold lookup gets the store price", cold.res.price === "129.00", `got ${cold.res.price}`);

  // ---- warm: must be served by the warm tab, with no navigation ----
  console.log("\n→ Warm lookups must reuse the warm session tab");
  await mock.reset();
  const warmSkus = ["2000002", "81995", "5000001", "5000002", "5000003"];
  const t0 = performance.now();
  const warm = [];
  for (const s of warmSkus) warm.push(await lookup(s, true));
  const warmTotal = performance.now() - t0;
  const stats = await mock.stats();

  ok("every warm lookup returns data", warm.every((w) => w.res.ok), JSON.stringify(warm.map((w) => w.res.error)));
  ok("warm lookups hit the price API", stats.api200 === warmSkus.length, `api200=${stats.api200}`);

  // THE regression guard: a broken warm tab shows up here as one product-page
  // load per lookup, long before anyone notices the app "feels slow".
  ok(
    "warm lookups load NO product pages (warm tab is really being used)",
    stats.page === 0,
    `${stats.page} page loads — the warm tab is falling back to navigation`
  );
  // Match the success line specifically ("Store price via warm session …").
  // A looser /warm session/ also matches the FAILURE line ("Warm session
  // couldn't answer — loading the full product page"), so it would pass on
  // exactly the broken build this suite exists to catch.
  ok(
    "a warm lookup reports being served BY the warm session",
    (warm[0].res.diagnostics || []).some((d) => /via warm session/i.test(d)),
    JSON.stringify(warm[0].res.diagnostics)
  );
  ok(
    "no warm lookup fell back to a full page load",
    !(warm[0].res.diagnostics || []).some((d) => /couldn't answer|fetch failed/i.test(d)),
    JSON.stringify(warm[0].res.diagnostics)
  );

  // Loose ceiling: real warm lookups are ~0.1-0.3s. The shipped 2.4.0 bug
  // made each one ~16.7s, so even a very generous bound catches it.
  const perWarm = warmTotal / warmSkus.length / 1000;
  ok(
    `warm lookups are fast (${perWarm.toFixed(2)}s each, ceiling 4s)`,
    perWarm < 4,
    `${perWarm.toFixed(2)}s per lookup`
  );

  // ---- bulk: the ↻ Prices / bulk-add shape ----
  console.log("\n→ Bulk refresh shape (20 SKUs, 5 concurrent)");
  await mock.reset();
  const skus = Array.from({ length: 20 }, (_, i) => String(5000000 + i));
  const tb = performance.now();
  let i = 0;
  const worker = async () => { while (i < skus.length) await lookup(skus[i++], true); };
  await Promise.all(Array.from({ length: 5 }, worker));
  const bulkS = (performance.now() - tb) / 1000;
  const bulkStats = await mock.stats();
  ok(`20-SKU refresh completes quickly (${bulkS.toFixed(2)}s, ceiling 30s)`, bulkS < 30, `${bulkS.toFixed(2)}s`);
  ok("bulk refresh loads no product pages", bulkStats.page === 0, `${bulkStats.page} page loads`);

  // ---- search phrases still work (they legitimately navigate) ----
  console.log("\n→ Search phrase still resolves via navigation");
  const search = await lookup("dewalt drill");
  ok("search phrase resolves to a product", search.res.ok && search.res.sku === "3000003", JSON.stringify(search.res.error));
} finally {
  cleanup();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
if (passed !== results.length) {
  console.log("Failed:", results.filter((r) => !r.pass).map((r) => r.name).join("; "));
  process.exit(1);
}
