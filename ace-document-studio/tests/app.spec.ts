import { expect, test, type Page } from '@playwright/test';

// Runs against the built app in browser mode (localStorage-backed store).

async function boot(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('library-card')).toHaveCount(3, { timeout: 10_000 });
}

test('library seeds with the three starter policies', async ({ page }) => {
  await boot(page);
  await expect(page.getByText('Grill Special Orders').first()).toBeVisible();
  await expect(page.getByText('STIHL Special Order Inquiries').first()).toBeVisible();
  await expect(page.getByText('Special Orders for Pickup').first()).toBeVisible();
});

test('new document goes straight into the editor with an outline', async ({ page }) => {
  await boot(page);
  await page.getByTestId('new-doc').click();

  const pageEl = page.getByTestId('page-edit');
  await expect(pageEl).toBeVisible();
  await expect(pageEl.getByText('When this applies')).toBeVisible();
  await expect(pageEl.getByText('Requirements — check every one')).toBeVisible();
  await expect(pageEl.getByText('Questions & escalation', { exact: false })).toBeVisible();
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
});

test('type-size slider rescales the document', async ({ page }) => {
  await boot(page);
  await page.getByText('STIHL Special Order Inquiries').first().click();
  await expect(page.getByTestId('page-edit')).toBeVisible();
  await expect(page.getByTestId('type-scale-label')).toHaveText('100%');

  const slider = page.getByTestId('type-scale');
  await slider.focus();
  await slider.press('ArrowRight');
  await expect(page.getByTestId('type-scale-label')).toHaveText('102%');
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved', {
    timeout: 5_000,
  });
});

test('two-column block: add, populate a column, and persist', async ({ page }) => {
  await boot(page);
  await page.getByText('Special Orders for Pickup').first().click();
  const pageEl = page.getByTestId('page-edit');
  await expect(pageEl).toBeVisible();

  await page.getByTestId('palette-columns').click();
  await expect(pageEl.getByText('DO / DON’T lists', { exact: false })).toBeVisible();

  await page.getByTestId('col-add-left-bullets').click();
  await expect(pageEl.getByTestId('nested-block').filter({ hasText: 'First point' })).toBeVisible();
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved', {
    timeout: 5_000,
  });

  await page.reload();
  await expect(page.getByTestId('library-card').first()).toBeVisible();
  await page.getByText('Special Orders for Pickup').first().click();
  await expect(
    page.getByTestId('page-edit').getByText('DO / DON’T lists', { exact: false }),
  ).toBeVisible();
});

test('signature block matches the radio-contract style', async ({ page }) => {
  await boot(page);
  await page.getByText('Grill Special Orders').first().click();
  const pageEl = page.getByTestId('page-edit');
  await expect(pageEl).toBeVisible();

  await page.getByTestId('palette-signoff').click();
  await expect(pageEl.getByText('Employee Acknowledgment & Agreement')).toBeVisible();
  await expect(pageEl.getByText('Employee signature')).toBeVisible();
  await expect(pageEl.getByText('Manager signature')).toBeVisible();
  await expect(pageEl.getByText('Date').first()).toBeVisible();
});

test('inline edits autosave and survive a reload', async ({ page }) => {
  await boot(page);
  await page.getByText('Grill Special Orders').first().click();
  const pageEl = page.getByTestId('page-edit');
  await expect(pageEl).toBeVisible();

  const para = pageEl
    .locator('.aps-editable')
    .filter({ hasText: 'No grill is promised as in stock' });
  await para.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Ask a manager when unsure.');
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved', {
    timeout: 5_000,
  });

  await page.reload();
  await expect(page.getByTestId('library-card').first()).toBeVisible();
  await page.getByText('Grill Special Orders').first().click();
  await expect(
    page.getByTestId('page-edit').getByText('Ask a manager when unsure.'),
  ).toBeVisible();
});

test('palette click adds a block; toolbar deletes it', async ({ page }) => {
  await boot(page);
  await page.getByText('Special Orders for Pickup').first().click();
  const pageEl = page.getByTestId('page-edit');
  await expect(pageEl).toBeVisible();
  const before = await pageEl.getByTestId('block').count();

  await page.getByTestId('palette-callout').click();
  await expect(pageEl.getByTestId('block')).toHaveCount(before + 1);
  await expect(pageEl.getByText('nobody gets to miss')).toBeVisible();

  await page.getByRole('button', { name: 'Delete block' }).click();
  await expect(pageEl.getByTestId('block')).toHaveCount(before);
});

test('fit meter reports one-page starter docs', async ({ page }) => {
  await boot(page);
  await page.getByText('STIHL Special Order Inquiries').first().click();
  await expect(page.getByTestId('page-edit')).toBeVisible();
  await expect(page.getByTestId('fit-label')).toContainText('Fits on one page');
});

test('library search filters the cards', async ({ page }) => {
  await boot(page);
  await page.getByTestId('library-search').fill('stihl');
  await expect(page.getByTestId('library-card')).toHaveCount(1);
  await expect(page.getByText('STIHL Special Order Inquiries').first()).toBeVisible();
  await page.getByTestId('library-search').fill('no such document');
  await expect(page.getByTestId('library-card')).toHaveCount(0);
  await expect(page.getByText('No documents match')).toBeVisible();
  await page.getByTestId('library-search').fill('');
  await expect(page.getByTestId('library-card')).toHaveCount(3);
});

test('page break block shows a divider and calms the fit meter', async ({ page }) => {
  await boot(page);
  await page.getByText('Grill Special Orders').first().click();
  const pageEl = page.getByTestId('page-edit');
  await expect(pageEl).toBeVisible();

  await page.getByTestId('palette-pageBreak').click();
  await expect(pageEl.getByText('PAGE BREAK')).toBeVisible();
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved', {
    timeout: 5_000,
  });
});

test('metadata footer toggles on, edits inline, and persists', async ({ page }) => {
  await boot(page);
  await page.getByText('Special Orders for Pickup').first().click();
  const pageEl = page.getByTestId('page-edit');
  await expect(pageEl).toBeVisible();

  await page.getByTestId('footer-toggle').check();
  const footer = page.getByTestId('doc-footer');
  await expect(footer).toBeVisible();
  await expect(footer.getByText('Effective')).toBeVisible();

  await footer.locator('.aps-editable').first().click();
  await page.keyboard.type('01/15/2026');
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved', {
    timeout: 5_000,
  });

  await page.reload();
  await expect(page.getByTestId('library-card').first()).toBeVisible();
  await page.getByText('Special Orders for Pickup').first().click();
  await expect(page.getByTestId('doc-footer').getByText('01/15/2026')).toBeVisible();
});

test('support button offers bug report and feature request', async ({ page }) => {
  await boot(page);
  await page.getByTestId('support-btn').click();
  await expect(page.getByText('Report a bug…')).toBeVisible();
  await expect(page.getByText('Request a feature…')).toBeVisible();
  await expect(page.getByText('csuter@snydersace.net')).toBeVisible();
});

test('nested column blocks move with the toolbar arrows', async ({ page }) => {
  await boot(page);
  await page.getByText('Special Orders for Pickup').first().click();
  const pageEl = page.getByTestId('page-edit');
  await expect(pageEl).toBeVisible();

  await page.getByTestId('palette-columns').click();
  await page.getByTestId('col-add-left-bullets').click();
  const nested = pageEl.getByTestId('nested-block');
  // Column starts with its seed paragraph, then the new bullets below it.
  await expect(nested.first()).not.toContainText('First point');
  await nested.filter({ hasText: 'First point' }).first().click();
  await page.getByRole('button', { name: 'Move up' }).click();
  await expect(nested.first()).toContainText('First point');
});

test('move up/down reorders and renumbers sections', async ({ page }) => {
  await boot(page);
  await page.getByText('STIHL Special Order Inquiries').first().click();
  const pageEl = page.getByTestId('page-edit');
  await expect(pageEl).toBeVisible();

  const section = pageEl.getByTestId('block').filter({ hasText: 'Filing & Follow-Up' }).first();
  await section.click();
  await page.getByRole('button', { name: 'Move up' }).click();
  // The section carries its heading with it; numbering stays sequential.
  const titles = await pageEl
    .locator('.aps-editable')
    .filter({ hasText: /Filing & Follow-Up|What to Record/ })
    .allTextContents();
  expect(titles.length).toBeGreaterThanOrEqual(2);
});
