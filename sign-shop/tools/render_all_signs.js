#!/usr/bin/env node
/* Render every product's sign to a PNG, organized into per-category folders.
 * Uses the app's own render pipeline (the #sign element + html2canvas) driven
 * headless, so the output matches the in-app "Save PNG" export exactly:
 * 1500x900 px = 5x3in at 300 DPI, from the current data/products.js.
 *
 *   node tools/render_all_signs.js [outputDir]
 *
 * Default output: dist/signs-png/  (git-ignored — regenerate any time).
 * Requires Playwright + the bundled Chromium (already set up in this repo's
 * dev environment). One PNG per model, at its default floor configuration.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP = 'file://' + path.join(ROOT, 'index.html');
const OUT = process.argv[2] || path.join(ROOT, 'dist', 'signs-png');
const EXE = process.env.CHROMIUM || '/opt/pw-browsers/chromium';

const sanitize = s => s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();

(async () => {
  const raw = fs.readFileSync(path.join(ROOT, 'data', 'products.js'), 'utf8');
  const models = JSON.parse(raw.match(/= ([\s\S]*);/)[1]).models;

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });

  let ok = 0;
  const fail = [];
  const used = {};
  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    const label = m.model + (m.nickname ? ' ' + m.nickname : '');
    try {
      // A hash-only URL change won't re-run the deep-link boot code, so reload.
      await page.goto(APP + '#model=' + encodeURIComponent(m.id));
      await page.reload();
      await page.waitForFunction(() => {
        const s = document.querySelector('#sign');
        return s && !s.querySelector('.sign-empty') && s.children.length > 0;
      }, { timeout: 8000 });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

      // Capture an off-screen clone at natural size (matches the app's export).
      const dataUrl = await page.evaluate(async () => {
        const sign = document.querySelector('#sign');
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;left:-10000px;top:0';
        const clone = sign.cloneNode(true);
        host.appendChild(clone);
        document.body.appendChild(host);
        const canvas = await html2canvas(clone, {
          scale: 300 / 96, backgroundColor: '#ffffff', useCORS: true, logging: false
        });
        host.remove();
        return canvas.toDataURL('image/png');
      });

      const dir = path.join(OUT, sanitize(m.categoryName));
      fs.mkdirSync(dir, { recursive: true });
      let base = sanitize(label);
      used[dir] = used[dir] || {};
      if (used[dir][base] === undefined) used[dir][base] = 0;
      else base += ' (' + (++used[dir][base]) + ')';
      fs.writeFileSync(path.join(dir, base + '.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
      ok++;
      if (ok % 25 === 0) console.log('  ...' + ok + '/' + models.length);
    } catch (e) {
      fail.push(label + ': ' + e.message.split('\n')[0]);
    }
  }
  await browser.close();
  console.log('Done: ' + ok + '/' + models.length + ' signs -> ' + OUT);
  if (fail.length) console.log('Failures (' + fail.length + '):\n' + fail.join('\n'));
})();
