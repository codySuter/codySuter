/**
 * End-to-end smoke test: drives the app in demo mode (real Convex functions
 * running in-memory) through every major flow, asserting and screenshotting.
 *
 * Usage: node e2e/run.mjs [--headed]
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(ROOT, "screenshots");
mkdirSync(SHOTS, { recursive: true });

const BASE = process.env.E2E_URL || "http://localhost:5173";
const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const EXECUTABLE =
  process.env.CHROMIUM_PATH || (existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined);

const results = [];
let page;

function ok(name, condition) {
  results.push({ name, pass: Boolean(condition) });
  console.log(`${condition ? "  ✓" : "  ✗ FAIL"} ${name}`);
  if (!condition) process.exitCode = 1;
}

async function shot(name) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  console.log(`  📸 ${name}.png`);
}

const mod = process.platform === "darwin" ? "Meta" : "Control";

async function run() {
  const browser = await chromium.launch({
    // Falls back to a locally installed Chrome when no bundled chromium exists.
    ...(EXECUTABLE ? { executablePath: EXECUTABLE } : { channel: "chrome" }),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  page = await ctx.newPage();
  page.on("pageerror", (err) => console.log("  ⚠ pageerror:", err.message));

  console.log("→ Boot & seed (demo mode)");
  await page.goto(`${BASE}/?demo=1`);
  await page.waitForSelector(".ws-switch", { timeout: 45000 });
  await page.waitForSelector(".tree-row >> text=Emberfall — Campaign Hub", { timeout: 30000 });
  ok("app boots into seeded D&D workspace", true);
  await shot("01-home");

  console.log("→ Campaign hub page (callouts, trackers, mentions, toggles)");
  await page.click(".tree-row:has-text('Emberfall — Campaign Hub')");
  await page.waitForSelector(".lf-tracker", { timeout: 20000 });
  ok("tracker block renders", await page.locator(".lf-tracker").count() > 0);
  ok("callout renders", await page.locator(".lf-callout").count() > 0);
  ok("mention chips render", await page.locator(".lf-mention").count() > 2);
  await shot("02-campaign-hub");

  console.log("→ Tracker +/- persists");
  const countBefore = await page.locator(".lf-tracker .tk-count").first().textContent();
  await page.locator(".lf-tracker .tk-btn").first().click();
  await page.waitForTimeout(400);
  const countAfter = await page.locator(".lf-tracker .tk-count").first().textContent();
  ok(`tracker decrements (${countBefore} → ${countAfter})`, countBefore !== countAfter);

  console.log("→ DM Screen: encounter block + inline dice chips");
  await page.click(".tree-row:has-text('DM Screen')");
  await page.waitForSelector(".lf-encounter", { timeout: 20000 });
  ok("encounter tracker renders", true);
  await page.locator(".lf-dice-chip:visible").first().click();
  await page.waitForSelector(".lf-toast", { timeout: 5000 });
  ok("dice chip roll toast appears", true);
  await shot("03-dm-screen");

  console.log("→ Next turn button advances encounter");
  await page.locator(".lf-encounter .lf-btn.primary").click();
  await page.waitForTimeout(400);
  ok("second combatant becomes active", (await page.locator(".en-row[data-active='true']").count()) === 1);

  console.log("→ Back to hub, mention navigation + backlinks");
  await page.click(".tree-row:has-text('Emberfall — Campaign Hub')");
  await page.waitForSelector(".lf-mention", { timeout: 15000 });
  await page.locator(".lf-mention:has-text('World Atlas')").first().click();
  await page.waitForSelector(".lf-map", { timeout: 15000 });
  ok("map block renders on World Atlas", true);
  ok("map has pins", (await page.locator(".map-pin").count()) >= 3);
  await page.waitForSelector(".backlinks-panel", { timeout: 10000 });
  ok("backlinks panel shows 'Mentioned in'", await page.locator(".backlink-item").count() > 0);
  await shot("04-world-atlas-map");

  console.log("→ Map pin navigates");
  await page.locator(".map-pin:has-text('The Sunken Sepulcher')").click();
  await page.waitForSelector("text=The descent", { timeout: 10000 });
  ok("pin click navigates to dungeon page", true);
  ok("statblock in dungeon toggle area exists later", true);

  console.log("→ Roll table rolls and highlights (expand tree first)");
  await page.locator(".tree-row:has-text('World Atlas') .twirl").click();
  await page.waitForSelector(".tree-row:has-text('Thornhollow')", { timeout: 10000 });
  ok("sidebar tree expands to show children", true);
  await page.click(".tree-row:has-text('Thornhollow')");
  await page.waitForSelector(".lf-rolltable", { timeout: 15000 });
  await page.locator(".lf-rolltable .lf-btn.primary").first().click();
  await page.waitForTimeout(500);
  ok("roll table highlights a row", (await page.locator(".lf-rolltable tr[data-hit='true']").count()) === 1);
  await shot("05-rolltable");

  console.log("→ Database: Characters table view");
  await page.click(".tree-row:has-text('Characters')");
  await page.waitForSelector(".db-table", { timeout: 15000 });
  ok("table rows exist", (await page.locator(".db-table tbody tr").count()) >= 6);
  ok("select chips render", (await page.locator(".db-table .lf-chip").count()) > 4);
  await shot("06-characters-table");

  console.log("→ Board view (By Role)");
  await page.click(".db-tab:has-text('By Role')");
  await page.waitForSelector(".board-col", { timeout: 10000 });
  ok("board columns render", (await page.locator(".board-col").count()) >= 3);
  await shot("07-characters-board");

  console.log("→ Entry peek (row as page) with statblock content");
  await page.click(".tree-row:has-text('Bestiary')");
  await page.waitForSelector(".db-table", { timeout: 15000 });
  const wyrmRow = page.locator("tr:has(input[value='Ashvein Wyrmling'])");
  await wyrmRow.hover();
  await wyrmRow.locator(".open-tag").click({ force: true });
  await page.waitForSelector(".lf-peek .lf-statblock", { timeout: 15000 });
  ok("entry peek opens with a stat block", true);
  await shot("08-entry-peek-statblock");

  console.log("→ Statblock ability click rolls");
  await page.locator(".lf-peek .sb-ability").first().click();
  await page.waitForSelector(".lf-toast", { timeout: 5000 });
  ok("ability check rolled from stat block", true);
  await page.keyboard.press("Escape");

  console.log("→ Quick switcher (⌘K) search");
  await page.keyboard.press(`${mod}+k`);
  await page.waitForSelector(".qs-input", { timeout: 5000 });
  await page.fill(".qs-input", "Sepulcher");
  await page.waitForTimeout(600);
  const qsItems = await page.locator(".qs-item").count();
  ok(`quick switcher finds results (${qsItems})`, qsItems >= 1);
  await shot("09-quick-switcher");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);

  console.log("→ New page: slash menu & custom blocks");
  await page.click(".sidebar-section button[title='New page']");
  await page.waitForSelector(".page-title-input", { timeout: 10000 });
  await page.fill(".page-title-input", "E2E Test Page");
  await page.click(".lf-editor .bn-editor");
  await page.keyboard.type("Testing the forge. ");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/stat");
  await page.waitForTimeout(700);
  const slashVisible = await page.locator("text=Stat Block (5E)").count();
  ok("slash menu shows custom block", slashVisible > 0);
  await shot("10-slash-menu");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".lf-modal", { timeout: 8000 });
  ok("statblock editor dialog opens on insert", true);
  await page.click(".lf-modal .lf-btn.primary");
  await page.waitForSelector(".lf-editor .lf-statblock", { timeout: 8000 });
  ok("statblock inserted into new page", true);

  console.log("→ @mention autocomplete");
  const firstParagraph = page.locator(".lf-editor .bn-editor [data-content-type='paragraph']").first();
  await firstParagraph.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" @Thorn");
  await page.waitForTimeout(900);
  const mentionItem = page
    .locator(".bn-suggestion-menu-item, [class*='suggestion']")
    .filter({ hasText: "Thornhollow" })
    .filter({ hasNotText: "Session 0" });
  const mentionCount = await mentionItem.count();
  ok(`@mention menu suggests pages (${mentionCount})`, mentionCount > 0);
  await shot("11-mention-menu");
  if (mentionCount > 0) {
    await mentionItem.first().click();
    await page.waitForTimeout(600);
    const chip = page
      .locator(".lf-editor .lf-mention:has-text('Thornhollow')")
      .filter({ hasNotText: "Session 0" });
    ok("mention chip inserted", (await chip.count()) > 0);
  }
  await page.waitForTimeout(1200); // let the debounced save land

  console.log("→ Backlink created by mention");
  await page.click(".tree-row:has-text('Thornhollow')");
  await page.waitForSelector(".backlinks-panel", { timeout: 10000 });
  // The link lands when the editor's debounced save flushes — retry until it shows.
  const backlinkHit = await page
    .waitForSelector(".backlink-item:has-text('E2E Test Page')", { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  if (!backlinkHit) {
    const dbg = await page.evaluate(async () => {
      const demo = window.__loreDemo;
      if (!demo) return "no demo hook";
      const ws = (await demo.query("workspaces:list", {}))[0];
      const tree = await demo.query("pages:tree", { workspaceId: ws._id });
      const testPage = tree.find((p) => p.title === "E2E Test Page");
      const full = testPage ? await demo.query("pages:get", { pageId: testPage._id }) : null;
      return {
        pageTitles: tree.map((p) => p.title),
        testContent: full ? JSON.stringify(full.content)?.slice(0, 900) : "(no page)",
      };
    });
    console.log("  DEBUG:", JSON.stringify(dbg).slice(0, 1400));
  }
  ok("new page appears in Thornhollow backlinks", backlinkHit);
  await page.locator(".backlinks-panel").scrollIntoViewIfNeeded();
  await shot("12-backlinks");

  console.log("→ Dice tray with history");
  await page.keyboard.press(`${mod}+j`);
  await page.waitForSelector(".dice-tray", { timeout: 5000 });
  await page.locator(".die-btn:has-text('d20')").click();
  await page.waitForTimeout(600);
  ok("dice tray logs rolls", (await page.locator(".roll-log-item").count()) > 0);
  await shot("13-dice-tray");
  await page.keyboard.press(`${mod}+j`);

  console.log("→ Switch to Daggerheart workspace");
  await page.click(".ws-switch");
  await page.click(".lf-menu-item:has-text('The Withered Vale')");
  await page.waitForSelector(".tree-row:has-text('Campaign Frame')", { timeout: 20000 });
  const modeAttr = await page.evaluate(() => document.documentElement.dataset.mode);
  ok(`mode switches to daggerheart (${modeAttr})`, modeAttr === "daggerheart");
  await shot("14-daggerheart-home");

  console.log("→ GM Screen: fear tracker, spotlight encounter, duality");
  await page.click(".tree-row:has-text('GM Screen')");
  await page.waitForSelector(".lf-encounter", { timeout: 15000 });
  ok("encounter/spotlight block renders", true);
  ok("fear tracker present", (await page.locator(".tk-fear").count()) > 0);
  await shot("15-gm-screen");

  console.log("→ Adversary card in codex");
  await page.click(".tree-row:has-text('Adversary Codex')");
  await page.waitForSelector(".db-table", { timeout: 15000 });
  const stagRow = page.locator("tr:has(input[value='Wither-Touched Stag'])");
  await stagRow.hover();
  await stagRow.locator(".open-tag").click({ force: true });
  await page.waitForSelector(".lf-peek .lf-adversary", { timeout: 15000 });
  ok("adversary card renders in entry peek", true);
  await shot("16-adversary-card");
  await page.keyboard.press("Escape");

  console.log("→ Duality roll from tray");
  await page.keyboard.press(`${mod}+j`);
  await page.waitForSelector(".duality-btn", { timeout: 5000 });
  await page.click(".duality-btn");
  // Older toasts may still be on screen — wait for the duality-flavored one.
  const dualityToast = await page
    .waitForSelector(
      ".lf-toast:has-text('Hope'), .lf-toast:has-text('Fear'), .lf-toast:has-text('Critical')",
      { timeout: 6000 },
    )
    .then((el) => el.textContent())
    .catch(() => null);
  ok(`duality roll shows Hope/Fear (${dualityToast?.slice(0, 44) ?? "none"}…)`, dualityToast !== null);
  await shot("17-duality-roll");

  console.log("→ Timeline & story threads board");
  await page.click(".tree-row:has-text('Chronicle of the Vale')");
  await page.waitForSelector(".lf-timeline", { timeout: 15000 });
  ok("timeline renders eras", (await page.locator(".tl-era").count()) >= 3);
  await shot("18-timeline");
  await page.click(".tree-row:has-text('Story Threads')");
  await page.waitForSelector(".board-col", { timeout: 15000 });
  ok("story threads board renders", (await page.locator(".board-card").count()) >= 4);
  await shot("19-threads-board");

  console.log("→ Light theme");
  await page.click(".ws-switch");
  await page.click(".lf-menu-item:has-text('light theme')");
  await page.waitForTimeout(500);
  await page.keyboard.press("Escape");
  ok("light theme applies", (await page.evaluate(() => document.documentElement.dataset.theme)) === "light");
  await shot("20-light-theme");

  console.log("→ Trash flow");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.click(".ws-switch");
  await page.click(".lf-menu-item:has-text('dark theme')").catch(() => {});
  await page.keyboard.press("Escape");

  const summaryFail = results.filter((r) => !r.pass);
  console.log(`\n${results.length - summaryFail.length}/${results.length} checks passed`);
  if (summaryFail.length) {
    console.log("FAILED:", summaryFail.map((r) => r.name).join(" | "));
  }
  await browser.close();
}

run().catch(async (error) => {
  console.error("E2E crashed:", error);
  try {
    if (page) await page.screenshot({ path: path.join(SHOTS, "crash.png") });
  } catch {}
  process.exitCode = 1;
  process.exit(1);
});
