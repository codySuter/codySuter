/**
 * Ace Sign Studio end-to-end suite: builds the Go binary, starts a mock
 * acehardware.com, and drives every major flow in headless Chromium —
 * lookups, sale auto-switch, queue editing, copies, reorder, undo,
 * batches, bulk add with failure reporting, price refresh, barcodes,
 * and PDF export.
 *
 * Usage: node e2e/run.mjs            (from ace-sign-studio/ or e2e/)
 * Env:   CHROMIUM_PATH — explicit browser executable
 *        E2E_KEEP=1    — leave the app running after the tests
 */
import { spawn, execFileSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, statSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { startMockAce } from "./mock-ace.mjs";

const E2E = path.dirname(fileURLToPath(import.meta.url));
const APPDIR = path.join(E2E, "..");
const SHOTS = path.join(E2E, "screenshots");
mkdirSync(SHOTS, { recursive: true });

let chromiumMod;
try { chromiumMod = await import("playwright"); }
catch { chromiumMod = await import("playwright-core"); }
const { chromium } = chromiumMod;

const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const EXECUTABLE =
  process.env.CHROMIUM_PATH || (existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined);

const results = [];
let page;

function ok(name, condition, extra) {
  results.push({ name, pass: Boolean(condition) });
  console.log(`${condition ? "  ✓" : "  ✗ FAIL"} ${name}${!condition && extra ? ` — ${extra}` : ""}`);
  if (!condition) process.exitCode = 1;
}

async function shot(name) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  console.log(`  📸 ${name}.png`);
}

/* Fill an input through the page's own event pipeline. */
async function fill(selector, value) {
  await page.fill(selector, value);
}

async function waitToastGone() {
  await page.evaluate(() => { const h = document.querySelector("#toastHost"); if (h) h.innerHTML = ""; });
}

async function run() {
  // ---- build the app ----
  console.log("→ Building ace-sign-studio…");
  const bin = path.join(mkdtempSync(path.join(os.tmpdir(), "ass-e2e-")), "acesignstudio");
  execFileSync("go", ["build", "-o", bin, "."], { cwd: APPDIR, stdio: "inherit" });

  // ---- mock acehardware.com ----
  const mock = await startMockAce();
  console.log(`→ Mock acehardware.com at ${mock.url}`);

  // ---- launch the app ----
  const cfgDir = mkdtempSync(path.join(os.tmpdir(), "ass-cfg-"));
  const app = spawn(bin, ["-no-browser", "-no-exit", "-port", "0"], {
    env: {
      ...process.env,
      ACE_BASE_URL: mock.url,
      ACE_LOOKUP_MODE: "http",
      ACE_CONFIG_DIR: cfgDir,
      XDG_CONFIG_HOME: cfgDir,
    },
  });
  const appUrl = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("app did not start")), 15000);
    const scan = (buf) => {
      const m = String(buf).match(/serving at (http:\/\/[\d.:]+)/);
      if (m) { clearTimeout(t); resolve(m[1]); }
    };
    app.stderr.on("data", scan);
    app.stdout.on("data", scan);
    app.on("exit", (c) => reject(new Error(`app exited early (${c})`)));
  });
  console.log(`→ App at ${appUrl}`);

  const browser = await chromium.launch({
    ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1500, height: 940 },
    deviceScaleFactor: 2,
    acceptDownloads: true,
  });
  page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => { pageErrors.push(err.message); console.log("  ⚠ pageerror:", err.message); });

  try {
    // ================= boot & gallery =================
    console.log("→ Boot & gallery");
    await page.goto(appUrl);
    await page.waitForSelector(".g-card", { timeout: 20000 });
    ok("gallery renders all 14 sign types", (await page.$$(".g-card")).length === 14);
    ok("nav lists sign types", (await page.$$(".nav-item[data-type]")).length === 14);
    await page.waitForSelector("#g-prev-regular svg", { timeout: 20000 });
    await shot("01-gallery");

    // ================= editor + lookup =================
    console.log("→ Editor lookup (regular price)");
    await page.click('.nav-item[data-type="regular"]');
    await page.waitForSelector("#editorFields");
    await fill("#editorFields input.f-input", "3000003");
    await page.waitForSelector(".lookup-status.ok", { timeout: 20000 });
    ok("SKU lookup fills the name", (await page.inputValue('[data-field="name"]')).includes("DeWalt"));
    ok("SKU lookup fills the store price", (await page.inputValue('[data-field="price"]')) === "129.00");
    ok("lookup stamps lookedUpAt", await page.evaluate(() => !!App.spec.lookedUpAt));
    await page.waitForSelector("#signHolder svg", { timeout: 20000 });
    await shot("02-editor-regular");

    // ================= barcode toggle =================
    console.log("→ Code 128 barcode toggle");
    const rectsBefore = await page.$$eval("#signHolder svg rect", (r) => r.length);
    await page.check('.f-check:has-text("barcode") input');
    await page.waitForFunction(
      (n) => document.querySelectorAll("#signHolder svg rect").length > n + 20,
      rectsBefore,
      { timeout: 10000 }
    );
    ok("barcode adds Code 128 bars to the sign", true);
    await shot("03-editor-barcode");

    // ================= add to queue =================
    console.log("→ Add to queue");
    await page.click("#addQueueBtn");
    await page.waitForSelector(".q-item");
    ok("sign lands in the queue", (await page.$$(".q-item")).length === 1);
    ok("queue badge counts physical signs", (await page.textContent("#queueCount")) === "1");
    await page.waitForSelector(".sheet-thumb svg", { timeout: 20000 });
    ok("sheet layout preview renders", true);

    // ================= edit a queued sign =================
    console.log("→ Edit a queued sign");
    await page.click(".q-item .q-main");
    await page.waitForSelector("#editBanner", { state: "visible" });
    ok("edit banner appears", true);
    ok("button switches to Update Sign", (await page.textContent("#addQueueBtn")).includes("Update"));
    await fill('[data-field="price"]', "119.00");
    await page.click("#addQueueBtn");
    await page.waitForSelector(".toast");
    ok("update keeps a single queue row", (await page.$$(".q-item")).length === 1);
    ok("updated price persists in the item", await page.evaluate(() => Queue.items[0].spec.price === "119.00"));
    ok("hide map survives in stored spec (editable later)", await page.evaluate(() => "barcode" in Queue.items[0].spec));
    await waitToastGone();

    // re-open and cancel
    await page.click(".q-item .q-main");
    await page.waitForSelector("#editBanner", { state: "visible" });
    ok("re-editing loads the saved price", (await page.inputValue('[data-field="price"]')) === "119.00");
    await page.click("#cancelEditBtn");
    await page.waitForSelector("#editBanner", { state: "hidden" });
    ok("cancel leaves edit mode", (await page.textContent("#addQueueBtn")).includes("Add to Queue"));

    // ================= copies stepper =================
    console.log("→ Copies");
    await page.click('button[title="One more copy"]');
    await page.click('button[title="One more copy"]');
    await page.waitForFunction(() => Queue.items[0].copies === 3);
    ok("stepper reaches ×3", true);
    ok("queue badge shows 3 physical signs", (await page.textContent("#queueCount")) === "3");
    await page.waitForFunction(() => (document.querySelector("#queueStats") || {}).textContent?.includes("3 signs"));
    ok("sheet stats count copies", (await page.textContent("#queueStats")).includes("(1 unique)"));

    // ================= second sign + reorder =================
    console.log("→ Reorder");
    await page.click('.nav-item[data-type="large_text"]');
    await page.waitForSelector("#editorFields");
    await fill('[data-field="name"]', "PROPANE REFILLS");
    await fill('[data-field="price"]', "17.99");
    await page.click("#addQueueBtn");
    await page.waitForFunction(() => Queue.items.length === 2);
    const orderBefore = await page.$$eval(".q-item .q-title", (n) => n.map((x) => x.textContent));
    await page.click('.q-item:first-child button[title="Move down"]');
    await page.waitForFunction(
      (was) => document.querySelector(".q-item .q-title").textContent !== was,
      orderBefore[0]
    );
    const orderAfter = await page.$$eval(".q-item .q-title", (n) => n.map((x) => x.textContent));
    ok("▼ swaps the rows", orderAfter[0] === orderBefore[1] && orderAfter[1] === orderBefore[0]);
    await shot("04-queue");

    // ================= remove + undo =================
    console.log("→ Undo (remove, clear)");
    await page.click('.q-item:first-child button[title="Remove"]');
    await page.waitForFunction(() => Queue.items.length === 1);
    await page.click(".toast-undo");
    await page.waitForFunction(() => Queue.items.length === 2);
    ok("row remove is undoable", true);

    await page.click("#clearQueueBtn");
    await page.waitForFunction(() => Queue.items.length === 0);
    ok("clear empties without confirm()", true);
    await page.click(".toast-undo");
    await page.waitForFunction(() => Queue.items.length === 2);
    ok("clear is undoable", true);
    await waitToastGone();

    // ================= batches =================
    console.log("→ Named batches");
    await page.click("#batchesBtn");
    await page.waitForSelector("#batchModal.show");
    await fill("#batchName", "Test Batch");
    await page.click("#batchSaveBtn");
    await page.waitForSelector(".batch-row");
    ok("batch saves with sign count", (await page.textContent(".batch-sub")).includes("4 signs"));
    await shot("05-batches");
    await page.click("#batchModal .modal-close");
    await page.click("#clearQueueBtn");
    await page.waitForFunction(() => Queue.items.length === 0);
    await waitToastGone();
    await page.click("#batchesBtn");
    await page.waitForSelector(".batch-row .btn");
    await page.click(".batch-row .btn"); // Load
    await page.waitForFunction(() => Queue.items.length === 2);
    ok("batch load restores the queue", await page.evaluate(() => Queue.totalSigns() === 4));
    ok("batch survives in persisted state", await page.evaluate(() => !!Batches.data["Test Batch"]));
    await waitToastGone();

    // ================= bulk add =================
    console.log("→ Bulk add with failure report");
    await page.click("#clearQueueBtn");
    await page.waitForFunction(() => Queue.items.length === 0);
    await waitToastGone();
    await page.click(".bulk-box summary");
    await fill("#bulkSkus", "3000003 2000002 4040404");
    await fill("#bulkCopies", "2");
    await page.click("#bulkAddBtn");
    await page.waitForSelector(".bulk-fails", { timeout: 30000 });
    ok("bulk adds the good SKUs", await page.evaluate(() => Queue.items.length === 2));
    ok("bulk applies the copies count", await page.evaluate(() => Queue.items.every((q) => q.copies === 2)));
    ok("failed SKU is listed with a reason", (await page.textContent(".bulk-fails")).includes("4040404"));
    ok("on-sale SKU auto-switched to Sale", await page.evaluate(() =>
      Queue.items.some((q) => q.typeId === "sale" && q.spec.price === "19.99" && q.spec.regPrice === "24.99")));
    await shot("06-bulk-report");
    await page.click('.bulk-fails button:has-text("Retry failed")');
    ok("retry refills the textarea with failures only", (await page.inputValue("#bulkSkus")).trim() === "4040404");

    // bulk Was/Now without a sale price → WAS filled, flagged for a Now price
    console.log("→ Bulk Was/Now flagging");
    await fill("#bulkSkus", "3000003");
    await page.selectOption("#bulkType", "was_now");
    await page.click("#bulkAddBtn");
    await page.waitForSelector(".bulk-warn", { timeout: 30000 });
    ok("Was/Now bulk flags the missing Now price", (await page.textContent(".bulk-warn")).includes("Now price"));
    ok("WAS auto-fills from the shelf price", await page.evaluate(() =>
      Queue.items.some((q) => q.typeId === "was_now" && q.spec.regPrice === "129.00" && !q.spec.price)));
    ok("queue row shows the needs-Now badge", !!(await page.$(".q-warn")));

    // ================= price refresh =================
    console.log("→ Price refresh");
    await mock.setPrice("3000003", 99.0);
    await page.click("#refreshPricesBtn");
    await page.waitForFunction(
      () => Queue.items.some((q) => q.typeId !== "was_now" && q.spec.price === "99.00"),
      undefined,
      { timeout: 30000 }
    );
    ok("refresh pulls the new store price", true);
    ok("manual Was/Now sign left untouched", await page.evaluate(() =>
      Queue.items.some((q) => q.typeId === "was_now" && q.spec.regPrice === "129.00")));
    await page.waitForSelector(".toast");
    ok("refresh reports a price change", (await page.textContent(".toast")).includes("1 price change"));
    await waitToastGone();

    // ================= PDF export =================
    console.log("→ PDF export");
    const dl = page.waitForEvent("download", { timeout: 60000 });
    await page.click("#exportAllBtn");
    const download = await dl;
    const pdfPath = await download.path();
    const size = statSync(pdfPath).size;
    const head = readFileSync(pdfPath).subarray(0, 5).toString();
    ok("queue exports a real PDF", head === "%PDF-");
    ok(`export stays lean (${(size / 1024).toFixed(0)} KB < 1 MB)`, size > 5000 && size < 1024 * 1024);

    // single-sign PDF from the editor
    await page.click('.nav-item[data-type="text_only"]');
    await page.waitForSelector("#editorFields");
    await fill('[data-field="name"]', "STORE USE LADDERS");
    const dl2 = page.waitForEvent("download", { timeout: 60000 });
    await page.click("#pdfOneBtn");
    const d2 = await dl2;
    ok("editor PDF button downloads", statSync(await d2.path()).size > 2000);

    // ================= persistence round-trip =================
    console.log("→ Persistence (server-side state)");
    await page.waitForTimeout(700); // allow the debounced persist to flush
    const stateResp = await page.evaluate(async () => (await fetch("/api/state")).json());
    ok("queue persists server-side", Array.isArray(stateResp.queue) && stateResp.queue.length > 0);
    ok("batches persist server-side", !!(stateResp.batches && stateResp.batches["Test Batch"]));
    ok("copies persist server-side", (stateResp.queue || []).every((q) => q.copies >= 1));

    await shot("07-final");
    ok("no page errors during the run", pageErrors.length === 0, pageErrors.join(" | "));
  } finally {
    await browser.close().catch(() => {});
    if (!process.env.E2E_KEEP) {
      app.kill();
      mock.close();
    }
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) {
    console.log("Failed:", results.filter((r) => !r.pass).map((r) => r.name).join("; "));
    process.exit(1);
  }
}

run().catch((e) => {
  console.error("E2E crashed:", e);
  process.exit(1);
});
