import { test } from '@playwright/test';

// On-demand screenshot capture: SCREENS=1 npx playwright test tests/screens.spec.ts
const OUT = process.env.SCREENS_DIR || 'test-results/screens';

test.skip(!process.env.SCREENS, 'screenshots only on demand');

test('capture app screens', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('library-card').first().waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/1-library.png` });

  await page.getByText('Grill Special Orders').first().click();
  await page.getByTestId('page-edit').waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/2-editor.png` });

  await page.getByTestId('block').nth(2).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/3-editor-selected.png` });

  await page.getByTestId('back-to-library').click();
  await page.getByTestId('new-doc').click();
  await page.getByTestId('page-edit').waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/4-new-document.png` });

  await page.goto('/#/print/starter-stihl');
  await page.getByTestId('page-print').waitFor();
  await page.waitForTimeout(700);
  await page.getByTestId('page-print').screenshot({ path: `${OUT}/5-stihl-document.png` });
});
