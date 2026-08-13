import { expect, test, type Page } from '@playwright/test';

// Renderer E2E against the built app (vite preview). The browser build
// persists to localStorage, so each test starts from a fresh context.

const CSV = [
  'opti,item,qty,sku,note',
  '82,Traeger pellet grill,2,1004114,display return',
  '82,"Char-Broil, 4-burner",1,8069731,',
  '65,Wheelbarrow 6 cu ft,4,7331507,',
  '999,Item in an unknown OPTI,1,,',
].join('\n');

const fmtUS = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;

// Headers exactly as an Epicor Compass / Eagle inventory query exports them.
const COMPASS_CSV = () =>
  [
    'Location,Item Description,QOH,SKU,Date Last Physical',
    `82,PELLET GRILL,2,1004114,${fmtUS(new Date(Date.now() - 5 * 86_400_000))}`,
    '65,WHEELBARROW,4,7331507,01/15/2020',
  ].join('\n');

async function boot(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('bin').first()).toBeVisible();
}

async function labelBin(page: Page, index: number, label: string) {
  await page.getByTestId('bin').nth(index).click();
  await page.getByTestId('bin-label').fill(label);
  await page.getByTestId('details-close').click();
}

async function importCsv(page: Page, csv: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('import-csv').click();
  (await chooser).setFiles({ name: 'contents.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByTestId('import-dialog')).toBeVisible();
}

test('boots with the default store: 4 bay aisles (192 OPTIs) + 21 floor locations', async ({ page }) => {
  await boot(page);
  await expect(page.getByTestId('aisle')).toHaveCount(4);
  await expect(page.getByTestId('bin')).toHaveCount(192);
  await expect(page.getByTestId('labeled-count')).toHaveText('0 / 192 OPTIs labeled');

  await page.getByTestId('area-floor').click();
  await expect(page.getByTestId('floor-loc')).toHaveCount(21);
  await expect(page.getByTestId('labeled-count')).toHaveText('21 / 21 locations labeled');
  await expect(page.getByTestId('floor-loc').first()).toContainText('1');
  await page.screenshot({ path: 'test-results/floor.png' });
  await page.getByTestId('area-bays').click();
  await expect(page.getByTestId('bin')).toHaveCount(192);
});

test('labeling an OPTI sticks, shows on the map, and survives a reload', async ({ page }) => {
  await boot(page);
  const bin = page.getByTestId('bin').nth(3);
  await bin.click();
  await expect(page.getByTestId('bin-details')).toBeVisible();
  await page.getByTestId('bin-label').fill('82');
  await expect(bin).toContainText('82');
  await expect(page.getByTestId('labeled-count')).toHaveText('1 / 192 OPTIs labeled');

  // Debounced save is 400ms — give it a beat, then reload.
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByTestId('bin').nth(3)).toContainText('82');
  await expect(page.getByTestId('labeled-count')).toHaveText('1 / 192 OPTIs labeled');
});

test('overlays: create, paint, hide, and delete', async ({ page }) => {
  await boot(page);
  await page.getByTestId('add-overlay').click();
  await expect(page.getByTestId('overlay-row')).toHaveCount(1);

  // Creating an overlay arms the paint brush — paint three bins.
  const bins = page.getByTestId('bin');
  for (const i of [0, 1, 2]) await bins.nth(i).dispatchEvent('pointerdown', { buttons: 1 });
  await expect(page.getByTestId('overlay-row').getByText('3', { exact: true })).toBeVisible();

  // Painting the same bin again erases it.
  await bins.nth(2).dispatchEvent('pointerdown', { buttons: 1 });
  await expect(page.getByTestId('overlay-row').getByText('2', { exact: true })).toBeVisible();

  // The wash is drawn iff the overlay is visible.
  await expect(bins.nth(0).getByTestId('wash')).toBeVisible();
  await page.getByTestId('overlay-eye').click();
  await expect(bins.nth(0).getByTestId('wash')).toHaveCount(0);

  // Deleting the overlay strips it from bins.
  await page.getByTestId('overlay-delete').click();
  await page.getByTestId('overlay-delete-confirm').click();
  await expect(page.getByTestId('overlay-row')).toHaveCount(0);
});

test('CSV import matches labeled OPTIs, reports unknown ones, and search finds items', async ({ page }) => {
  await boot(page);
  await labelBin(page, 0, '82');
  await labelBin(page, 10, '65');

  await importCsv(page, CSV);
  const dialog = page.getByTestId('import-dialog');
  await expect(dialog).toContainText('3 rows match 2 labeled locations');
  await expect(dialog).toContainText('No location here is labeled: 999');
  await dialog.getByTestId('import-apply').click();
  await expect(page.getByTestId('toast')).toContainText('Imported 3 items into 2 locations');

  // The bin badge shows the item count; details list the items.
  const bin82 = page.locator('[data-testid="bin"][data-label="82"]');
  await expect(bin82.getByTestId('item-badge')).toHaveText('2');
  await bin82.click();
  await expect(page.getByTestId('item-row')).toHaveCount(2);
  await expect(page.getByTestId('item-name').first()).toHaveValue('Traeger pellet grill');
  await expect(page.getByTestId('item-name').nth(1)).toHaveValue('Char-Broil, 4-burner');
  await page.getByTestId('details-close').click();

  // Search by item name dims everything but the OPTI that holds it.
  await page.getByTestId('search').fill('wheelbarrow');
  await expect(page.locator('[data-testid="bin"].opacity-20')).toHaveCount(191);
  await expect(page.locator('[data-testid="bin"][data-label="65"]')).not.toHaveClass(/opacity-20/);
  await page.screenshot({ path: 'test-results/search.png' });
});

test('Compass export: header aliases + Date Last Physical drive the freshness preset', async ({ page }) => {
  await boot(page);
  await labelBin(page, 0, '82');
  await labelBin(page, 10, '65');

  await importCsv(page, COMPASS_CSV());
  const dialog = page.getByTestId('import-dialog');
  await expect(dialog).toContainText('2 rows match 2 labeled locations');
  await expect(dialog).toContainText('2 with a Date Last Physical');
  await dialog.getByTestId('import-apply').click();
  await expect(page.getByTestId('toast')).toContainText('How old is the data?');

  // No wash until the preset is on.
  const bin82 = page.locator('[data-testid="bin"][data-label="82"]');
  const bin65 = page.locator('[data-testid="bin"][data-label="65"]');
  await expect(bin82.getByTestId('wash')).toHaveCount(0);
  await page.getByTestId('freshness-toggle').click();

  // 5 days old → full green; 2020 → full red.
  await expect(bin82.getByTestId('wash')).toHaveCSS('border-color', 'rgb(46, 147, 60)');
  await expect(bin65.getByTestId('wash')).toHaveCSS('border-color', 'rgb(212, 0, 41)');
  await expect(page.getByTestId('freshness-stats')).toContainText('1 fresh');
  await expect(page.getByTestId('freshness-stats')).toContainText('1 stale');

  // Details surface the oldest Date Last Physical.
  await bin65.click();
  await expect(page.getByTestId('bin-freshness')).toContainText('2020-01-15');
  await expect(page.getByTestId('item-lastphys')).toHaveValue('2020-01-15');
  await page.screenshot({ path: 'test-results/freshness.png' });
});

test('sales floor: tiles import by aisle location code, scoped to the floor', async ({ page }) => {
  await boot(page);
  await page.getByTestId('area-floor').click();
  await expect(page.getByTestId('floor-loc')).toHaveCount(21);

  // On the floor tab the import scope defaults to the sales floor.
  await importCsv(page, 'Location,Item Description,QOH\n12,SNOW SHOVEL,6\n12,ICE MELT 50LB,10\n');
  const dialog = page.getByTestId('import-dialog');
  await expect(dialog).toContainText('2 rows match 1 labeled location');
  await dialog.getByTestId('import-apply').click();

  const tile12 = page.locator('[data-testid="floor-loc"][data-label="12"]');
  await expect(tile12.getByTestId('item-badge')).toHaveText('2');
  await tile12.click();
  await expect(page.getByTestId('bin-details')).toContainText('Location details');
  await expect(page.getByTestId('item-name').first()).toHaveValue('SNOW SHOVEL');
  await page.getByTestId('details-close').click();

  // Layout: add a 22nd location.
  await page.getByTestId('open-settings').click();
  await page.getByTestId('add-floor').click();
  await expect(page.getByTestId('floor-chip')).toHaveCount(22);
  await page.mouse.click(10, 10);
  await expect(page.getByTestId('floor-loc')).toHaveCount(22);
});

test('layout settings: resize an aisle and add one', async ({ page }) => {
  await boot(page);
  await page.getByTestId('open-settings').click();
  const dialog = page.getByTestId('settings-dialog');
  await expect(dialog.getByTestId('settings-aisle')).toHaveCount(4);

  // 3 shelves → 4 on aisle 1 adds 8 bins per side: 192 + 16.
  await dialog.getByTestId('stepper-shelves').first().getByText('+').click();
  await dialog.getByTestId('settings-aisle').first().getByText('= 64 OPTIs (both sides)').waitFor();

  await dialog.getByTestId('add-aisle').click();
  await expect(dialog.getByTestId('settings-aisle')).toHaveCount(5);
  await page.mouse.click(10, 10); // click the backdrop to close
  await expect(page.getByTestId('bin')).toHaveCount(192 + 16 + 48);
  await expect(page.getByText('Bay Aisle 5')).toBeVisible();
});
