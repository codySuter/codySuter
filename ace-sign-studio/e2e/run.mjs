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

/* Kill children even when a failure happens outside the main try (the app
   runs with -no-exit, so a leaked process never terminates itself). */
let appProc = null, mockSrv = null;
function cleanupChildren() {
  try { if (appProc) appProc.kill(); } catch {}
  try { if (mockSrv) mockSrv.close(); } catch {}
}
process.on("exit", () => { if (!process.env.E2E_KEEP) cleanupChildren(); });
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { cleanupChildren(); process.exit(130); });
}

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
  mockSrv = mock;
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
  appProc = app;
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
    ok("gallery renders all 19 sign types", (await page.$$(".g-card")).length === 19);
    ok("nav lists sign types", (await page.$$(".nav-item[data-type]")).length === 19);
    await page.waitForSelector("#g-prev-regular svg", { timeout: 20000 });
    await shot("01-gallery");

    // ================= multi product sign =================
    console.log("→ Multi Product sign (2–4 products on one 11×7 holder)");
    await page.click('.nav-item[data-type="multi"]');
    await page.waitForSelector("#multiProducts .mp-card");
    ok("multi opens with the two-product minimum", (await page.$$("#multiProducts .mp-card")).length === 2);
    ok("multi is pinned to the 11×7 holder", await page.evaluate(() =>
      App.sizeId === "holder-11x7" && document.querySelectorAll("#sizeSelect option").length === 1));
    await page.click("#mpAddBtn");
    await page.waitForFunction(() => document.querySelectorAll("#multiProducts .mp-card").length === 3);
    await page.click("#mpAddBtn");
    await page.waitForFunction(() => document.querySelectorAll("#multiProducts .mp-card").length === 4);
    ok("add button stops at four products", !(await page.$("#mpAddBtn")));
    const card = (i) => `#multiProducts .mp-card[data-product="${i}"]`;
    // product 1: a 2-for on a looked-up SKU
    await page.selectOption(`${card(0)} .mp-type`, "two_for");
    await fill(`${card(0)} [data-field="sku"]`, "3000003");
    await page.waitForSelector(`${card(0)} .lookup-status.ok`, { timeout: 20000 });
    ok("a product's lookup fills that product's name", (await page.inputValue(`${card(0)} [data-field="name"]`)).includes("DeWalt"));
    // product 2: regular price on an on-sale SKU → becomes a Sale cell
    await fill(`${card(1)} [data-field="sku"]`, "2000002");
    await page.waitForFunction((sel) => {
      const s = document.querySelector(sel);
      return !!s && s.value === "sale";
    }, `${card(1)} .mp-type`, { timeout: 20000 });
    ok("an on-sale product switches its cell to the Sale style", true);
    ok("the sale cell carries sale + reg price", await page.evaluate(() =>
      App.spec.products[1].spec.price === "19.99" && App.spec.products[1].spec.regPrice === "24.99"));
    // product 3: percent off, hand-entered
    await page.selectOption(`${card(2)} .mp-type`, "percent_off");
    await fill(`${card(2)} [data-field="name"]`, "All Weber Grill Accessories");
    await fill(`${card(2)} [data-field="percent"]`, "25");
    // product 4: regular, hand-entered
    await fill(`${card(3)} [data-field="name"]`, "Ace Wild Bird Food 20 lb");
    await fill(`${card(3)} [data-field="price"]`, "12.99");
    // product 1's multi-buy price goes in last: leaving a SKU field re-runs
    // its lookup on blur, which would put the store price back over a
    // hand-typed one typed straight after it
    await fill(`${card(0)} [data-field="price"]`, "20.00");
    // wait for the render that carries every product's text, not just the
    // first four-cell layout (the preview is debounced and async). Single
    // words only: a wrapped name is several <text> lines, so a phrase
    // spanning a line break never appears in textContent.
    const multiRendered = ([n, mustHave]) => {
      const s = document.querySelector("#signHolder svg");
      return !!s && s.querySelectorAll("g[data-product]").length === n && mustHave.every((t) => s.textContent.includes(t));
    };
    await page.waitForFunction(multiRendered, [4, ["DeWalt", "Scotts", "Weber", "Bird", "20"]], { timeout: 20000 })
      .catch(() => {});
    ok("preview tiles all four products with their own content", await page.evaluate(multiRendered, [4, ["DeWalt", "Scotts", "Weber", "Bird"]]));
    ok("a product's hand-typed price beats the lookup's", await page.evaluate(() => App.spec.products[0].spec.price === "20.00"));
    await shot("01b-multi-4up");
    // three-up: drop one and the sheet re-flows to three columns
    await page.click(`${card(3)} .mp-remove`);
    await page.waitForFunction(() => document.querySelectorAll("#multiProducts .mp-card").length === 3);
    await page.waitForFunction(() => document.querySelectorAll("#signHolder svg g[data-product]").length === 3, null, { timeout: 20000 });
    ok("removing a product re-flows the sheet to three", true);
    await shot("01c-multi-3up");
    await page.click("#addQueueBtn");
    await page.waitForSelector(".q-item");
    ok("multi sign lands in the queue as one 11×7 sign", await page.evaluate(() =>
      Queue.items.length === 1 && Queue.items[0].typeId === "multi" && Queue.items[0].sizeId === "holder-11x7"));
    ok("queue row is titled by its products", (await page.textContent(".q-item .q-title")).includes("DeWalt"));
    ok("only the price-style products count as refreshable units", await page.evaluate(() =>
      priceUnits(Queue.items[0]).length === 1 && priceUnits(Queue.items[0])[0].spec.sku === "2000002"));
    ok("an incomplete product is named by its slot", await page.evaluate(() => {
      const copy = JSON.parse(JSON.stringify(Queue.items[0].spec));
      copy.products[2].spec.percent = "";
      return String(validateSpec(typeById("multi"), copy)).startsWith("Product 3:");
    }));
    // two-up: down to the minimum, remove buttons disappear
    await page.click(`${card(2)} .mp-remove`);
    await page.waitForFunction(() => document.querySelectorAll("#multiProducts .mp-card").length === 2);
    await page.waitForFunction(() => document.querySelectorAll("#signHolder svg g[data-product]").length === 2, null, { timeout: 20000 });
    ok("two products can't be removed further", (await page.$$("#multiProducts .mp-remove")).length === 0);
    await shot("01d-multi-2up");
    await page.evaluate(() => Queue.remove(Queue.items[0].uid));
    await page.waitForFunction(() => Queue.items.length === 0);
    await waitToastGone();

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
    await page.evaluate(() => { document.querySelector("#fineTune").open = true; }); // barcode lives in the fine-tune section
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
    await page.evaluate(() => { document.querySelector("#sheetBox").open = true; });
    await page.waitForSelector(".sheet-thumb svg", { timeout: 20000 });
    ok("sheet layout preview renders when the section is opened", true);

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
    await page.click('.nav-item[data-type="big_text"]');
    await page.waitForSelector("#editorFields");
    await fill('[data-field="name"]', "PROPANE REFILLS");
    await fill('[data-field="price"]', "17.99");
    await page.click("#addQueueBtn");
    await page.waitForFunction(() => Queue.items.length === 2);
    const orderBefore = await page.$$eval(".q-item .q-title", (n) => n.map((x) => x.textContent));
    await page.click('.q-item:first-child button[title="More actions"]');
    await page.click('.pick-menu button:has-text("Move down")');
    await page.waitForFunction(
      (was) => document.querySelector(".q-item .q-title").textContent !== was,
      orderBefore[0]
    );
    const orderAfter = await page.$$eval(".q-item .q-title", (n) => n.map((x) => x.textContent));
    ok("▼ swaps the rows", orderAfter[0] === orderBefore[1] && orderAfter[1] === orderBefore[0]);
    await shot("04-queue");

    // ================= remove + undo =================
    console.log("→ Undo (remove, clear)");
    await page.click('.q-item:first-child button[title="More actions"]');
    await page.click('.pick-menu button:has-text("Remove")');
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
    await page.click("#bulkOpenBtn");
    await page.waitForSelector("#bulkModal.show");
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
    await page.click("#bulkModal .modal-close");
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

    // a lookup that succeeds WITHOUT price data must never rewrite a sign
    console.log("→ Priceless-lookup refresh regression");
    await mock.setNameOnly("2000002");
    await page.click("#refreshPricesBtn");
    await page.waitForSelector(".toast", { timeout: 30000 });
    ok("priceless lookup reported, not applied", (await page.textContent(".toast")).includes("without price data"));
    ok("sale sign untouched by priceless lookup", await page.evaluate(() =>
      Queue.items.some((q) => q.typeId === "sale" && q.spec.price === "19.99" && q.spec.regPrice === "24.99")));
    await waitToastGone();

    // ================= export guard =================
    console.log("→ Export blocks incomplete signs");
    await page.click("#exportAllBtn");
    await page.waitForSelector(".toast");
    ok("export blocked while a sign needs its Now price", (await page.textContent(".toast")).includes("incomplete"));
    await waitToastGone();
    // fix it through the click-to-edit flow
    await page.click('.q-item:has-text("This Unit Only Clearance") .q-main');
    await page.waitForSelector("#editBanner", { state: "visible" });
    await fill('[data-field="price"]', "89.99");
    await page.click("#addQueueBtn");
    await page.waitForSelector(".toast");
    ok("Now price set via queue edit", await page.evaluate(() =>
      Queue.items.some((q) => q.typeId === "was_now" && q.spec.price === "89.99")));
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
    await page.click('.nav-item[data-type="big_text"]');
    await page.click('.seg-btn:has-text("Message only")');
    await page.waitForSelector("#editorFields");
    await fill('[data-field="name"]', "STORE USE LADDERS");
    const dl2 = page.waitForEvent("download", { timeout: 60000 });
    await page.click("#editorMoreBtn");
    await page.click('.pick-menu button:has-text("PDF")');
    const d2 = await dl2;
    ok("editor PDF button downloads", statSync(await d2.path()).size > 2000);

    // ================= stale price guard =================
    // A queue outlives the prices in it: batches get reloaded weeks later and
    // "load last spring's sale, hit Print All" is one click. Age a queued
    // sign and make sure printing stops to ask.
    console.log("→ Stale price guard");
    const agedTitle = await page.evaluate(() => {
      const q = Queue.items.find((x) => PRICE_REFRESH_TYPES[x.typeId] && String(x.spec.sku || "").trim());
      if (!q) return null;
      q.spec.lookedUpAt = new Date(Date.now() - 30 * 86400000).toISOString();
      renderQueue();
      return queueItemTitle(q);
    });
    ok("a refreshable queued sign exists to age", agedTitle != null);
    await page.click("#exportAllBtn");
    await page.waitForSelector("#stalePriceModal.show", { timeout: 10000 });
    ok("printing stops to flag a 30-day-old price", true);
    ok("the stale sign is named with its age", (await page.textContent("#staleList")).includes("30d old"));
    ok("the fix is offered, not just a block", !!(await page.$("#staleRefreshBtn")));
    const dl3 = page.waitForEvent("download", { timeout: 60000 });
    await page.click("#staleProceedBtn");
    ok("“Print anyway” still exports", statSync(await (await dl3).path()).size > 2000);
    await waitToastGone();

    // the primary action: refresh the prices, then print in one go
    await page.evaluate(() => {
      const q = Queue.items.find((x) => PRICE_REFRESH_TYPES[x.typeId] && String(x.spec.sku || "").trim());
      q.spec.lookedUpAt = new Date(Date.now() - 30 * 86400000).toISOString();
      renderQueue();
    });
    await page.click("#exportAllBtn");
    await page.waitForSelector("#stalePriceModal.show", { timeout: 10000 });
    const dl4 = page.waitForEvent("download", { timeout: 90000 });
    await page.click("#staleRefreshBtn");
    ok("“Refresh prices, then print” refreshes and exports", statSync(await (await dl4).path()).size > 2000);
    ok(
      "the refreshed sign is no longer stale",
      await page.evaluate(() =>
        Queue.items.every((q) => {
          if (!PRICE_REFRESH_TYPES[q.typeId] || !String(q.spec.sku || "").trim()) return true;
          const d = priceAgeDays(q.spec);
          return d != null && d <= STALE_PRICE_DAYS;
        })
      )
    );
    await waitToastGone();

    // a fresh queue must not be nagged
    await page.evaluate(() => {
      Queue.items.forEach((q) => { if (q.spec.sku) q.spec.lookedUpAt = new Date().toISOString(); });
    });
    const dl5 = page.waitForEvent("download", { timeout: 60000 });
    await page.click("#exportAllBtn");
    ok("a freshly-priced queue prints with no prompt", statSync(await (await dl5).path()).size > 2000);

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
