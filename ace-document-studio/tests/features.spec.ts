import { expect, test, type Page } from '@playwright/test';

// 2.0 feature coverage, against the built app in browser mode.

async function boot(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('library-card')).toHaveCount(3, { timeout: 10_000 });
}

async function openDoc(page: Page, title: string) {
  await page.getByText(title).first().click();
  await expect(page.getByTestId('page-edit')).toBeVisible();
}

function pasteText(page: Page, text: string) {
  return page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt }));
  }, text);
}

test('template picker offers store document types beyond policies', async ({ page }) => {
  await boot(page);
  await page.getByTestId('new-doc').click();
  const grid = page.getByTestId('template-grid');
  await expect(grid).toBeVisible();
  for (const id of ['policy', 'procedure', 'posting', 'agreement', 'memo', 'checklist', 'blank']) {
    await expect(page.getByTestId(`template-${id}`)).toBeVisible();
  }
  await page.getByTestId('template-memo').click();
  const pageEl = page.getByTestId('page-edit');
  await expect(pageEl).toBeVisible();
  await expect(pageEl.getByText('What changed')).toBeVisible();
  await expect(pageEl.getByText('Store Memo')).toBeVisible();
});

test('unnumbered header block renders without a section number', async ({ page }) => {
  await boot(page);
  await openDoc(page, 'Special Orders for Pickup');
  await page.getByTestId('palette-header').click();
  const pageEl = page.getByTestId('page-edit');
  await expect(pageEl.getByText('New header')).toBeVisible();
  await expect(page.getByText('Selected · Header (no number)')).toBeVisible();
});

test('block alignment control centers a paragraph', async ({ page }) => {
  await boot(page);
  await openDoc(page, 'Grill Special Orders');
  const para = page
    .getByTestId('page-edit')
    .locator('.aps-editable')
    .filter({ hasText: 'No grill is promised as in stock' });
  await para.click();
  await page.getByRole('button', { name: 'Center', exact: true }).click();
  await expect
    .poll(async () => para.evaluate((el) => getComputedStyle(el).textAlign))
    .toBe('center');
});

test('find & replace swaps text across the document', async ({ page }) => {
  await boot(page);
  await openDoc(page, 'STIHL Special Order Inquiries');
  await page.keyboard.press('Control+f');
  const bar = page.getByTestId('find-bar');
  await expect(bar).toBeVisible();
  await page.getByTestId('find-input').fill('folder');
  await expect(page.getByTestId('find-count')).toHaveText('1 of 1');
  await page.getByTestId('replace-input').fill('binder');
  await page.getByTestId('replace-all').click();
  await expect(page.getByTestId('page-edit').getByText('binder behind the register')).toBeVisible();
  await expect(page.getByTestId('find-count')).toHaveText('No matches');
});

test('pasting plain text with nothing focused becomes blocks', async ({ page }) => {
  await boot(page);
  await openDoc(page, 'Grill Special Orders');
  await pasteText(page, 'SAFETY FIRST:\n- glove up\n- goggles on\n1. lift with your legs');
  const pageEl = page.getByTestId('page-edit');
  await expect(pageEl.getByText('SAFETY FIRST')).toBeVisible();
  await expect(pageEl.getByText('glove up')).toBeVisible();
  await expect(pageEl.getByText('lift with your legs')).toBeVisible();
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved', { timeout: 5_000 });
});

test('a selected block copies to the clipboard and pastes back', async ({ page }) => {
  await boot(page);
  await openDoc(page, 'Special Orders for Pickup');
  const pageEl = page.getByTestId('page-edit');
  await page.getByTestId('palette-callout').click();
  const before = await pageEl.getByTestId('block').count();

  // The palette insert leaves the new callout selected; copy it.
  await page.keyboard.press('Control+c');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('ace-document-studio/block');

  await pasteText(page, clip);
  await expect(pageEl.getByTestId('block')).toHaveCount(before + 1);
});

test('table inspector inserts rows and columns at the focused cell', async ({ page }) => {
  await boot(page);
  await openDoc(page, 'Special Orders for Pickup');
  await page.getByTestId('palette-table').click();
  const table = page.getByTestId('page-edit').locator('table').first();
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await table.locator('tbody td').first().click();
  await page.getByTestId('row-below').click();
  await expect(table.locator('tbody tr')).toHaveCount(3);
  await page.getByTestId('col-right').click();
  await expect(table.locator('thead th')).toHaveCount(3);
  await page.getByTestId('col-delete').click();
  await expect(table.locator('thead th')).toHaveCount(2);
});

test('outline panel lists sections and jumps to one', async ({ page }) => {
  await boot(page);
  await openDoc(page, 'STIHL Special Order Inquiries');
  const outline = page.getByTestId('outline');
  await expect(outline).toBeVisible();
  await outline.getByText('Filing & Follow-Up').click();
  await expect(
    page.getByTestId('page-edit').locator('.aps-block.sel').filter({ hasText: 'Filing & Follow-Up' }),
  ).toHaveCount(1);
});

test('deleting a document offers undo from the status bar', async ({ page }) => {
  await boot(page);
  const card = page.getByTestId('library-card').filter({ hasText: 'Grill Special Orders' });
  await card.hover();
  await card.getByLabel('Delete document').click();
  await expect(page.getByTestId('library-card')).toHaveCount(2);
  const undo = page.getByTestId('status-action');
  await expect(undo).toHaveText('Undo');
  await undo.click();
  await expect(page.getByTestId('library-card')).toHaveCount(3);
  await expect(page.getByText('Grill Special Orders').first()).toBeVisible();
});

test('documents rename right on the library card', async ({ page }) => {
  await boot(page);
  const card = page.getByTestId('library-card').filter({ hasText: 'Special Orders for Pickup' });
  await card.hover();
  await card.getByLabel('Rename document').click();
  const input = page.getByTestId('rename-input');
  await input.fill('Pickup Orders 2.0');
  await input.press('Enter');
  await expect(page.getByText('Pickup Orders 2.0').first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('Pickup Orders 2.0').first()).toBeVisible();
});

test('library search matches text deep inside documents', async ({ page }) => {
  await boot(page);
  // "promised" appears only in the grill policy's intro paragraph.
  await page.getByTestId('library-search').fill('promised');
  await expect(page.getByTestId('library-card')).toHaveCount(1);
  await expect(page.getByText('Grill Special Orders').first()).toBeVisible();
});

test('version history keeps a restorable snapshot', async ({ page }) => {
  await boot(page);
  await openDoc(page, 'STIHL Special Order Inquiries');
  const para = page
    .getByTestId('page-edit')
    .locator('.aps-editable')
    .filter({ hasText: 'Write a STIHL inquiry whenever' });
  await para.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' XYZZY-MARKER.');
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved', { timeout: 5_000 });

  await page.getByTestId('history-btn').click();
  await expect(page.getByTestId('history-list').locator('button').first()).toBeVisible();
  await page.getByTestId('history-restore').click();
  await expect(page.getByTestId('page-edit').getByText('XYZZY-MARKER')).toHaveCount(0);
});

test('save as template shows up in the new-document picker', async ({ page }) => {
  await boot(page);
  await openDoc(page, 'Grill Special Orders');
  await page.getByTestId('save-template-btn').click();
  await page.getByTestId('template-name').fill('Grill Base');
  await page.getByTestId('template-save').click();
  await page.getByTestId('back-to-library').click();
  await expect(page.getByTestId('library-card')).toHaveCount(3);
  await page.getByTestId('new-doc').click();
  await expect(page.getByText('Your saved templates')).toBeVisible();
  await expect(page.getByLabel('New document from Grill Base')).toBeVisible();
});

test('compile selection bar tracks chosen documents', async ({ page }) => {
  await boot(page);
  await page.getByTestId('compile-btn').click();
  await expect(page.getByTestId('compile-bar')).toBeVisible();
  await page.getByTestId('library-card').first().click();
  await expect(page.getByTestId('compile-bar')).toContainText('1 selected');
  await page.getByTestId('compile-continue').click();
  await expect(page.getByTestId('compile-title')).toBeVisible();
  await expect(page.getByTestId('compile-order')).toBeVisible();
});

test('compile route renders a cover, contents and every document', async ({ page }) => {
  await boot(page); // seeds the library first
  await page.addInitScript(() => {
    window.print = () => {};
    window.history.back = () => {};
  });
  await page.goto('/#/compile/starter-grill,starter-stihl?title=Test%20Manual&toc=1');
  await expect(page.getByTestId('compile-cover')).toBeVisible();
  await expect(page.getByTestId('compile-cover')).toContainText('Test Manual');
  const toc = page.getByTestId('compile-toc');
  await expect(toc).toContainText('Grill Special Orders');
  await expect(toc).toContainText('STIHL Special Order Inquiries');
  await expect(page.getByTestId('page-print')).toHaveCount(2);
});

test('the title section drags below a block via Alt+ArrowUp', async ({ page }) => {
  await boot(page);
  await openDoc(page, 'Grill Special Orders');
  const items = page
    .getByTestId('page-edit')
    .locator('[data-testid="block"], [data-testid="doc-header-item"]');
  await expect(items.first()).toHaveAttribute('data-testid', 'doc-header-item');

  // Select the first content block without focusing its text (the section
  // number is not editable), then walk it above the title header.
  await page.getByTestId('block').first().click({ position: { x: 8, y: 8 } });
  await page.keyboard.press('Alt+ArrowUp');
  await expect(items.first()).toHaveAttribute('data-testid', 'block');
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved', { timeout: 5_000 });

  // And back down again.
  await page.keyboard.press('Alt+ArrowDown');
  await expect(items.first()).toHaveAttribute('data-testid', 'doc-header-item');
});
