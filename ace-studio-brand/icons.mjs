/**
 * Ace Studio family icon generator — one red gradient tile, a different
 * white subject card per app (see README.md for the design spec).
 *
 * Usage: node ace-studio-brand/icons.mjs [sign|document ...]
 * Writes straight into each app's icon locations + previews/ here.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BRAND = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(BRAND, "..");

// Resolve a playwright from anywhere in the repo — bare specifiers only
// resolve from ace-studio-brand/, so also try each app's own install
// (@playwright/test exports chromium too).
let chromium;
for (const candidate of [
  "playwright",
  "playwright-core",
  "@playwright/test",
  path.join(REPO, "ace-sign-studio/e2e/node_modules/playwright/index.mjs"),
  path.join(REPO, "ace-document-studio/node_modules/@playwright/test/index.mjs"),
  path.join(REPO, "ace-document-studio/node_modules/playwright-core/index.mjs"),
  path.join(REPO, "ace-bay-studio/node_modules/@playwright/test/index.mjs"),
  path.join(REPO, "ace-bay-studio/node_modules/playwright-core/index.mjs"),
]) {
  try { ({ chromium } = await import(candidate)); break; } catch {}
}
if (!chromium) {
  console.error("No playwright found — run `npm install` in ace-sign-studio/e2e or ace-document-studio first.");
  process.exit(1);
}

const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const EXECUTABLE =
  process.env.CHROMIUM_PATH ||
  (existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

const robotoBlack = readFileSync(path.join(REPO, "ace-sign-studio/web/fonts/Roboto-Black.ttf")).toString("base64");

/* The shared tile — identical for every family member. */
const TILE_CSS = `
  html,body{margin:0;padding:0;background:transparent}
  @font-face{font-family:'RB';src:url(data:font/ttf;base64,${robotoBlack}) format('truetype')}
  .wrap{width:100vw;height:100vh;box-sizing:border-box;border-radius:19%;
    background:linear-gradient(150deg,#D40029 0%,#C00026 55%,#9E0620 100%);
    display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}
  .sheen{position:absolute;left:-20%;top:-45%;width:140%;height:70%;
    background:rgba(255,255,255,.07);transform:rotate(-14deg);border-radius:50%}
`;

const APPS = {
  sign: {
    name: "Ace Sign Studio",
    html: `<!doctype html><html><head><style>${TILE_CSS}
      .card{position:relative;width:76%;height:56%;background:#fff;border-radius:6%;
        display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6%}
      .chip{background:#15181D;color:#fff;font-family:'RB';font-size:9.5vh;line-height:1;
        letter-spacing:.06em;padding:2.2vh 3.4vh;border-radius:1.2vh}
      .price{font-family:'RB';color:#D40029;font-size:24vh;line-height:.9;display:flex;align-items:flex-start}
      .price sup{font-size:.45em;line-height:1;margin-top:.09em}
    </style></head><body><div class="wrap"><div class="sheen"></div>
      <div class="card"><div class="chip">SALE</div><div class="price">$9<sup>99</sup></div></div>
    </div></body></html>`,
    out: [
      { file: "ace-sign-studio/winres/icon.png", size: 256 },
      { file: "ace-sign-studio/web/img/appicon_256.png", size: 256 },
    ],
  },
  document: {
    name: "Ace Document Studio",
    html: `<!doctype html><html><head><style>${TILE_CSS}
      .sheet{position:relative;width:56%;height:74%;background:#fff;border-radius:6%;overflow:hidden}
      .bar{position:absolute;top:0;left:0;right:0;height:9%;background:#D40029}
      .title{position:absolute;top:17%;left:11%;width:64%;height:8%;background:#15181D;border-radius:4px}
      .sub{position:absolute;top:29.5%;left:11%;width:42%;height:4.5%;background:#D40029;border-radius:3px}
      .b{position:absolute;left:11%;width:8%;aspect-ratio:1;background:#D40029}
      .l{position:absolute;left:24%;width:60%;height:4.5%;background:#BCBEC0;border-radius:3px}
      .r1{top:45%}.r2{top:58%}.r3{top:71%}
      .l1{top:45.8%}.l2{top:58.8%}.l3{top:71.8%}
    </style></head><body><div class="wrap"><div class="sheen"></div>
      <div class="sheet"><div class="bar"></div><div class="title"></div><div class="sub"></div>
        <div class="b r1"></div><div class="l l1"></div>
        <div class="b r2"></div><div class="l l2"></div>
        <div class="b r3"></div><div class="l l3"></div>
      </div></div></body></html>`,
    out: [
      { file: "ace-document-studio/build/icon.png", size: 512 },
      { file: "ace-document-studio/build/icon.ico", ico: [16, 24, 32, 48, 64, 128, 256] },
    ],
  },
  bay: {
    name: "Ace Bay Studio",
    html: `<!doctype html><html><head><style>${TILE_CSS}
      .card{position:relative;width:76%;height:60%;background:#fff;border-radius:6%;
        display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(3,1fr);
        gap:4.5%;padding:7%;box-sizing:border-box}
      .bin{border-radius:14%;background:#BCBEC0}
      .bin.red{background:#D40029}
      .bin.ink{background:#15181D}
    </style></head><body><div class="wrap"><div class="sheen"></div>
      <div class="card">
        <div class="bin red"></div><div class="bin"></div><div class="bin"></div><div class="bin ink"></div>
        <div class="bin"></div><div class="bin red"></div><div class="bin"></div><div class="bin"></div>
        <div class="bin"></div><div class="bin"></div><div class="bin red"></div><div class="bin"></div>
      </div></div></body></html>`,
    out: [
      { file: "ace-bay-studio/build/icon.png", size: 512 },
      { file: "ace-bay-studio/build/icon.ico", ico: [16, 24, 32, 48, 64, 128, 256] },
    ],
  },
};

/* .ico container with PNG-compressed entries (Windows Vista+). */
function pngIco(entries) {
  const header = Buffer.alloc(6 + 16 * entries.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  const bufs = [header];
  entries.forEach(({ size, buf }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);  // planes
    header.writeUInt16LE(32, e + 6); // bpp
    header.writeUInt32LE(buf.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += buf.length;
    bufs.push(buf);
  });
  return Buffer.concat(bufs);
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(APPS);
const browser = await chromium.launch({
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
  headless: true,
  args: ["--no-sandbox", "--force-color-profile=srgb"],
});

mkdirSync(path.join(BRAND, "previews"), { recursive: true });
for (const key of wanted) {
  const app = APPS[key];
  if (!app) { console.error(`Unknown app "${key}" — options: ${Object.keys(APPS).join(", ")}`); process.exit(1); }
  const sizes = new Set([512]);
  for (const o of app.out) (o.ico || [o.size]).forEach((s) => sizes.add(s));
  const shots = {};
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(app.html);
    await page.evaluate(() => document.fonts.ready);
    shots[size] = await page.screenshot({ omitBackground: true });
    await page.close();
  }
  for (const o of app.out) {
    const dest = path.join(REPO, o.file);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, o.ico ? pngIco(o.ico.map((s) => ({ size: s, buf: shots[s] }))) : shots[o.size]);
    console.log(`✓ ${o.file}`);
  }
  writeFileSync(path.join(BRAND, "previews", `${key}-512.png`), shots[512]);
  console.log(`✓ ace-studio-brand/previews/${key}-512.png`);
}
await browser.close();
