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

async function boot(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('bin').first()).toBeVisible();
}

test('boots with the default back room: 4 aisles, 192 OPTIs, all unlabeled', async ({ page }) => {
  await boot(page);
  await expect(page.getByTestId('aisle')).toHaveCount(4);
  await expect(page.getByTestId('bin')).toHaveCount(192);
  await expect(page.getByTestId('labeled-count')).toHaveText('0 / 192 OPTIs labeled');
  await expect(page.getByText('Bay Aisle 1')).toBeVisible();
  await page.screenshot({ path: 'test-results/boot.png', fullPage: false });
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
  const wash = (i: number) =>
    bins.nth(i).locator('div').nth(1).evaluate((el) => getComputedStyle(el).borderWidth);
  expect(await wash(0)).toBe('2px'); // overlay border present
  await page.getByTestId('overlay-eye').click();
  expect(await wash(0)).not.toBe('2px'); // hidden — the lip div is index 1 now

  // Deleting the overlay strips it from bins.
  await page.getByTestId('overlay-delete').click();
  await page.getByTestId('overlay-delete-confirm').click();
  await expect(page.getByTestId('overlay-row')).toHaveCount(0);
});

test('CSV import matches labeled OPTIs, reports unknown ones, and search finds items', async ({ page }) => {
  await boot(page);

  // Label two bins the sheet refers to.
  for (const [i, label] of [[0, '82'], [10, '65']] as const) {
    await page.getByTestId('bin').nth(i).click();
    await page.getByTestId('bin-label').fill(label);
    await page.getByTestId('details-close').click();
  }

  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('import-csv').click();
  (await chooser).setFiles({ name: 'contents.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });

  const dialog = page.getByTestId('import-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('3 rows match 2 labeled OPTIs');
  await expect(dialog).toContainText('No OPTI on the map is labeled: 999');
  await dialog.getByTestId('import-apply').click();
  await expect(page.getByTestId('toast')).toContainText('Imported 3 items into 2 OPTIs');

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
