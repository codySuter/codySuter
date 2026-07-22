// Boots the real Electron app (built renderer), checks the library
// seeds, then renders a starter doc through the hidden print route and
// runs printToPDF with the production settings. Run under xvfb on CI.
import { _electron } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const app = await _electron.launch({ args: ['.', '--no-sandbox'] });
const win = await app.firstWindow();
await win.waitForSelector('[data-testid="library-card"]', { timeout: 20000 });
const cards = await win.locator('[data-testid="library-card"]').count();
const isElectron = await win.evaluate(() => window.aps?.isElectron === true);
console.log(`library cards: ${cards}, preload bridge: ${isElectron}`);
if (cards < 3 || !isElectron) {
  console.error('SMOKE FAIL: expected 3 seeded docs and the aps bridge');
  await app.close();
  process.exit(1);
}

await mkdir('test-results', { recursive: true });
await win.screenshot({ path: 'test-results/electron-library.png' });

const pdf = await app.evaluate(async ({ BrowserWindow }) => {
  const path = require('node:path');
  const w = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(process.cwd(), 'electron', 'preload.cjs') },
  });
  await w.loadFile(path.join(process.cwd(), 'dist', 'index.html'), {
    hash: '/print/starter-grill',
  });
  await new Promise((r) => setTimeout(r, 3000));
  const buf = await w.webContents.printToPDF({
    pageSize: 'Letter',
    printBackground: true,
    margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
  });
  w.destroy();
  return buf.toString('base64');
});
const bytes = Buffer.from(pdf, 'base64');
await writeFile('test-results/grill-policy.pdf', bytes);
const header = bytes.subarray(0, 5).toString();
console.log(`printToPDF: ${bytes.length} bytes, header ${header}`);
await app.close();
if (header !== '%PDF-' || bytes.length < 10000) {
  console.error('SMOKE FAIL: PDF looks wrong');
  process.exit(1);
}
console.log('ELECTRON SMOKE OK');
