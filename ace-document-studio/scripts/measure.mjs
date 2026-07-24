import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
await page.goto('http://localhost:4173/');
await page.waitForSelector('[data-testid="library-card"]');
for (const title of ['Grill Special Orders', 'STIHL Special Order Inquiries', 'Special Orders for Pickup']) {
  await page.getByText(title).first().click();
  await page.waitForSelector('[data-testid="page-edit"]');
  await page.waitForTimeout(400);
  const h = await page.evaluate(() => document.querySelector('[data-testid="page-edit"] > div').offsetHeight);
  console.log(`${title}: ${h}px of 979.2 printable ${h <= 979.2 ? '— FITS' : '— OVER'}`);
  await page.getByTestId('back-to-library').click();
  await page.waitForSelector('[data-testid="library-card"]');
}
await browser.close();
