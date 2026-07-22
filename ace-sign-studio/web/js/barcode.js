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
