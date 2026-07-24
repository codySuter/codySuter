/* UPC-A / EAN-13 barcode generator — direct port of the SignShop encoder. */
"use strict";

const _BC_L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
const _BC_G = _BC_L.map((p) => p.split("").reverse().map((b) => (b === "1" ? "0" : "1")).join(""));
const _BC_R = _BC_L.map((p) => p.split("").map((b) => (b === "1" ? "0" : "1")).join(""));
const _EAN_PARITY = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];

function barcodeCheckDigit(digits) {
  let sum = 0;
  const arr = digits.split("").map(Number);
  let weight = 3;
  for (let i = arr.length - 1; i >= 0; i--) {
    sum += arr[i] * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10;
}

function encodeBarcode(value) {
  const raw = String(value || "").replace(/\D/g, "");
  if (raw.length !== 12 && raw.length !== 13) return null;
  const body = raw.slice(0, -1);
  const check = barcodeCheckDigit(body);
  const corrected = check !== Number(raw.slice(-1));
  const digits = body + String(check);

  let modules = "101";
  let text;
  if (digits.length === 12) {
    for (let i = 0; i < 6; i++) modules += _BC_L[+digits[i]];
    modules += "01010";
    for (let i = 6; i < 12; i++) modules += _BC_R[+digits[i]];
    modules += "101";
    text = `${digits[0]} ${digits.slice(1, 6)} ${digits.slice(6, 11)} ${digits[11]}`;
  } else {
    const parity = _EAN_PARITY[+digits[0]];
    for (let i = 1; i < 7; i++) {
      modules += (parity[i - 1] === "L" ? _BC_L : _BC_G)[+digits[i]];
    }
    modules += "01010";
    for (let i = 7; i < 13; i++) modules += _BC_R[+digits[i]];
    modules += "101";
    text = `${digits[0]} ${digits.slice(1, 7)} ${digits.slice(7, 13)}`;
  }
  return { modules, text, corrected };
}

/* Returns SVG inner markup (rects) for embedding into a sign SVG at (x,y). */
function barcodeRects(value, x, y, widthPx, heightPx, fill) {
  const enc = encodeBarcode(value);
  if (!enc) return null;
  const mw = widthPx / enc.modules.length;
  let out = "";
  let run = 0;
  for (let i = 0; i <= enc.modules.length; i++) {
    if (i < enc.modules.length && enc.modules[i] === "1") { run++; continue; }
    if (run > 0) {
      out += `<rect x="${(x + (i - run) * mw).toFixed(3)}" y="${y.toFixed(3)}" width="${(run * mw).toFixed(3)}" height="${heightPx.toFixed(3)}" fill="${fill || "#191919"}"/>`;
      run = 0;
    }
  }
  return { rects: out, text: enc.text, corrected: enc.corrected };
}

/* ---- Code 128 (subset B) — Ace SKUs are 4–9 digits, which UPC-A/EAN-13
   can't hold. Standard element-width table, values 0–105 + stop. ---- */
const _C128 = ("212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 " +
  "221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 " +
  "221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 " +
  "212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 " +
  "231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 " +
  "231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 " +
  "314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 " +
  "112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 " +
  "111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 " +
  "214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 " +
  "114131 311141 411131 211412 211214 211232").split(" ");
const _C128_STOP = "2331112";

function encodeCode128B(value) {
  const s = String(value == null ? "" : value);
  if (!s.length || s.length > 24 || /[^\x20-\x7e]/.test(s)) return null;
  const vals = [104]; // Start Code B
  for (const ch of s) vals.push(ch.charCodeAt(0) - 32);
  let sum = vals[0];
  for (let i = 1; i < vals.length; i++) sum += vals[i] * i;
  vals.push(sum % 103);
  let bits = "";
  let bar = true;
  const emit = (pattern) => {
    for (const w of pattern) { bits += (bar ? "1" : "0").repeat(+w); bar = !bar; }
  };
  for (const v of vals) emit(_C128[v]);
  emit(_C128_STOP);
  return bits;
}

/* SVG rects for a Code 128 barcode; widthPx includes 10-module quiet
   zones on each side. Returns null when the value can't be encoded. */
function code128Rects(value, x, y, widthPx, heightPx, fill) {
  const bits = encodeCode128B(value);
  if (!bits) return null;
  const mw = widthPx / (bits.length + 20);
  const x0 = x + 10 * mw;
  let out = "";
  let run = 0;
  for (let i = 0; i <= bits.length; i++) {
    if (i < bits.length && bits[i] === "1") { run++; continue; }
    if (run > 0) {
      out += `<rect x="${(x0 + (i - run) * mw).toFixed(3)}" y="${y.toFixed(3)}" width="${(run * mw).toFixed(3)}" height="${heightPx.toFixed(3)}" fill="${fill || "#111111"}"/>`;
      run = 0;
    }
  }
  return { rects: out, text: String(value) };
}
