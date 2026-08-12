/* ============================================================
   Ace sign renderers.

   Every renderer draws into an SVG sized W×H inches at 96 px/in and
   follows the official Ace price point formats (brand guidelines
   pp. 72–74): black SALE chips, red price blocks with superscript
   cents, red circles, ACE REWARDS EXCLUSIVE badges, BOGO stacks.

   The same SVG is used for the on-screen preview, the queue thumbnails,
   the sheet composer, and (via svg2pdf) the exported/printed PDF, so
   what you see is exactly what prints.
   ============================================================ */
"use strict";

const PPI = 96;
const ACE_RED = "#D40029";
const INK = "#000000";
const GRAY11 = "#6D6E71";
const GRAY5 = "#BCBEC0";

/* Roboto Black vertical metrics, measured from the TTF (em fractions above
   the baseline): digits top out at 0.721 em, the "$" glyph at 0.823 em.
   The brand price format hangs the superscript $ and cents from the same
   top line as the big dollar digits — eyeballed offsets drift as soon as
   the glyph sizes differ, so compute the baseline from these. */
const DIGIT_TOP_EM = 0.721;
const DOLLAR_TOP_EM = 0.823;

/* Baseline y for a superscript glyph (its own size `glyphSize`, top of ink
   at `glyphTopEm`) so its top aligns with the top of size-S dollar digits
   sitting on baseline `base`. */
function supBaseline(base, S, glyphSize, glyphTopEm) {
  return base - (DIGIT_TOP_EM * S - glyphTopEm * glyphSize);
}

/* ---------- element size sliders ----------
   spec.scale = {logo, image, name, price, detail, footer} — factors from
   the editor's "Element sizes" sliders, 1 = the automatic layout. The
   layout treats them as preferences and re-balances: when a boosted
   element no longer fits, every flexible element shrinks proportionally,
   so nothing can overlap a neighbor or run off the sign. */
const SCALE_MIN = 0.5, SCALE_MAX = 1.6;
function elemScale(spec, key) {
  const v = spec && spec.scale ? parseFloat(spec.scale[key]) : NaN;
  return isNaN(v) ? 1 : Math.min(SCALE_MAX, Math.max(SCALE_MIN, v));
}

/* ---------- low-level svg builders ---------- */

function svgText(x, y, text, family, size, fill, opts) {
  const o = opts || {};
  const anchor = o.anchor || "middle";
  let ls = "";
  if (o.letterSpacing) {
    // Tracked text also gets textLength (the measured width including the
    // tracking): svg2pdf ignores letter-spacing entirely and derives its
    // character spacing from textLength alone, so without this every
    // tracked line prints narrower than the preview (and anything
    // positioned off its width — like Final Sale's asterisk — drifts).
    // Browsers honor textLength too, so preview and PDF stay identical.
    const lsPx = parseFloat(o.letterSpacing) || 0;
    const str = String(text);
    const tl = textWidth(str, family, size) + lsPx * Math.max(0, str.length - 1);
    ls = ` letter-spacing="${o.letterSpacing}" textLength="${tl.toFixed(2)}"`;
  }
  return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="${family}" font-size="${size.toFixed(2)}" fill="${fill}" text-anchor="${anchor}"${ls}>${esc(text)}</text>`;
}

function roundRect(x, y, w, h, r, fill, stroke, sw) {
  return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="${r}" ry="${r}" fill="${fill || "none"}"${stroke ? ` stroke="${stroke}" stroke-width="${sw || 1}"` : ""}/>`;
}

/* ---------- shared sign chrome ---------- */

function signFrame(W, H) {
  // Page-scale signs print as a dedicated sheet with no packing margin, so
  // their frame must clear the printer's ≈0.25" non-printable edge on its
  // own — 0.028·816px = 0.238" leaves the whole border in the dead zone.
  // Smaller signs sit inside the sheet's 0.375" packing margin and keep the
  // proportional look.
  let m = Math.max(10, Math.min(W, H) * 0.028);
  if (Math.min(W, H) >= 800) m = Math.max(27, m);
  const r = Math.min(W, H) > 500 ? 8 : 6;
  return {
    margin: m,
    markup:
      `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>` +
      roundRect(m, m, W - 2 * m, H - 2 * m, r, "none", GRAY5, Math.max(1.1, Math.min(W, H) / 340)),
  };
}

function datePill(rightX, topY, text, fontSize) {
  if (!text) return { markup: "", h: 0 };
  const padX = fontSize * 0.55, padY = fontSize * 0.32;
  const tw = textWidth(text, "RobotoBold", fontSize);
  const w = tw + 2 * padX, h = fontSize + 2 * padY;
  const x = rightX - w;
  return {
    markup:
      roundRect(x, topY, w, h, h * 0.28, ACE_RED) +
      svgText(x + w / 2, topY + h / 2 + fontSize * 0.35, text, "RobotoBold", fontSize, "#fff"),
    h,
  };
}

/* Header: Ace logo top-left + optional red date pill top-right.
   Returns content-top y. Logo natural aspect ≈ 1.856. The logo can be
   toggled off (spec.showLogo === false); the layout reflows. */
function signHeader(W, H, frame, logoURI, datesText, small, noLogo, logoScale) {
  const m = frame.margin;
  const pad = Math.max(8, Math.min(W, H) * 0.022);
  // slider-scaled, but never taller than a quarter of the sign nor wider
  // than ~55% of it — the date pill keeps its top-right corner
  let logoH = Math.max(22, Math.min(H * (small ? 0.15 : 0.115), 92)) * (logoScale || 1);
  logoH = Math.max(16, Math.min(logoH, H * 0.25, ((W - 2 * (m + pad)) * 0.55) / 1.856));
  const logoW = logoH * 1.856;
  let markup = "";
  if (!noLogo) {
    // the data-elem group is the editor's drag-to-resize handle
    markup += `<g data-elem="logo">`;
    if (logoURI) {
      markup += `<image x="${(m + pad).toFixed(2)}" y="${(m + pad).toFixed(2)}" width="${logoW.toFixed(2)}" height="${logoH.toFixed(2)}" preserveAspectRatio="xMinYMin meet" href="${logoURI}"/>`;
    } else {
      markup += svgText(m + pad, m + pad + logoH * 0.82, "ACE", "RobotoBlack", logoH * 0.9, ACE_RED, { anchor: "start" });
    }
    markup += `</g>`;
  }
  const pillSize = Math.max(9, Math.min(16, H * 0.024));
  const pill = datePill(W - m - pad, m + pad, datesText, pillSize);
  markup += pill.markup;
  const headH = noLogo ? (datesText ? pill.h : 0) : logoH;
  return { markup, contentTop: m + pad + headH + Math.max(6, H * 0.012) };
}

/* Brand red price block: [pre]$ DD ⁰⁰ [suffix under cents].
   opts: {pre:"2/", suffixWord:"each", offWord:false} — returns {markup,w,h}. */
function priceBlockMarkup(cx, top, price, targetH, maxW, opts) {
  const o = opts || {};
  const mp = moneyParts(price);
  let S = targetH / 1.32; // dollars font size from block height
  const compute = (s) => {
    const preW = o.pre ? textWidth(o.pre, "RobotoBlack", s * 0.62) : 0;
    const curW = textWidth("$", "RobotoBlack", s * 0.55);
    const dW = textWidth(mp.d, "RobotoBlack", s);
    const cW = mp.c ? textWidth(mp.c, "RobotoBlack", s * 0.45) : 0;
    const sufW = o.suffixWord ? Math.max(cW, textWidth(o.suffixWord, "RobotoBold", s * 0.17)) : cW;
    const padX = s * 0.22;
    const inner = preW + curW + dW + Math.max(cW, sufW) + s * 0.06;
    return { w: inner + 2 * padX, padX, preW, curW, dW, cW };
  };
  let mtr = compute(S);
  if (mtr.w > maxW) { S *= maxW / mtr.w; mtr = compute(S); }
  const blockH = S * 1.32;
  const x = cx - mtr.w / 2;
  const baseline = top + blockH * 0.5 + S * 0.36;
  let m = roundRect(x, top, mtr.w, blockH, 0, ACE_RED);
  let cur = x + mtr.padX;
  if (o.pre) {
    m += svgText(cur, baseline, o.pre, "RobotoBlack", S * 0.62, "#fff", { anchor: "start" });
    cur += mtr.preW;
  }
  m += svgText(cur, supBaseline(baseline, S, S * 0.55, DOLLAR_TOP_EM), "$", "RobotoBlack", S * 0.55, "#fff", { anchor: "start" });
  cur += mtr.curW;
  m += svgText(cur, baseline, mp.d, "RobotoBlack", S, "#fff", { anchor: "start" });
  cur += mtr.dW + S * 0.06;
  if (mp.c) {
    m += svgText(cur, supBaseline(baseline, S, S * 0.45, DIGIT_TOP_EM), mp.c, "RobotoBlack", S * 0.45, "#fff", { anchor: "start" });
  }
  if (o.suffixWord) {
    m += svgText(cur, top + blockH - S * 0.18, o.suffixWord, "RobotoBold", S * 0.17, "#fff", { anchor: "start" });
  }
  return { markup: m, w: mtr.w, h: blockH };
}

/* Black chip with white text (SALE / REG. $x.xx). */
function blackChip(cx, top, text, fontSize) {
  const padX = fontSize * 0.5, padY = fontSize * 0.26;
  const tw = textWidth(text, "RobotoBlack", fontSize);
  const w = tw + 2 * padX, h = fontSize + 2 * padY;
  return {
    markup:
      roundRect(cx - w / 2, top, w, h, 0, INK) +
      svgText(cx, top + h / 2 + fontSize * 0.35, text, "RobotoBlack", fontSize, "#fff"),
    w, h,
  };
}

function rewardsLine(cx, y, size) {
  return svgText(cx, y, "ACE REWARDS EXCLUSIVE*", "RobotoBold", size, ACE_RED, { letterSpacing: (size * 0.08).toFixed(2) });
}

/* Product image centered in a zone, preserving aspect. */
function imageMarkup(dataURI, natural, cx, top, maxW, maxH) {
  if (!dataURI || maxH <= 8) return { markup: "", h: 0 };
  const scale = Math.min(maxW / natural.w, maxH / natural.h);
  const w = natural.w * scale, h = natural.h * scale;
  return {
    markup: `<g data-elem="image"><image x="${(cx - w / 2).toFixed(2)}" y="${(top + (maxH - h) / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" href="${dataURI}"/></g>`,
    h: maxH,
  };
}

/* Name block: up to 2 balanced lines, RobotoBold. Returns markup + height. */
function nameBlock(cx, top, name, maxW, targetSize, minSize) {
  if (!name) return { markup: "", h: 0 };
  const fit = balancedLines(name, "RobotoBold", targetSize, maxW, 2);
  const size = Math.max(minSize || 9, fit.size);
  const lineGap = size * 0.16;
  let markup = `<g data-elem="name">`;
  let y = top + size * 0.85;
  for (const line of fit.lines) {
    markup += svgText(cx, y, line, "RobotoBold", size, INK);
    y += size + lineGap;
  }
  return { markup: markup + `</g>`, h: fit.lines.length * (size + lineGap) };
}

/* The product-page URL a sign's QR code points at: the canonical URL the
   lookup captured, else an acehardware.com search for the SKU. */
function qrURLFor(spec) {
  if (!spec || !spec.qr) return null;
  if (spec.productUrl) return spec.productUrl;
  const sku = String(spec.sku || "").trim();
  return /^\d{4,9}$/.test(sku) ? `https://www.acehardware.com/search?query=${sku}` : null;
}

function skuFooter(W, H, frame, sku, detail, storeLine, barcode, scale, qrURL) {
  const f = scale || 1;
  const m = frame.margin;
  const cx = W / 2;
  let markup = `<g data-elem="footer">`;
  const skuSize = Math.max(7, Math.min(Math.max(8.5, Math.min(15, H * 0.023)) * f, H * 0.04));
  const bottomPad = Math.max(6, H * 0.014);
  let y = H - m - bottomPad;

  // QR code bottom-right; skipped on shelf sizes — below ~0.45" a phone
  // can't reliably scan it, and it would crowd the footer out
  let qrSize = 0;
  if (qrURL && Math.min(W, H) >= 326 && typeof qrRects === "function") {
    const qs = Math.max(42, Math.min(Math.min(78, H * 0.085) * Math.min(f, 1.25), H * 0.12));
    const qx = W - m - 6 - qs, qy = H - m - 6 - qs;
    const qr = qrRects(qrURL, qx, qy, qs, INK);
    if (qr) {
      markup += qr.rects;
      qrSize = qs;
    }
  }
  // centered footer lines must stay clear of the QR corner (symmetric so
  // the centering holds)
  const centerAvail = W - 2 * (m + 10) - (qrSize ? 2 * (qrSize + 8) : 0);

  if (storeLine) {
    const s = skuSize * 0.72;
    markup += svgText(cx, y, storeLine, "RobotoMedium", Math.min(s, fitTextSize(storeLine, "RobotoMedium", s, centerAvail)), GRAY5);
    y -= s * 1.45;
  }
  if (sku) {
    let drewBars = false;
    // only a real 4–9 digit item number becomes a barcode — a pasted URL
    // or search phrase in the SKU field must not print as scannable noise
    if (barcode && /^\d{4,9}$/.test(String(sku)) && typeof code128Rects === "function") {
      const bcH = Math.min(H * 0.07, Math.max(12, Math.max(15, Math.min(30, H * 0.045)) * f));
      // width grows gently with the slider — bar spacing stays scannable
      const bw = Math.min(W * 0.5, Math.max(112, W * 0.24) * (0.6 + 0.4 * f));
      const dsize = skuSize * 0.95;
      const barsTop = y - dsize * 1.05 - bcH;
      const bc = code128Rects(sku, cx - bw / 2, barsTop, bw, bcH, INK);
      if (bc) {
        markup += svgText(cx, y, String(sku), "RobotoMedium", dsize, GRAY11, { letterSpacing: (dsize * 0.22).toFixed(2) });
        markup += bc.rects;
        y = barsTop - skuSize * 0.5;
        drewBars = true;
      }
    }
    if (!drewBars) {
      markup += svgText(cx, y, `SKU: ${sku}`, "RobotoMedium", skuSize, GRAY11);
      y -= skuSize * 1.5;
    }
  }
  if (detail) {
    const ds = Math.min(skuSize * 0.92, fitTextSize(detail, "RobotoMedium", skuSize * 0.92, centerAvail));
    markup += svgText(cx, y, detail, "RobotoMedium", ds, GRAY11);
    y -= skuSize * 1.4;
  }
  // the QR sits beside the footer stack, not in it — reserve enough for
  // whichever is taller so content above never runs into the QR corner
  const reserved = Math.max((H - m) - y, qrSize ? qrSize + 12 + bottomPad : 0);
  return { markup: markup + `</g>`, reserved };
}

/* ---------- generic product-sign template ----------
   Layout: frame → header → [image] → name(+detail) → PRICE AREA → sku footer.
   priceArea(cx, top, availW, availH) → {markup, h}. */
async function productSignTemplate(spec, Win, Hin, priceAreaFrac, priceArea, opts) {
  const W = Win * PPI, H = Hin * PPI;
  const o = opts || {};
  const frame = signFrame(W, H);
  const noLogo = spec.showLogo === false;
  const logoURI = noLogo ? null : await getLogoURI();
  const dates = formatSaleDates(spec.startDate, spec.endDate);
  const small = Math.min(Win, Hin) <= 5.6;
  const header = signHeader(W, H, frame, logoURI, dates, small, noLogo, elemScale(spec, "logo"));
  const footer = skuFooter(W, H, frame, spec.sku, spec.detail, spec.storeLine, spec.barcode, elemScale(spec, "footer"), qrURLFor(spec));
  // arrowCol reserves a column on one side (for a pointer arrow) and shifts
  // the whole content block — image, name AND price together — to the other
  // side by half that width. Everything keeps one shared centerline, so the
  // three elements stay vertically aligned with each other; the block just
  // sits off-center to clear the arrow.
  const arrowCol = o.arrowCol || 0;
  const cx = W / 2 + (o.arrowSide === "left" ? arrowCol / 2 : o.arrowSide === "right" ? -arrowCol / 2 : 0);
  const maxW = W - 2 * frame.margin - 2 * Math.max(10, W * 0.03) - arrowCol;

  let imgURI = null, imgNat = { w: 1, h: 1 };
  if (spec.image && !o.noImage) {
    try {
      // Re-encode to baseline JPEG so it survives into the PDF (jsPDF can't
      // decode progressive/CMYK JPEG, WebP or AVIF that the browser renders).
      imgURI = await toDataURI(spec.image, "jpeg");
      imgNat = await imageSize(imgURI);
    } catch (e) { imgURI = null; }
  }

  const contentTop = header.contentTop;
  const contentBottom = H - frame.margin - footer.reserved;
  const contentH = contentBottom - contentTop;

  const scImage = elemScale(spec, "image");
  const scName = elemScale(spec, "name");
  const scPrice = elemScale(spec, "price");

  const nameTarget = Math.max(13, H * 0.058);
  const gap = Math.max(5, H * 0.012);
  const probeName = (target) => {
    if (!spec.name) return { size: 0, lines: [], h: 0 };
    const p = balancedLines(spec.name, "RobotoBold", target, maxW, 2);
    p.h = p.lines.length * (Math.max(9, p.size) * 1.16);
    return p;
  };

  // Base allocation (all sliders at 100%): name measured first so the
  // image can absorb leftover space, price area a fixed fraction.
  const priceBase = priceAreaFrac > 0 ? contentH * priceAreaFrac : 0;
  const baseName = probeName(nameTarget);
  const imgBase = imgURI ? Math.max(0, contentH - priceBase - baseName.h - gap * 2.5) : 0;

  // Sliders scale each element's share of the zone; when the boosted total
  // no longer fits, every share shrinks proportionally — a bigger photo
  // squeezes the name and price instead of covering them.
  let priceH = priceBase * scPrice;
  let nameFit = scName === 1 ? baseName : probeName(nameTarget * scName);
  let imgH = imgBase * scImage;
  const room = contentH - gap * 2.5;
  const want = priceH + nameFit.h + imgH;
  if (want > room && want > 0) {
    const k = room / want;
    priceH *= k;
    imgH *= k;
    nameFit = probeName(Math.max(9, nameTarget * scName * k));
  }

  let y = contentTop;
  let markup = frame.markup + header.markup;
  if (imgURI && imgH > 20) {
    const im = imageMarkup(imgURI, imgNat, cx, y, maxW * 0.9, imgH);
    markup += im.markup;
    y += im.h + gap;
  } else if (imgURI) {
    y += gap * 0.5;
  }
  if (spec.name) {
    // with no price area, the name centers in the remaining space
    if (priceAreaFrac === 0 && !imgURI) {
      y += Math.max(0, (contentBottom - y - nameFit.h) / 2);
    }
    const nb = nameBlock(cx, y, spec.name, maxW, nameFit.size);
    markup += nb.markup;
    y += nb.h + gap * 0.6;
  }
  if (priceAreaFrac > 0) {
    // the price area absorbs whatever is left; a shrunk price slider takes
    // a centered share of that instead of stretching back to fill it
    const remaining = Math.max(24, contentBottom - y);
    const availH = scPrice < 1 ? Math.max(24, remaining * scPrice) : remaining;
    const pa = priceArea(cx, y + (remaining - availH) / 2, maxW, availH, spec);
    markup += `<g data-elem="price">${pa.markup}</g>`;
  }
  markup += footer.markup;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${markup}</svg>`;
}

/* Center a stack of parts vertically in the price area. Parts are laid out
   top→bottom; each part fn(top) returns its height. */
function stack(top, availH, partHeights, gapFrac) {
  const gaps = partHeights.length - 1;
  const gap = Math.max(4, availH * (gapFrac == null ? 0.06 : gapFrac));
  const total = partHeights.reduce((a, b) => a + b, 0) + gaps * gap;
  let y = top + Math.max(0, (availH - total) / 2);
  return { start: y, gap };
}

/* Wrap a sign rendered at the CUT dimensions with its laminate cut guide:
   the artwork sits centered on the nominal-size page and a light dashed
   rounded rect marks the cut line (gray #AAAAAA, 0.6pt, dash 4/2 — the
   legacy draw_with_cut_guide style). The body is NOT scaled: it is
   rendered natively at (W−2c)×(H−2c), so typography keeps its proportions
   instead of being squeezed the way the legacy tool did. */
function withCutGuide(svg, Win, Hin, cutIn) {
  const W = Win * PPI, H = Hin * PPI, c = cutIn * PPI;
  const k = PPI / 72; // pt → px
  const body = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="#ffffff"/>` +
    `<g transform="translate(${c.toFixed(2)},${c.toFixed(2)})">${body}</g>` +
    `<rect x="${c.toFixed(2)}" y="${c.toFixed(2)}" width="${(W - 2 * c).toFixed(2)}" height="${(H - 2 * c).toFixed(2)}" rx="${(8 * k).toFixed(2)}" fill="none" stroke="#AAAAAA" stroke-width="${(0.6 * k).toFixed(2)}" stroke-dasharray="${(4 * k).toFixed(2)} ${(2 * k).toFixed(2)}"/>` +
    `</svg>`;
}

/* Render a sign type at a registered size. Every size carries a cut inset
   (1/8" laminate seal all around): the artwork renders at the cut
   dimensions and is wrapped with the dashed cut line on the nominal-size
   page. The single entry point used by previews, thumbnails, sheets, and
   PDFs. */
async function renderSignSVG(typeId, spec, sizeId) {
  const t = typeById(typeId);
  const size = sizeById(sizeId);
  if (!size.cut) return t.render(spec, size.w, size.h);
  const svg = await t.render(spec, size.w - 2 * size.cut, size.h - 2 * size.cut);
  return withCutGuide(svg, size.w, size.h, size.cut);
}

/* ---------- logo ---------- */
let _logoURI = null;
async function getLogoURI() {
  if (_logoURI) return _logoURI;
  try { _logoURI = await toDataURI("img/ace_logo_transparent.png"); }
  catch (e) { _logoURI = null; }
  return _logoURI;
}

/* ---------- price areas per sign type ---------- */

const AceRenderers = {};

/* Regular price — plain red price, superscript cents, optional unit. */
/* The bare red price line used by Regular Price and the arrow signs:
   $ DD ⁰⁰ with an optional unit under the cents, centered in the box. */
function bigPriceMarkup(cx, top, availW, availH, spec) {
  const mp = moneyParts(spec.price);
  let S = Math.min(availH * 0.82, 200);
  // The unit label shares the cents column, so the fit must budget for
  // whichever is wider — a wide unit ("per gallon") otherwise extends
  // past the frame on a width-limited price.
  const measure = (s) =>
    textWidth("$", "RobotoBlack", s * 0.55) + textWidth(mp.d, "RobotoBlack", s) +
    Math.max(
      mp.c ? textWidth(mp.c, "RobotoBlack", s * 0.45) : 0,
      spec.unit ? textWidth(String(spec.unit), "RobotoBold", s * 0.16) : 0
    ) + s * 0.08;
  if (measure(S) > availW) S *= availW / measure(S);
  const w = measure(S);
  const x0 = cx - w / 2;
  const base = top + (availH - S * 1.05) / 2 + S * 0.9;
  let m = svgText(x0, supBaseline(base, S, S * 0.55, DOLLAR_TOP_EM), "$", "RobotoBlack", S * 0.55, ACE_RED, { anchor: "start" });
  let cur = x0 + textWidth("$", "RobotoBlack", S * 0.55);
  m += svgText(cur, base, mp.d, "RobotoBlack", S, ACE_RED, { anchor: "start" });
  cur += textWidth(mp.d, "RobotoBlack", S) + S * 0.08;
  if (mp.c) m += svgText(cur, supBaseline(base, S, S * 0.45, DIGIT_TOP_EM), mp.c, "RobotoBlack", S * 0.45, ACE_RED, { anchor: "start" });
  if (spec.unit) m += svgText(cur, base, spec.unit, "RobotoBold", S * 0.16, GRAY11, { anchor: "start" });
  return m;
}

AceRenderers.regular = (spec, W, H) =>
  productSignTemplate(spec, W, H, String(spec.price || "").trim() ? 0.38 : 0, (cx, top, availW, availH) =>
    ({ markup: bigPriceMarkup(cx, top, availW, availH, spec), h: availH }));

/* Directional price signs — Regular Price plus a large Ace-red block arrow
   pointing at the product (hang or shelf-clip the sign beside, above, or
   below what it prices). */
function blockArrowMarkup(cx, cy, len, breadth, dir) {
  // Drawn pointing up in a len×breadth box centered on the origin, then
  // rotated into place. len runs along the pointing direction.
  const hh = len * 0.45;       // arrowhead length
  const sw = breadth * 0.52;   // shaft width
  const pts = [
    [0, -len / 2], [breadth / 2, -len / 2 + hh], [sw / 2, -len / 2 + hh],
    [sw / 2, len / 2], [-sw / 2, len / 2], [-sw / 2, -len / 2 + hh], [-breadth / 2, -len / 2 + hh],
  ].map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const rot = { up: 0, right: 90, down: 180, left: 270 }[dir] || 0;
  return `<g data-elem="arrow" transform="translate(${cx.toFixed(2)},${cy.toFixed(2)}) rotate(${rot})"><polygon points="${pts}" fill="${ACE_RED}"/></g>`;
}

const arrowSign = (dir) => (spec, Win, Hin) => {
  // Pixel dimensions + frame inset, mirroring signFrame/signHeader, so the
  // arrow can be pinned to the sign's outer border. The price-zone callback
  // only receives pixel coords, so these are closed over.
  const Wpx = Win * PPI, Hpx = Hin * PPI;
  let fm = Math.max(10, Math.min(Wpx, Hpx) * 0.028);
  if (Math.min(Wpx, Hpx) >= 800) fm = Math.max(27, fm);
  const pad = Math.max(8, Math.min(Wpx, Hpx) * 0.022);
  const inset = fm + pad; // distance from the paper edge to content
  const aLen = Math.min(Wpx, Hpx) * 0.24;
  const horizontal = dir === "left" || dir === "right";
  const aBreadth = horizontal ? aLen * 0.72 : Math.min(Wpx * 0.16, aLen * 0.85);
  // Reserve the arrow's column and shift the content to the opposite side.
  // The arrow always sits on the right except when it points left, so the
  // content shifts left in every case but Left.
  const arrowSide = dir === "left" ? "left" : "right";
  const arrowCol = (horizontal ? aLen : aBreadth) + Wpx * 0.03;
  const opts = { arrowSide, arrowCol };
  return productSignTemplate(spec, Win, Hin, String(spec.price || "").trim() ? 0.42 : 0.3, (cx, top, availW, availH) => {
    const m = bigPriceMarkup(cx, top, availW, availH, spec);
    if (horizontal) {
      // vertically centered on the sign; hugs its side frame edge
      const ax = dir === "left" ? inset + aLen / 2 : Wpx - inset - aLen / 2;
      return { markup: m + blockArrowMarkup(ax, Hpx / 2, aLen, aBreadth, dir), h: availH };
    }
    // top-right / bottom-right corner, tip at the top/bottom frame
    const ax = Wpx - inset - aBreadth / 2;
    const ay = dir === "up" ? inset + aLen / 2 : Hpx - inset - aLen / 2;
    return { markup: m + blockArrowMarkup(ax, ay, aLen, aBreadth, dir), h: availH };
  }, opts);
};

AceRenderers.arrow_up = arrowSign("up");
AceRenderers.arrow_down = arrowSign("down");
AceRenderers.arrow_left = arrowSign("left");
AceRenderers.arrow_right = arrowSign("right");

/* Sale — black SALE chip + red block price (+ optional REG chip).
   Price/reg hide independently; the chip is the sign's identity. */
AceRenderers.sale = (spec, W, H) => {
  const hasPrice = !!String(spec.price || "").trim();
  return productSignTemplate(spec, W, H, hasPrice ? 0.46 : 0.26, (cx, top, availW, availH, s) => {
    const chipSize = Math.max(11, availH * (hasPrice ? 0.14 : 0.4));
    const regSize = Math.max(8, availH * 0.1);
    const hasReg = !!String(s.regPrice || "").trim();
    const blockH = availH * (hasReg ? 0.52 : 0.6);
    const parts = [chipSize * 1.52];
    if (hasPrice) parts.push(blockH);
    if (hasReg) parts.push(regSize * 1.52);
    const st = stack(top, availH, parts, 0.05);
    let y = st.start;
    let m = "";
    const chip = blackChip(cx, y, "SALE", chipSize);
    m += chip.markup; y += chip.h + st.gap;
    if (hasPrice) {
      const blk = priceBlockMarkup(cx, y, s.price, blockH, availW, { suffixWord: s.unit ? s.unit.replace(/^\//, "") : "each" });
      m += blk.markup; y += blk.h + st.gap;
    }
    if (hasReg) {
      const reg = blackChip(cx, y, `REG. ${fmtMoney(s.regPrice)}`, regSize);
      m += reg.markup;
    }
    return { markup: m, h: availH };
  });
};

/* Percent off — red block "00% OFF" (optionally "UP TO"). */
AceRenderers.percent_off = (spec, W, H) =>
  productSignTemplate(spec, W, H, 0.44, (cx, top, availW, availH, s) => {
    const pct = String(s.percent || "").trim() ? String(parseInt(s.percent, 10) || 0) : "__";
    let m = "";
    let y = top;
    let blockAvail = availH;
    if (s.upTo) {
      const upSize = Math.max(10, availH * 0.13);
      m += svgText(cx, y + upSize, "UP TO", "RobotoBlack", upSize, INK, { letterSpacing: (upSize * 0.12).toFixed(2) });
      y += upSize * 1.5;
      blockAvail -= upSize * 1.5;
    }
    let S = blockAvail * 0.62;
    const compute = (sz) => {
      const dW = textWidth(pct, "RobotoBlack", sz);
      const pctW = textWidth("%", "RobotoBlack", sz * 0.42);
      const offW = textWidth("OFF", "RobotoBlack", sz * 0.3);
      const padX = sz * 0.2;
      return { w: dW + Math.max(pctW, offW) + sz * 0.08 + padX * 2, dW, padX };
    };
    let mtr = compute(S);
    if (mtr.w > availW) { S *= availW / mtr.w; mtr = compute(S); }
    const bh = S * 1.24;
    const bx = cx - mtr.w / 2;
    const by = y + (blockAvail - bh) / 2;
    m += roundRect(bx, by, mtr.w, bh, 0, ACE_RED);
    const dx = bx + mtr.padX;
    const base = by + bh / 2 + S * 0.36;
    m += svgText(dx, base, pct, "RobotoBlack", S, "#fff", { anchor: "start" });
    const rx = dx + mtr.dW + S * 0.08;
    m += svgText(rx, by + bh * 0.28 + S * 0.42 * 0.36, "%", "RobotoBlack", S * 0.42, "#fff", { anchor: "start" });
    m += svgText(rx, by + bh - S * 0.16, "OFF", "RobotoBlack", S * 0.3, "#fff", { anchor: "start" });
    return { markup: m, h: availH };
  });

/* BOGO free — BUY ONE (ink) GET ONE (red) + giant red FREE. */
AceRenderers.bogo_free = (spec, W, H) =>
  productSignTemplate(spec, W, H, 0.5, (cx, top, availW, availH) => {
    const lineSize = Math.min(availH * 0.17, availW / 7.2);
    const freeH = availH * 0.52;
    const st = stack(top, availH, [lineSize * 1.2, lineSize * 1.2, freeH], 0.045);
    let y = st.start;
    let m = "";
    m += svgText(cx, y + lineSize, "BUY ONE", "RobotoBlack", lineSize, INK, { letterSpacing: "1" });
    y += lineSize * 1.2 + st.gap;
    m += svgText(cx, y + lineSize, "GET ONE", "RobotoBlack", lineSize, ACE_RED, { letterSpacing: "1" });
    y += lineSize * 1.2 + st.gap;
    const fSize = Math.min(freeH, (availW / textWidth("FREE", "RobotoBlack", 100)) * 100);
    m += svgText(cx, y + fSize * 0.86, "FREE", "RobotoBlack", fSize, ACE_RED, { letterSpacing: "2" });
    return { markup: m, h: availH };
  });

/* BOGO percent — BUY ONE / GET ONE + red block "00% OFF". */
AceRenderers.bogo_percent = (spec, W, H) =>
  productSignTemplate(spec, W, H, 0.5, (cx, top, availW, availH, s) => {
    const pct = String(s.percent || "").trim() ? String(parseInt(s.percent, 10) || 0) : "__";
    const lineSize = Math.min(availH * 0.15, availW / 7.5);
    const blockH = availH * 0.5;
    const st = stack(top, availH, [lineSize * 1.2, lineSize * 1.2, blockH], 0.04);
    let y = st.start;
    let m = svgText(cx, y + lineSize, "BUY ONE", "RobotoBlack", lineSize, INK, { letterSpacing: "1" });
    y += lineSize * 1.2 + st.gap;
    m += svgText(cx, y + lineSize, "GET ONE", "RobotoBlack", lineSize, INK, { letterSpacing: "1" });
    y += lineSize * 1.2 + st.gap;
    let S = blockH * 0.6;
    const compute = (sz) => {
      const dW = textWidth(pct + "%", "RobotoBlack", sz);
      const offW = textWidth("OFF", "RobotoBlack", sz * 0.5);
      return { w: dW + sz * 0.18 + offW + sz * 0.4, dW };
    };
    let mtr = compute(S);
    if (mtr.w > availW) { S *= availW / mtr.w; mtr = compute(S); }
    const bh = S * 1.26, bw = mtr.w;
    const bx = cx - bw / 2;
    m += roundRect(bx, y, bw, bh, 0, ACE_RED);
    const base = y + bh / 2 + S * 0.36;
    m += svgText(bx + S * 0.2, base, pct + "%", "RobotoBlack", S, "#fff", { anchor: "start" });
    m += svgText(bx + S * 0.2 + mtr.dW + S * 0.18, base, "OFF", "RobotoBlack", S * 0.5, "#fff", { anchor: "start" });
    return { markup: m, h: availH };
  });

/* 2 For $X — SALE chip + red block "2/$00⁰⁰". */
AceRenderers.two_for = (spec, W, H) =>
  productSignTemplate(spec, W, H, 0.46, (cx, top, availW, availH, s) => {
    const qty = Math.max(2, parseInt(s.qty, 10) || 2);
    const chipSize = Math.max(11, availH * 0.14);
    const blockH = availH * 0.6;
    const st = stack(top, availH, [chipSize * 1.52, blockH], 0.05);
    let y = st.start;
    const chip = blackChip(cx, y, "SALE", chipSize);
    let m = chip.markup;
    y += chip.h + st.gap;
    const blk = priceBlockMarkup(cx, y, s.price, blockH, availW, { pre: `${qty}/` });
    m += blk.markup;
    return { markup: m, h: availH };
  });

/* Instant savings — REWARDS line, SAVE $X INSTANTLY, price block, REG chip.
   The price block and REG chip hide independently. */
AceRenderers.instant_savings = (spec, W, H) =>
  productSignTemplate(spec, W, H, String(spec.price || "").trim() ? 0.55 : 0.4, (cx, top, availW, availH, s) => {
    const hasPrice = !!String(s.price || "").trim();
    const rw = Math.max(9, availH * 0.075);
    const saveSize = Math.max(13, availH * (hasPrice ? 0.15 : 0.24));
    const blockH = availH * 0.4;
    const regSize = Math.max(8, availH * 0.085);
    // The SAVE row is as tall as its red amount block (amtS·1.1 below), not
    // just the SAVE word — budgeting the smaller value pushed the stack's
    // bottom row out of the price area.
    const parts = [rw * 1.4, Math.max(saveSize * 1.35, saveSize * 1.55 * 1.1)];
    if (hasPrice) parts.push(blockH);
    if (s.regPrice) parts.push(regSize * 1.5);
    const st = stack(top, availH, parts, 0.035);
    let y = st.start;
    let m = rewardsLine(cx, y + rw, rw);
    y += rw * 1.4 + st.gap;
    // SAVE $X INSTANTLY — SAVE/INSTANTLY stacked left of red $ block
    // Never round a savings amount: "$7.50 off" printed as "SAVE $8" is a
    // customer-facing overstatement of the offer. Whole dollars stay bare.
    const sv = parseFloat(String(s.savings || "0").replace(/[^0-9.]/g, "")) || 0;
    const amt = String(s.savings || "").trim()
      ? "$" + (Number.isInteger(sv) ? String(sv) : sv.toFixed(2))
      : "$__"; // half-typed sign should look unfinished, not like a $0 offer
    const saveW = Math.max(textWidth("SAVE", "RobotoBlack", saveSize), textWidth("INSTANTLY", "RobotoBlack", saveSize * 0.52));
    const amtS = saveSize * 1.55;
    const amtW = textWidth(amt, "RobotoBlack", amtS) + amtS * 0.36;
    const grpW = saveW + saveSize * 0.3 + amtW;
    const gx = cx - grpW / 2;
    m += svgText(gx + saveW, y + saveSize, "SAVE", "RobotoBlack", saveSize, INK, { anchor: "end" });
    m += svgText(gx + saveW, y + saveSize + saveSize * 0.62, "INSTANTLY", "RobotoBlack", saveSize * 0.52, ACE_RED, { anchor: "end" });
    const abH = amtS * 1.1;
    m += roundRect(gx + saveW + saveSize * 0.3, y, amtW, abH, 0, ACE_RED);
    m += svgText(gx + saveW + saveSize * 0.3 + amtW / 2, y + abH / 2 + amtS * 0.36, amt, "RobotoBlack", amtS, "#fff");
    y += Math.max(saveSize * 1.35, abH) + st.gap;
    if (hasPrice) {
      const blk = priceBlockMarkup(cx, y, s.price, blockH, availW, { suffixWord: "each" });
      m += blk.markup;
      y += blk.h + st.gap;
    }
    if (s.regPrice) {
      m += blackChip(cx, y, `REG. ${fmtMoney(s.regPrice)}`, regSize).markup;
    }
    return { markup: m, h: availH };
  });

/* Was / Now — clearance pricing: THIS UNIT ONLY chip, struck WAS price,
   red block "NOW $00⁰⁰". */
AceRenderers.was_now = (spec, W, H) =>
  productSignTemplate(spec, W, H, 0.5, (cx, top, availW, availH, s) => {
    const showChip = s.unitOnly !== false;
    const chipSize = Math.max(10, availH * 0.115);
    const wasSize = Math.max(11, availH * 0.155);
    const noteSize = Math.max(8.5, availH * 0.072);
    const blockH = availH * (showChip ? 0.42 : 0.5);
    const parts = [];
    if (showChip) parts.push(chipSize * 1.52);
    parts.push(wasSize * 1.3, blockH, noteSize * 1.5);
    const st = stack(top, availH, parts, 0.05);
    let y = st.start;
    let m = "";
    if (showChip) {
      const chip = blackChip(cx, y, "THIS UNIT ONLY", chipSize);
      m += chip.markup;
      y += chip.h + st.gap;
    }
    const wasText = `WAS ${fmtMoney(s.regPrice)}`;
    let wSz = wasSize;
    const wW = () => textWidth(wasText, "RobotoBold", wSz);
    if (wW() > availW * 0.8) wSz *= (availW * 0.8) / wW();
    m += svgText(cx, y + wSz * 0.85, wasText, "RobotoBold", wSz, GRAY11);
    const strikeY = y + wSz * 0.55;
    const strikeW = wW();
    m += `<line x1="${(cx - strikeW / 2 - wSz * 0.12).toFixed(2)}" y1="${strikeY.toFixed(2)}" x2="${(cx + strikeW / 2 + wSz * 0.12).toFixed(2)}" y2="${strikeY.toFixed(2)}" stroke="${ACE_RED}" stroke-width="${Math.max(1.6, wSz * 0.09).toFixed(2)}"/>`;
    y += wSz * 1.3 + st.gap;
    const blk = priceBlockMarkup(cx, y, s.price, blockH, availW, { pre: "NOW " });
    m += blk.markup;
    y += blk.h + st.gap;
    // Clearance terms, same fine-print style as Final Sale's note.
    m += svgText(cx, y + noteSize, "No returns", "RobotoBold", noteSize, GRAY11);
    return { markup: m, h: availH };
  });

/* Final sale — stacked FINAL (ink) / SALE (red) headline with a linked
   asterisk, optional price block, and a small fine-print line
   (default "*No returns"). */
AceRenderers.final_sale = (spec, W, H) => {
  const hasPrice = !!String(spec.price || "").trim();
  return productSignTemplate(spec, W, H, hasPrice ? 0.52 : 0.44, (cx, top, availW, availH, s) => {
    const noteText = String(s.note == null ? "*No returns" : s.note).trim();
    const noteSize = Math.max(8.5, availH * 0.072);
    const noteH = noteText ? noteSize * 1.5 : 0;
    const blockH = hasPrice ? availH * 0.34 : 0;
    const wordAvail = availH - noteH - blockH;
    let wordSize = wordAvail * 0.38;
    const fitW = (t, sz) => textWidth(t, "RobotoBlack", sz) + sz * 0.16 * (t.length - 1);
    for (const word of ["FINAL", "SALE"]) {
      if (fitW(word, wordSize) > availW) wordSize *= availW / fitW(word, wordSize);
    }
    const parts = [wordSize * 1.06, wordSize * 1.06];
    if (hasPrice) parts.push(blockH);
    if (noteText) parts.push(noteH);
    const st = stack(top, availH, parts, 0.03);
    let y = st.start;
    const ls = (wordSize * 0.16).toFixed(2);
    let m = svgText(cx, y + wordSize * 0.88, "FINAL", "RobotoBlack", wordSize, INK, { letterSpacing: ls });
    y += wordSize * 1.06 + st.gap;
    m += svgText(cx, y + wordSize * 0.88, "SALE", "RobotoBlack", wordSize, ACE_RED, { letterSpacing: ls });
    if (noteText) {
      // linked asterisk raised after SALE
      const saleW = fitW("SALE", wordSize);
      m += svgText(cx + saleW / 2 + wordSize * 0.1, y + wordSize * 0.42, "*", "RobotoBlack", wordSize * 0.42, ACE_RED, { anchor: "start" });
    }
    y += wordSize * 1.06 + st.gap;
    if (hasPrice) {
      const blk = priceBlockMarkup(cx, y, s.price, blockH, availW, { suffixWord: "each" });
      m += blk.markup;
      y += blk.h + st.gap;
    }
    if (noteText) {
      m += svgText(cx, y + noteSize, noteText, "RobotoBold", noteSize, GRAY11);
    }
    return { markup: m, h: availH };
  });
};

/* Buy N get $X off — BUY TWO GET + red block "$00 OFF". */
AceRenderers.buy_get_off = (spec, W, H) =>
  productSignTemplate(spec, W, H, 0.48, (cx, top, availW, availH, s) => {
    const qtyWords = { 2: "TWO", 3: "THREE", 4: "FOUR", 5: "FIVE" };
    const q = qtyWords[parseInt(s.qty, 10)] || String(s.qty || "TWO");
    const lineSize = Math.min(availH * 0.16, availW / 8);
    const blockH = availH * 0.56;
    const st = stack(top, availH, [lineSize * 1.25, blockH], 0.05);
    let y = st.start;
    let m = svgText(cx, y + lineSize, `BUY ${q} GET`, "RobotoBlack", lineSize, INK, { letterSpacing: "1" });
    y += lineSize * 1.25 + st.gap;
    // Never round a savings amount: "$7.50 off" printed as "SAVE $8" is a
    // customer-facing overstatement of the offer. Whole dollars stay bare.
    const sv = parseFloat(String(s.savings || "0").replace(/[^0-9.]/g, "")) || 0;
    const amt = String(s.savings || "").trim()
      ? "$" + (Number.isInteger(sv) ? String(sv) : sv.toFixed(2))
      : "$__"; // half-typed sign should look unfinished, not like a $0 offer
    let S = blockH * 0.62;
    const compute = (sz) => {
      const aW = textWidth(amt, "RobotoBlack", sz);
      const offW = textWidth("OFF", "RobotoBlack", sz * 0.36);
      return { w: sz * 0.4 + aW + sz * 0.12 + offW, aW };
    };
    let mtr = compute(S);
    if (mtr.w > availW) { S *= availW / mtr.w; mtr = compute(S); }
    const bh = S * 1.24, bx = cx - mtr.w / 2;
    m += roundRect(bx, y, mtr.w, bh, 0, ACE_RED);
    m += svgText(bx + S * 0.2, y + bh / 2 + S * 0.36, amt, "RobotoBlack", S, "#fff", { anchor: "start" });
    m += svgText(bx + S * 0.2 + mtr.aW + S * 0.12, y + bh * 0.34 + S * 0.36 * 0.36, "OFF", "RobotoBlack", S * 0.36, "#fff", { anchor: "start" });
    return { markup: m, h: availH };
  });

/* Your Choice — YOUR CHOICE red circle "$00" (brand p74). */
AceRenderers.your_choice = (spec, W, H) =>
  productSignTemplate(spec, W, H, 0.52, (cx, top, availW, availH, s) => {
    const r = Math.min(availH / 2, availW / 2) * 0.92;
    const cy = top + availH / 2;
    let m = `<circle cx="${cx}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="${ACE_RED}"/>`;
    const ycSize = r * 0.19;
    m += svgText(cx, cy - r * 0.38, "YOUR", "RobotoBlack", ycSize, "#fff", { letterSpacing: "1" });
    m += svgText(cx, cy - r * 0.38 + ycSize * 1.15, "CHOICE", "RobotoBlack", ycSize, "#fff", { letterSpacing: "1" });
    const mp = moneyParts(s.price);
    const showCents = mp.c && mp.c !== "00";
    const priceStr = "$" + mp.d + (showCents ? "." + mp.c : "");
    const pS = Math.min(r * 0.62, (r * 1.5 / Math.max(1, textWidth(priceStr, "RobotoBlack", 100))) * 100);
    m += svgText(cx, cy + r * 0.42, priceStr, "RobotoBlack", pS, "#fff");
    return { markup: m, h: availH };
  });

/* Category under $X — red circle CATEGORY / UNDER / $00 (no product needed). */
AceRenderers.under_amount = async (spec, W, H) => {
  const merged = Object.assign({}, spec, { image: null, name: "" });
  return productSignTemplate(merged, W, H, 0.9, (cx, top, availW, availH, s) => {
    const r = Math.min(availH / 2, availW / 2) * 0.95;
    const cy = top + availH / 2;
    let m = `<circle cx="${cx}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="${ACE_RED}"/>`;
    const cat = String(s.category || "CATEGORY").toUpperCase();
    const catSize = Math.min(r * 0.17, (r * 1.55 / Math.max(1, textWidth(cat, "RobotoBlack", 100))) * 100);
    m += svgText(cx, cy - r * 0.42, cat, "RobotoBlack", catSize, "#fff", { letterSpacing: "1" });
    m += svgText(cx, cy - r * 0.42 + catSize * 1.3, "UNDER", "RobotoBlack", catSize * 0.9, "#fff", { letterSpacing: "2" });
    const amt = String(s.price || "").trim() ? "$" + String(Math.round(parseFloat(String(s.price).replace(/[^0-9.]/g, "")) || 0)) : "$__";
    const aS = Math.min(r * 0.72, (r * 1.4 / Math.max(1, textWidth(amt, "RobotoBlack", 100))) * 100);
    m += svgText(cx, cy + r * 0.5, amt, "RobotoBlack", aS, "#fff");
    return { markup: m, h: availH };
  }, { noImage: true });
};

/* Large text — the name is the hero; optional price + image below. */
/* Big Text — merged Large Text + Text Only. mode "message" draws a message
   sign (giant text + optional small line, no price/photo); anything else is
   the priced style (giant name + optional price + photo). */
AceRenderers.big_text = (spec, W_in, H_in) =>
  spec.mode === "message"
    ? AceRenderers.text_only(spec, W_in, H_in)
    : AceRenderers.large_text(spec, W_in, H_in);

AceRenderers.large_text = async (spec, W_in, H_in) => {
  const W = W_in * PPI, H = H_in * PPI;
  const frame = signFrame(W, H);
  const noLogo = spec.showLogo === false;
  const logoURI = noLogo ? null : await getLogoURI();
  const dates = formatSaleDates(spec.startDate, spec.endDate);
  const header = signHeader(W, H, frame, logoURI, dates, Math.min(W_in, H_in) <= 5.6, noLogo, elemScale(spec, "logo"));
  const footer = skuFooter(W, H, frame, spec.sku, spec.detail, spec.storeLine, spec.barcode, elemScale(spec, "footer"), qrURLFor(spec));
  const cx = W / 2;
  const maxW = W - 2 * frame.margin - 2 * Math.max(10, W * 0.03);
  let markup = frame.markup + header.markup + footer.markup;

  let imgURI = null, imgNat = { w: 1, h: 1 };
  if (spec.image) {
    try { imgURI = await toDataURI(spec.image, "jpeg"); imgNat = await imageSize(imgURI); } catch (e) {}
  }
  const contentTop = header.contentTop;
  const contentBottom = H - frame.margin - footer.reserved;
  const contentH = contentBottom - contentTop;
  const hasPrice = !!spec.price;
  // sliders re-balance the three zones, but the name stays the hero:
  // price + photo together may never take more than 2/3 of the space
  let priceH = hasPrice ? contentH * 0.3 * elemScale(spec, "price") : 0;
  let imgH = imgURI ? contentH * 0.3 * elemScale(spec, "image") : 0;
  const over = (priceH + imgH) / (contentH * 0.66);
  if (over > 1) { priceH /= over; imgH /= over; }
  const nameH = contentH - priceH - imgH;

  const fit = balancedLines(spec.name || "", "RobotoBlack", nameH * (spec.name && spec.name.length < 14 ? 0.62 : 0.5) * elemScale(spec, "name"), maxW, 2);
  let lineGap = fit.size * 0.14;
  let totalNameH = fit.lines.length * (fit.size + lineGap);
  if (totalNameH > nameH) {
    // a boosted name may not spill into the photo/price zones below
    const k = nameH / totalNameH;
    fit.size *= k;
    lineGap *= k;
    totalNameH = nameH;
  }
  let y = contentTop + Math.max(0, (nameH - totalNameH) / 2) + fit.size * 0.9;
  markup += `<g data-elem="name">`;
  for (const line of fit.lines) {
    markup += svgText(cx, y, line, "RobotoBlack", fit.size, INK);
    y += fit.size + lineGap;
  }
  markup += `</g>`;
  y = contentTop + nameH;
  if (imgURI) {
    const im = imageMarkup(imgURI, imgNat, cx, y, maxW * 0.8, imgH * 0.94);
    markup += im.markup;
    y += imgH;
  }
  if (hasPrice) {
    const mp = moneyParts(spec.price);
    let S = priceH * 0.72;
    const wOf = (s) =>
      textWidth("$", "RobotoBlack", s * 0.55) + textWidth(mp.d, "RobotoBlack", s) +
      (mp.c ? textWidth(mp.c, "RobotoBlack", s * 0.45) : 0) + s * 0.08;
    if (wOf(S) > maxW) S *= maxW / wOf(S);
    const w = wOf(S);
    const x0 = cx - w / 2;
    const base = y + priceH / 2 + S * 0.33;
    markup += `<g data-elem="price">`;
    markup += svgText(x0, supBaseline(base, S, S * 0.55, DOLLAR_TOP_EM), "$", "RobotoBlack", S * 0.55, ACE_RED, { anchor: "start" });
    let cur = x0 + textWidth("$", "RobotoBlack", S * 0.55);
    markup += svgText(cur, base, mp.d, "RobotoBlack", S, ACE_RED, { anchor: "start" });
    cur += textWidth(mp.d, "RobotoBlack", S) + S * 0.08;
    if (mp.c) markup += svgText(cur, supBaseline(base, S, S * 0.45, DIGIT_TOP_EM), mp.c, "RobotoBlack", S * 0.45, ACE_RED, { anchor: "start" });
    markup += `</g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${markup}</svg>`;
};

/* Text only — message as large as possible, optional subtext. */
AceRenderers.text_only = async (spec, W_in, H_in) => {
  const W = W_in * PPI, H = H_in * PPI;
  const frame = signFrame(W, H);
  const noLogo = spec.showLogo === false;
  const logoURI = noLogo ? null : await getLogoURI();
  const dates = formatSaleDates(spec.startDate, spec.endDate);
  const header = signHeader(W, H, frame, logoURI, dates, Math.min(W_in, H_in) <= 5.6, noLogo, elemScale(spec, "logo"));
  const footer = skuFooter(W, H, frame, spec.sku, "", spec.storeLine, false, elemScale(spec, "footer"));
  const cx = W / 2;
  const maxW = W - 2 * frame.margin - 2 * Math.max(10, W * 0.03);
  let markup = frame.markup + header.markup + footer.markup;
  const contentTop = header.contentTop;
  const contentBottom = H - frame.margin - footer.reserved;
  const contentH = contentBottom - contentTop;
  const subH = spec.detail ? Math.min(contentH * 0.35, contentH * 0.18 * elemScale(spec, "detail")) : 0;
  const fit = balancedLines(spec.name || "", "RobotoBlack", (contentH - subH) * 0.5 * elemScale(spec, "name"), maxW, 2);
  let lineGap = fit.size * 0.14;
  let totalH = fit.lines.length * (fit.size + lineGap);
  if (totalH > contentH - subH) {
    // a boosted message may not run into the small line or the footer
    const k = (contentH - subH) / totalH;
    fit.size *= k;
    lineGap *= k;
    totalH = contentH - subH;
  }
  let y = contentTop + Math.max(0, (contentH - subH - totalH) / 2) + fit.size * 0.88;
  markup += `<g data-elem="name">`;
  for (const line of fit.lines) {
    markup += svgText(cx, y, line, "RobotoBlack", fit.size, INK);
    y += fit.size + lineGap;
  }
  markup += `</g>`;
  if (spec.detail) {
    const sS = Math.min(subH * 0.55, fitTextSize(spec.detail, "RobotoMedium", subH * 0.55, maxW));
    markup += `<g data-elem="detail">` + svgText(cx, contentBottom - subH / 2 + sS * 0.3, spec.detail, "RobotoMedium", sS, GRAY11) + `</g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${markup}</svg>`;
};
