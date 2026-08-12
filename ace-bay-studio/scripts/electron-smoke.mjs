// Boots the real Electron app (built renderer), checks the default bay
// map seeds and that the preload bridge + JSON persistence round-trip.
import { mkdir } from 'node:fs/promises';
import { _electron } from '@playwright/test';

const app = await _electron.launch({ args: ['.', '--no-sandbox'] });
const win = await app.firstWindow();
await win.waitForSelector('[data-testid="bin"]', { timeout: 20000 });

const bins = await win.locator('[data-testid="bin"]').count();
const isElectron = await win.evaluate(() => window.abs?.isElectron === true);
console.log(`bins: ${bins}, preload bridge: ${isElectron}`);
if (bins !== 192 || !isElectron) {
  console.error('SMOKE FAIL: expected 192 seeded bins and the abs bridge');
  await app.close();
  process.exit(1);
}

// The renderer writes the seed map right after boot — give it a beat.
await win.waitForTimeout(800);

// Persistence round-trip through the main process (map.json on disk).
const roundtrip = await win.evaluate(async () => {
  const map = await window.abs.loadMap();
  if (!map || !Array.isArray(map.aisles)) return 'no map on disk';
  map.aisles[0].banks[0].shelves[0][0].label = 'SMOKE-82';
  await window.abs.saveMap(map);
  const back = await window.abs.loadMap();
  return back?.aisles?.[0]?.banks?.[0]?.shelves?.[0]?.[0]?.label === 'SMOKE-82' ? 'ok' : 'label lost';
});
console.log(`persistence round-trip: ${roundtrip}`);

await mkdir('test-results', { recursive: true });
await win.screenshot({ path: 'test-results/electron-baymap.png' });
await app.close();

if (roundtrip !== 'ok') {
  console.error('SMOKE FAIL: map.json round-trip failed');
  process.exit(1);
}
console.log('ELECTRON SMOKE OK');
