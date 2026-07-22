// Generates build/icon.png (512) and build/icon.ico (multi-size) —
// a policy-document mark in the Ace design language.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import pngToIco from 'png-to-ico';

const html = `<!doctype html><html><head><style>
  html,body{margin:0;padding:0;background:transparent}
  .wrap{width:100vw;height:100vh;background:#C8102E;border-radius:19%;
    display:flex;align-items:center;justify-content:center;box-sizing:border-box}
  .sheet{position:relative;width:58%;height:74%;background:#fff;border-radius:6%;
    overflow:hidden}
  .bar{position:absolute;top:0;left:0;right:0;height:9%;background:#C8102E}
  .title{position:absolute;top:17%;left:11%;width:64%;height:8%;background:#15181D;border-radius:4px}
  .sub{position:absolute;top:29.5%;left:11%;width:42%;height:4.5%;background:#C8102E;border-radius:3px}
  .b{position:absolute;left:11%;width:8%;aspect-ratio:1;background:#C8102E}
  .l{position:absolute;left:24%;width:60%;height:4.5%;background:#BCBEC0;border-radius:3px}
  .r1{top:45%}.r2{top:58%}.r3{top:71%}
  .l1{top:45.8%}.l2{top:58.8%}.l3{top:71.8%}
</style></head><body>
  <div class="wrap"><div class="sheet">
    <div class="bar"></div><div class="title"></div><div class="sub"></div>
    <div class="b r1"></div><div class="l l1"></div>
    <div class="b r2"></div><div class="l l2"></div>
    <div class="b r3"></div><div class="l l3"></div>
  </div></div>
</body></html>`;

const exe = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const sizes = [16, 24, 32, 48, 64, 128, 256];
const buffers = {};
for (const size of [...sizes, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(html);
  buffers[size] = await page.screenshot({ omitBackground: true });
  await page.close();
}
await browser.close();

await mkdir('build', { recursive: true });
await writeFile('build/icon.png', buffers[512]);
await writeFile('build/icon.ico', await pngToIco(sizes.map((s) => buffers[s])));
console.log('Wrote build/icon.png and build/icon.ico');
