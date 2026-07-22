/* ============================================================
   STIHL shelf sign renderer — faithful vector port of the SignShop
   5×3in sign (two-column: main info + "Other Configurations" side
   panel). Base design space is 480×288 px (5×3in @96dpi); any output
   size keeps the 5:3 aspect and scales every metric by f = W/480.

   STIHL design tokens: orange #EF7A1A, ink #191919, side bg #F4F4F4.
   Fonts: Barlow / Barlow Condensed / Barlow Semi Condensed italics.
   ============================================================ */
"use strict";

const STIHL_ORANGE = "#EF7A1A";
const STIHL_INK = "#191919";

function stihlText(x, y, text, family, size, fill, opts) {
  const o = opts || {};
  const anchor = o.anchor || "start";
  const ls = o.ls ? ` letter-spacing="${o.ls}"` : "";
  const style = o.italic ? ` font-style="italic"` : "";
  return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="${family}" font-size="${size.toFixed(2)}" fill="${fill}" text-anchor="${anchor}"${ls}${style}>${esc(text)}</text>`;
}

/* Renders the STIHL sign. spec = cfg from stihlCurrent(). */
async function renderStihlSign(spec, W_in, H_in) {
  const W = W_in * PPI, H = H_in * PPI;
  const f = W / 480; // scale factor from the 480×288 design space
  const px = (v) => v * f;

  let m = `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`;
  // outer hairline (the app showed 1px outline; keep a light cut edge)
  m += `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="rgba(0,0,0,0.14)" stroke-width="1"/>`;

  const sideW = W * 0.36;
  const mainW = W - sideW;
  m += `<rect x="${mainW}" y="0" width="${sideW}" height="${H}" fill="#F4F4F4"/>`;

  /* ---------- main column ---------- */
  const padL = px(15), padR = px(14), padT = px(13), padB = px(11);
  const innerW = mainW - padL - padR;
  let y = padT;

  // top row: logo box left, category right
  const logoSize = px(15.5);
  const logoPadX = px(7), logoPadTop = px(3.5), logoPadBot = px(4.5);
  const logoText = "STIHL";
  const logoTW = textWidth(logoText, "BarlowSemiCondensedExtraBoldItalic", logoSize);
  const supSize = px(5);
  const logoW = logoPadX + logoTW + px(2) + supSize * 0.9 + logoPadX * 0.6;
  const logoH = logoPadTop + logoSize + logoPadBot;
  m += roundRect(padL, y, logoW, logoH, px(2), STIHL_ORANGE);
  m += stihlText(padL + logoPadX, y + logoPadTop + logoSize * 0.82, logoText, "BarlowSemiCondensedExtraBoldItalic", logoSize, "#fff", { italic: true });
  m += stihlText(padL + logoPadX + logoTW + px(1.5), y + logoPadTop + supSize, "®", "BarlowMedium", supSize, "#fff");
  const catSize = px(8.5);
  m += stihlText(mainW - padR, y + logoH / 2 + catSize * 0.36, String(spec.category || "").toUpperCase(), "BarlowSemiBold", catSize, "#8E8E8E", { anchor: "end", ls: px(2.2).toFixed(2) });
  y += logoH + px(9);

  // model line
  const modelSize = px(26);
  let mx = padL;
  const m1 = String(spec.model1 || "");
  const m2 = String(spec.model2 || "");
  let msz = modelSize;
  const wOf = (sz) =>
    textWidth(m1, "BarlowSemiCondensedExtraBoldItalic", sz) +
    (m2 ? px(6) + textWidth(m2, "BarlowSemiCondensedExtraBoldItalic", sz) : 0);
  if (wOf(msz) > innerW) msz *= innerW / wOf(msz);
  m += stihlText(mx, y + msz * 0.82, m1, "BarlowSemiCondensedExtraBoldItalic", msz, STIHL_INK, { italic: true });
  if (m2) {
    m += stihlText(mx + textWidth(m1, "BarlowSemiCondensedExtraBoldItalic", msz) + px(6), y + msz * 0.82, m2, "BarlowSemiCondensedExtraBoldItalic", msz, STIHL_ORANGE, { italic: true });
  }
  y += msz + px(6);

  // configured-on-floor row
  if (spec.config) {
    const lblSize = px(7.5);
    const lbl = "MODEL CONFIGURED ON FLOOR";
    m += stihlText(padL, y + lblSize * 0.82, lbl, "BarlowSemiBold", lblSize, "#8E8E8E", { ls: px(1.5).toFixed(2) });
    const lblW = textWidth(lbl, "BarlowSemiBold", lblSize) + px(1.5) * lbl.length * 0 + px(1.8) * (lbl.length - 1) * 0.85; // approx incl. letterspacing
    const pillSize = px(8);
    const pillText = String(spec.config).toUpperCase();
    const ptW = textWidth(pillText, "BarlowCondensedBold", pillSize);
    const pillX = padL + lblW + px(7);
    m += roundRect(pillX, y - px(1.5), ptW + px(14), pillSize + px(5.5), px(2), STIHL_INK);
    m += stihlText(pillX + px(7), y - px(1.5) + px(2.5) + pillSize * 0.82, pillText, "BarlowCondensedBold", pillSize, "#fff");
    y += Math.max(lblSize, pillSize + px(4)) + px(7);
  } else {
    y += px(4);
  }

  // price
  const mp = moneyParts(spec.price);
  const dSize = px(56), curSize = px(26), cSize = px(22);
  const curW = textWidth("$", "BarlowSemiCondensedExtraBoldItalic", curSize);
  const dW = textWidth(mp.d, "BarlowSemiCondensedExtraBoldItalic", dSize);
  const priceTop = y;
  m += stihlText(padL, priceTop + px(5) + curSize * 0.82, "$", "BarlowSemiCondensedExtraBoldItalic", curSize, STIHL_ORANGE, { italic: true });
  m += stihlText(padL + curW + px(1), priceTop + dSize * 0.8, mp.d, "BarlowSemiCondensedExtraBoldItalic", dSize, STIHL_ORANGE, { italic: true });
  if (mp.c) {
    m += stihlText(padL + curW + px(3) + dW, priceTop + px(6) + cSize * 0.82, mp.c, "BarlowSemiCondensedExtraBoldItalic", cSize, STIHL_ORANGE, { italic: true });
  }
  y += dSize * 0.86 + px(8);

  // spec header + 2×2 grid
  if (spec.specTitle) {
    const shSize = px(8.5);
    m += stihlText(padL, y + shSize * 0.82, String(spec.specTitle).toUpperCase(), "BarlowBold", shSize, STIHL_ORANGE, { ls: px(1.9).toFixed(2) });
    y += shSize + px(4);
  }
  const specs = (spec.specs || []).slice(0, 4);
  if (specs.length) {
    const gridH = px(52);
    const cellW = innerW / 2;
    const cellH = gridH / 2;
    m += roundRect(padL, y, innerW, gridH, px(3), "#FBFBFB", "#E9E9E9", 1);
    m += `<line x1="${(padL + cellW).toFixed(2)}" y1="${y.toFixed(2)}" x2="${(padL + cellW).toFixed(2)}" y2="${(y + gridH).toFixed(2)}" stroke="#E9E9E9" stroke-width="1"/>`;
    m += `<line x1="${padL.toFixed(2)}" y1="${(y + cellH).toFixed(2)}" x2="${(padL + innerW).toFixed(2)}" y2="${(y + cellH).toFixed(2)}" stroke="#E9E9E9" stroke-width="1"/>`;
    const slSize = px(6.8), svSize = px(12.5);
    for (let i = 0; i < specs.length; i++) {
      const col = i % 2, row = Math.floor(i / 2);
      const cxx = padL + col * cellW + px(8);
      const cyy = y + row * cellH + px(6);
      const [label, value] = specs[i];
      m += stihlText(cxx, cyy + slSize * 0.85, String(label || " ").toUpperCase(), "BarlowSemiBold", slSize, "#9C9C9C", { ls: px(1.4).toFixed(2) });
      let vsz = svSize;
      const vtxt = String(value || "—");
      if (textWidth(vtxt, "BarlowCondensedBold", vsz) > cellW - px(16)) {
        vsz *= (cellW - px(16)) / textWidth(vtxt, "BarlowCondensedBold", vsz);
      }
      m += stihlText(cxx, cyy + slSize + px(2.5) + vsz * 0.82, vtxt, "BarlowCondensedBold", vsz, STIHL_INK);
    }
    y += gridH;
  }

  // bottom row: barcode + sku pinned to bottom
  const bcW = px(118), bcH = px(30);
  const botY = H - padB - bcH - px(10);
  const bc = barcodeRects(spec.upc, padL, botY, bcW, bcH, STIHL_INK);
  if (bc) {
    m += bc.rects;
    const upcSize = px(7.5);
    // spread the human-readable digits across the barcode width
    m += stihlText(padL, botY + bcH + px(3) + upcSize * 0.8, bc.text, "BarlowMedium", upcSize, STIHL_INK, { ls: px(1).toFixed(2) });
  } else {
    m += roundRect(padL, botY, bcW, bcH, px(2), "#fff", "#CCCCCC", 1);
    m += `<line x1="${padL}" y1="${botY + bcH / 2}" x2="${padL + bcW}" y2="${botY + bcH / 2}" stroke="none"/>`;
    m += stihlText(padL + bcW / 2, botY + bcH / 2 + px(3), "NO UPC ON FILE", "BarlowSemiBold", px(7), "#9C9C9C", { anchor: "middle" });
  }
  const skuLblSize = px(7.5), skuValSize = px(12);
  const skuX = padL + bcW + px(14);
  m += stihlText(skuX, botY + skuLblSize * 0.85 + px(1), "STORE SKU", "BarlowSemiBold", skuLblSize, "#8E8E8E", { ls: px(1.9).toFixed(2) });
  const skuTxt = spec.sku || "—";
  const skuW = textWidth(skuTxt, "BarlowCondensedBold", skuValSize) + px(20);
  m += roundRect(skuX, botY + skuLblSize + px(4), Math.min(skuW, mainW - skuX - padR), skuValSize + px(6.5), px(3), "#fff", "#DCDCDC", 1);
  m += stihlText(skuX + px(10), botY + skuLblSize + px(4) + px(3) + skuValSize * 0.8, skuTxt, "BarlowCondensedBold", skuValSize, STIHL_INK);

  /* ---------- side column ---------- */
  const sPadX = px(13), sPadT = px(12);
  let sy = sPadT;
  const sx = mainW + sPadX;
  const sInnerW = sideW - 2 * sPadX;
  const shSize = px(9);
  m += stihlText(sx, sy + shSize * 0.82, "OTHER CONFIGURATIONS", "BarlowBold", shSize, STIHL_ORANGE, { ls: px(1.3).toFixed(2) });
  sy += shSize + px(3);
  const noteSize = px(7.5);
  m += stihlText(sx, sy + noteSize * 0.82, "Options listed may not be in stock", "BarlowMedium", noteSize, "#ABABAB");
  sy += noteSize + px(6);

  const items = (spec.side || []).filter((s) => s.include);
  const isSaw = !!spec.isSaw;
  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    if (sy > H - px(20)) break;
    const nameSize = px(11.5), priceSize = px(12.5);
    // name + price on one line
    let nsz = nameSize;
    const pmp = moneyParts(it.price);
    const priceStr = "$" + pmp.d;
    const priceW = textWidth(priceStr, "BarlowSemiCondensedExtraBoldItalic", priceSize) +
      (pmp.c ? textWidth(pmp.c, "BarlowSemiCondensedExtraBoldItalic", px(8)) + px(1) : 0);
    const nAvail = sInnerW - priceW - px(6);
    if (textWidth(it.label || "", "BarlowCondensedBold", nsz) > nAvail) {
      nsz *= nAvail / Math.max(1, textWidth(it.label || "", "BarlowCondensedBold", nsz));
    }
    m += stihlText(sx, sy + nameSize * 0.82, it.label || "", "BarlowCondensedBold", Math.max(px(7.5), nsz), STIHL_INK);
    let pxx = mainW + sideW - sPadX - priceW;
    m += stihlText(pxx, sy + priceSize * 0.8, priceStr, "BarlowSemiCondensedExtraBoldItalic", priceSize, STIHL_ORANGE, { italic: true });
    if (pmp.c) {
      m += stihlText(pxx + textWidth(priceStr, "BarlowSemiCondensedExtraBoldItalic", priceSize) + px(1), sy + px(8) * 0.9, pmp.c, "BarlowSemiCondensedExtraBoldItalic", px(8), STIHL_ORANGE, { italic: true });
    }
    sy += nameSize + px(3);
    // detail rows
    const rows = [["SKU", it.sku || "—"]];
    if (isSaw) {
      rows.push(["CHAIN PART #", it.chain || "—"]);
      rows.push(["BAR PART #", it.bar || "—"]);
    } else {
      if (it.chain) rows.push(["PART #", it.chain]);
      if (it.bar) rows.push(["PART #", it.bar]);
    }
    const rlSize = px(6.5), rvSize = px(9);
    for (const [rl, rv] of rows) {
      m += stihlText(sx, sy + rvSize * 0.8, rl, "BarlowSemiBold", rlSize, "#9C9C9C", { ls: px(1.2).toFixed(2) });
      m += stihlText(mainW + sideW - sPadX, sy + rvSize * 0.8, rv, "BarlowCondensedSemiBold", rvSize, STIHL_INK, { anchor: "end" });
      sy += rvSize + px(2.5);
    }
    sy += px(3);
    if (idx < items.length - 1) {
      m += `<line x1="${sx}" y1="${sy.toFixed(2)}" x2="${(mainW + sideW - sPadX).toFixed(2)}" y2="${sy.toFixed(2)}" stroke="#DDDDDD" stroke-width="1"/>`;
      sy += px(5);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${m}</svg>`;
}
