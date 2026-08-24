import { expect, test, type Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';

// Renderer E2E against the built app (vite preview). The browser build
// persists to localStorage, so each test starts from a fresh context.

/** An ISO date N days ago — parsed to UTC midnight, it reads back as exactly N days. */
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);

/** A small Compass-shaped export exercising the parser's edge cases. */
function testCsv(): string {
  return [
    'SKU,DESCRIPTION,LOC 1,LOC 2,QOH,AVG COST,DATE LAST PHYSICAL',
    `1000001,HAMMER 16OZ,BW01,,12,$8.99,${iso(5)}`,
    `1000002,WIDGET SPINNER,13r-5a,,3,$1.50,${iso(400)}`, // sloppy code → 13R05
    `1000003,GHOST ITEM,EC12,,1,$2.00,`, // never counted
    `1000004,TWO-SPOT ITEM,"BW05; EC03",,7,$3.25,${iso(100)}`, // multi-location cell
    `1000005,LOST ITEM,ZZ99,,2,$4.00,${iso(10)}`, // unknown code
    `1000006,RETURN MAGNET 3" NEO,10R05,,(3),"$1,299.99",${iso(30)}`, // mid-field inch mark + parens negative + $ comma
    `1000007,DUSTY HAMMER,BW01,,4,$9.99,${iso(200)}`, // second SKU in BW01
  ].join('\n');
}

async function boot(page: Page) {
  await page.goto('/');
  await expect(page.locator('[data-testid="fixture"]').first()).toBeVisible();
}

async function importCsv(page: Page, csv: string, via = 'import-hero') {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId(via).click();
  (await chooser).setFiles({ name: 'export.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByTestId('import-dialog')).toBeVisible();
}

test('boots with the whole Media PA plan: 340 locations, no data yet', async ({ page }) => {
  await boot(page);
  await expect(page.locator('[data-testid="fixture"]')).toHaveCount(340);
  await expect(page.getByTestId('header-status')).toHaveText('No import yet');
  await expect(page.getByTestId('sample-hero')).toBeVisible();
  // A few landmarks from the printed plan.
  for (const id of ['BW23', '13L09', '01R01', 'EC12', 'GRILL', 'REG', 'BAIT', 'COLORCHIPS', 'BBW20']) {
    await expect(page.locator(`[data-loc="${id}"]`)).toHaveCount(1);
  }
  await page.screenshot({ path: 'test-results/boot.png' });
});

test('CSV import: mapping detected, edge-case locations resolve, heatmap colors by staleness', async ({ page }) => {
  await boot(page);
  await importCsv(page, testCsv());

  const dialog = page.getByTestId('import-dialog');
  // Auto-mapping picked the right columns.
  await expect(dialog.getByTestId('map-sku')).toHaveValue('0');
  await expect(dialog.getByTestId('map-datePhys')).toHaveValue('6');
  await expect(dialog.getByTestId('import-summary')).toContainText('7 SKUs · 6 place into 6 of 340');
  await expect(dialog.getByTestId('import-summary')).toContainText('Codes not on the plan: ZZ99');
  await dialog.getByTestId('import-apply').click();
  await expect(page.getByTestId('toast')).toContainText('Imported 6 SKUs across 6 locations');

  // Oldest-count mode is the default: BW01 holds a 5d and a 200d SKU.
  const bw01 = page.locator('[data-loc="BW01"]');
  await expect(bw01).toHaveAttribute('data-days', '200');
  await expect(page.locator('[data-loc="13R05"]')).toHaveAttribute('data-days', '400');
  await expect(page.locator('[data-loc="EC12"]')).toHaveAttribute('data-never', 'true');
  // The multi-location cell landed in both spots.
  await expect(page.locator('[data-loc="BW05"]')).toHaveAttribute('data-days', '100');
  await expect(page.locator('[data-loc="EC03"]')).toHaveAttribute('data-days', '100');
  await expect(page.getByTestId('header-status')).toHaveText('6 locations heat-mapped');
  await expect(page.getByTestId('coverage')).toContainText('6 of 340 locations covered');

  // Fresh vs stale actually reads as different paint.
  const fill = (loc: string) => page.locator(`[data-loc="${loc}"] rect`).getAttribute('fill');
  expect(await fill('BW05')).not.toBe(await fill('13R05'));
  expect(await fill('EC12')).toBe('url(#afs-never)');
  // A bay the import never mentions stays neutral.
  expect(await fill('GRILL')).toBe('#ECEDEF');
  await page.screenshot({ path: 'test-results/heatmap.png' });
});

test('age modes, thresholds, and the colorblind ramp all recolor the map', async ({ page }) => {
  await boot(page);
  await importCsv(page, testCsv());
  await page.getByTestId('import-apply').click();

  const bw01 = page.locator('[data-loc="BW01"]');
  await page.getByTestId('age-mode-newest').click();
  await expect(bw01).toHaveAttribute('data-days', '5');
  await page.getByTestId('age-mode-average').click();
  await expect(bw01).toHaveAttribute('data-days', '103');
  await page.getByTestId('age-mode-oldest').click();
  await expect(bw01).toHaveAttribute('data-days', '200');

  // Widening the red point from 365 → 1000 days softens the 400d bay.
  const stale = page.locator('[data-loc="13R05"] rect');
  const before = await stale.getAttribute('fill');
  await page.getByTestId('threshold-hi').fill('1000');
  await page.getByTestId('threshold-hi').blur();
  await expect(stale).not.toHaveAttribute('fill', before!);

  // Clearing the field reverts instead of committing 0.
  await page.getByTestId('threshold-hi').fill('');
  await page.getByTestId('threshold-hi').blur();
  await expect(page.getByTestId('threshold-hi')).toHaveValue('1000');

  const cvdBefore = await stale.getAttribute('fill');
  await page.getByTestId('ramp-cvd').check();
  await expect(stale).not.toHaveAttribute('fill', cvdBefore!);
});

test('a stored metric that the next import cannot run falls back to one it can', async ({ page }) => {
  await boot(page);
  await page.getByTestId('sample-hero').click();
  await page.getByTestId('import-apply').click();
  await page.getByTestId('metric-select').selectOption('sold');
  await expect(page.getByTestId('header-status')).toContainText('locations heat-mapped');

  // The hand-made CSV has no units-sold column — the map must not keep
  // painting a locked metric.
  await importCsv(page, testCsv(), 'import-file');
  await page.getByTestId('import-apply').click();
  await expect(page.getByTestId('metric-select')).toHaveValue('phys');
  await expect(page.locator('[data-loc="BW01"]')).toHaveAttribute('data-days', '200');
});

test('metric picker: locked without its column, magnitude metrics recolor, values print on the map', async ({ page }) => {
  await boot(page);
  await importCsv(page, testCsv());
  await page.getByTestId('import-apply').click();

  // The test CSV has no units-sold column, so sales metrics are locked.
  const soldOption = page.locator('[data-testid="metric-select"] option[value="sold"]');
  await expect(soldOption).toHaveJSProperty('disabled', true);
  await expect(page.locator('[data-testid="metric-select"] option[value="units"]')).toHaveJSProperty('disabled', false);

  await page.getByTestId('metric-select').selectOption('skuCount');
  await expect(page.locator('[data-loc="BW01"]')).toHaveAttribute('data-value', '2');
  await page.getByTestId('metric-select').selectOption('negPct');
  // 10R05 holds the single (3)-parens negative SKU → 100% negative.
  await expect(page.locator('[data-loc="10R05"]')).toHaveAttribute('data-value', '100');

  await page.getByTestId('metric-select').selectOption('phys');
  await page.getByTestId('show-values').check();
  await expect(page.locator('[data-loc="BW01"] text').nth(1)).toHaveText('200d');
});

test('details panel lists the bay contents oldest-first with dates', async ({ page }) => {
  await boot(page);
  await importCsv(page, testCsv());
  await page.getByTestId('import-apply').click();

  await page.locator('[data-loc="BW01"]').click();
  const details = page.getByTestId('fixture-details');
  await expect(details).toBeVisible();
  await expect(details.getByTestId('details-heat')).toContainText('Last physical count: 200d · 2 SKUs');
  await expect(details.getByTestId('sku-row')).toHaveCount(2);
  await expect(details.getByTestId('sku-row').first()).toContainText('DUSTY HAMMER');
  await expect(details.getByTestId('sku-row').first()).toContainText('(200d)');
  await details.getByTestId('details-close').click();
  await expect(page.getByTestId('fixture-details')).toHaveCount(0);
});

test('search dims everything except the bays that hold the match', async ({ page }) => {
  await boot(page);
  await importCsv(page, testCsv());
  await page.getByTestId('import-apply').click();

  await page.getByTestId('search').fill('widget');
  await expect(page.locator('[data-loc="13R05"]')).toHaveAttribute('opacity', '1');
  await expect(page.locator('[data-loc="BW01"]')).toHaveAttribute('opacity', '0.16');
  await expect(page.getByTestId('search-count')).toContainText('1 location');

  // Location codes match too.
  await page.getByTestId('search').fill('ec12');
  await expect(page.locator('[data-loc="EC12"]')).toHaveAttribute('opacity', '1');
});

test('the import and settings survive a reload', async ({ page }) => {
  await boot(page);
  await importCsv(page, testCsv());
  await page.getByTestId('import-apply').click();
  await page.getByTestId('metric-select').selectOption('skuCount');

  await page.waitForTimeout(700); // debounced save
  await page.reload();
  await expect(page.getByTestId('header-status')).toHaveText('6 locations heat-mapped');
  await expect(page.getByTestId('metric-select')).toHaveValue('skuCount');
  await expect(page.locator('[data-loc="BW01"]')).toHaveAttribute('data-value', '2');
});

test('a real .xlsx import parses cells, shared strings, and date serials', async ({ page }) => {
  await boot(page);

  const serial = Math.floor(Date.UTC(2025, 0, 15) / 86400000) + 25569; // 01/15/2025
  const sheet = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
<row r="2"><c r="A2"><v>2001</v></c><c r="B2" t="inlineStr"><is><t>BW07</t></is></c><c r="C2"><v>${serial}</v></c></row>
<row r="3"><c r="A3"><v>2002</v></c><c r="B3" t="s"><v>3</v></c><c r="C3"></c></row>
</sheetData></worksheet>`;
  const sst = `<?xml version="1.0"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>SKU</t></si><si><t>LOC 1</t></si><si><t>DATE LAST PHYSICAL</t></si><si><t>EC05</t></si></sst>`;
  const xlsx = zipSync({
    'xl/worksheets/sheet1.xml': strToU8(sheet),
    'xl/sharedStrings.xml': strToU8(sst),
  });

  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('import-hero').click();
  (await chooser).setFiles({
    name: 'compass.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(xlsx),
  });

  const dialog = page.getByTestId('import-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('import-summary')).toContainText('place into 2 of 340');
  await dialog.getByTestId('import-apply').click();

  await expect(page.locator('[data-loc="BW07"]')).toHaveAttribute('data-days', /\d+/);
  await expect(page.locator('[data-loc="EC05"]')).toHaveAttribute('data-never', 'true');
});

test('sample data lights up the whole floor and flags its unmatched codes', async ({ page }) => {
  await boot(page);
  await page.getByTestId('sample-hero').click();
  const dialog = page.getByTestId('import-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('import-apply').click();

  await expect(page.getByTestId('coverage')).toContainText('333 of 340 locations covered');
  await page.getByTestId('unmatched-toggle').click();
  await expect(page.getByTestId('unmatched-list')).toContainText('RECV');
  await expect(page.getByTestId('unmatched-list')).toContainText('OUTBLDG');

  // Every metric in the catalog is live on the sample.
  for (const metric of ['sale', 'receipt', 'neverPct', 'oosPct', 'retailValue', 'sold']) {
    await page.getByTestId('metric-select').selectOption(metric);
    await expect(page.getByTestId('header-status')).toContainText('locations heat-mapped');
  }
  await page.getByTestId('metric-select').selectOption('phys');
  const worst = page.getByTestId('worst-row').first();
  await expect(worst).toBeVisible();
  await worst.click();
  await expect(page.getByTestId('fixture-details')).toBeVisible();
  await page.screenshot({ path: 'test-results/sample.png' });
});
