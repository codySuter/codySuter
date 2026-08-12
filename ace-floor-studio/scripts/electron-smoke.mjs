// Boots the real Electron app (built renderer), checks the floor plan
// renders every fixture and that the preload bridge + JSON persistence
// round-trip works. Runs against a throwaway userData dir so it can
// never touch a real floor.json.
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron } from '@playwright/test';

const userData = await mkdtemp(path.join(tmpdir(), 'afs-smoke-'));
const app = await _electron.launch({
  args: ['.', '--no-sandbox'],
  env: { ...process.env, AFS_USER_DATA: userData },
});
const win = await app.firstWindow();
await win.waitForSelector('[data-testid="fixture"]', { timeout: 20000 });

const fixtures = await win.locator('[data-testid="fixture"]').count();
const isElectron = await win.evaluate(() => window.afs?.isElectron === true);
console.log(`fixtures: ${fixtures}, preload bridge: ${isElectron}`);
if (fixtures !== 340 || !isElectron) {
  console.error('SMOKE FAIL: expected 340 plan fixtures and the afs bridge');
  await app.close();
  process.exit(1);
}

// The renderer writes the seed doc right after boot — give it a beat.
await win.waitForTimeout(800);

// Persistence round-trip through the main process (floor.json on disk).
const roundtrip = await win.evaluate(async () => {
  const doc = await window.afs.loadDoc();
  if (!doc || doc.version !== 1) return 'no doc on disk';
  doc.settings.metricId = 'skuCount';
  await window.afs.saveDoc(doc);
  const back = await window.afs.loadDoc();
  return back?.settings?.metricId === 'skuCount' ? 'ok' : 'setting lost';
});
console.log(`persistence round-trip: ${roundtrip}`);

await mkdir('test-results', { recursive: true });
await win.screenshot({ path: 'test-results/electron-floormap.png' });
await app.close();

if (roundtrip !== 'ok') {
  console.error('SMOKE FAIL: floor.json round-trip failed');
  process.exit(1);
}
console.log('ELECTRON SMOKE OK');
