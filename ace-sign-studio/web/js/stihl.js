/* ============================================================
   STIHL data glue — bridges the bundled SignShop datasets
   (SIGN_DATA / SIGN_SPECS / SIGN_SPECS_DSM / SIGN_DSM_PARTS /
   SIGN_CATALOG) to the unified editor, porting the legacy
   current()/defaultSpecs()/config-label logic.
   ============================================================ */
"use strict";

const SAW_CATS = { "0CS": 1, "0LB": 1, "0ES": 1, "0GS": 1 };

const StihlData = {
  data: null,       // active dataset (bundled or imported)
  overrides: {},    // per-model overrides, keyed by model.id
  meta: { source: "bundled", label: "bundled dealer file 07/01/2026" },

  init(saved) {
    this.data = window.SIGN_DATA;
    if (saved && saved.dataset && saved.dataset.models) {
      this.data = saved.dataset;
      this.meta = saved.meta || { source: "import", label: "imported price file" };
    }
    if (saved && saved.overrides) this.overrides = saved.overrides;
  },

  models() { return (this.data && this.data.models) || []; },
  categories() { return (this.data && this.data.categories) || []; },
  byId(id) { return this.models().find((m) => m.id === id) || null; },

  search(q) {
    const needle = String(q || "").trim().toLowerCase();
    const all = this.models();
    if (!needle) return all;
    return all.filter((mo) =>
      (mo.model + " " + (mo.nickname || "") + " " + mo.categoryName).toLowerCase().includes(needle) ||
      mo.variants.some((v) => (v.aceSku || "").toLowerCase().includes(needle) || (v.upc || "").includes(needle))
    );
  },
};

function stihlSpecHints(model) {
  const text = model.variants.map((v) => `${v.desc || ""} ${v.retail || ""}`).join(" ");
  const grab = (re) => { const m = re.exec(text); return m ? m[0] : ""; };
  return {
    cc: grab(/\b\d{2,3}(?:\.\d)?\s?cc\b/i),
    volts: grab(/\b\d{2,3}\s?V\b/),
  };
}

function stihlDefaultSpecs(model) {
  const dsm = window.SIGN_SPECS_DSM || {};
  const cur = window.SIGN_SPECS || {};
  const backfill = (specs) => {
    const curated = cur[model.model];
    if (!curated) return specs;
    return specs.map(([l, v]) => {
      if (v) return [l, v];
      const hit = (curated.specs || []).find(([cl]) => cl.toLowerCase() === l.toLowerCase());
      return [l, hit ? hit[1] : v];
    });
  };
  if (dsm[model.model]) {
    const d = dsm[model.model];
    return { title: d.title, specs: backfill((d.specs || []).map((s) => s.slice())), source: "DSM" };
  }
  if (cur[model.model]) {
    const c = cur[model.model];
    return { title: c.title, specs: (c.specs || []).map((s) => s.slice()), source: "curated" };
  }
  const hints = stihlSpecHints(model);
  const cat = model.category;
  if (cat === "3TT" || cat === "3MA") {
    return { title: "ATTACHMENT", specs: [["FITS", "KombiMotors"], ["WEIGHT", ""], ["LENGTH", ""], ["TYPE", model.productType || ""]], source: "auto" };
  }
  const looksBattery = ["0LB", "1HB", "1LB", "1ZB", "1IB"].includes(cat) || /^[A-Z]{2,3}A\s/.test(model.model) || !!hints.volts;
  if (looksBattery) {
    return { title: "BATTERY & PERFORMANCE", specs: [["BATTERY SYSTEM", hints.volts ? "AK/AP System" : ""], ["WEIGHT", ""], ["RUN TIME (UP TO)", ""], ["CHARGE TIME", ""]], source: "auto" };
  }
  if (/^(FSE|BGE|HSE|RE |SE )/.test(model.model)) {
    return { title: "ELECTRIC POWER", specs: [["POWER SOURCE", "120 V corded"], ["WEIGHT", ""], ["PERFORMANCE", ""], ["CORD", ""]], source: "auto" };
  }
  const isBlower = cat === "1BB" || cat === "1BH";
  return {
    title: "ENGINE & PERFORMANCE",
    specs: isBlower
      ? [["DISPLACEMENT", hints.cc], ["AIR VOLUME", ""], ["MAX AIR VELOCITY", ""], ["WEIGHT", ""]]
      : [["DISPLACEMENT", hints.cc], ["POWER OUTPUT", ""], ["WEIGHT", ""], ["FUEL CAPACITY", ""]],
    source: "auto",
  };
}

function stihlSpecCompleteness(model) {
  const ds = stihlDefaultSpecs(model);
  const filled = (ds.specs || []).filter(([, v]) => String(v || "").trim()).length;
  return filled >= 4 ? "full" : filled > 0 ? "partial" : "none";
}

function stihlConfigLabel(variant, category) {
  const dsm = (window.SIGN_DSM_PARTS || {})[variant.materialDash] || {};
  const parts = [];
  const len = dsm.barLen || variant.barIn;
  if (len) parts.push(`${len}″ BAR`);
  const chain = dsm.chainName || variant.chain;
  if (chain) parts.push(String(chain).toUpperCase());
  return parts.join(" · ");
}

function stihlSideLabel(variant, category) {
  const dsm = (window.SIGN_DSM_PARTS || {})[variant.materialDash] || {};
  const len = dsm.barLen || variant.barIn;
  const chain = dsm.chainName || variant.chain;
  if (len && chain) return `${len}″ Bar · ${chain}`;
  if (len) return `${len}″ Bar`;
  // fall back to a compact tail of the dealer description
  const d = String(variant.desc || "").replace(/^.*?,\s*/, "");
  return d.length > 26 ? d.slice(0, 26) + "…" : d || variant.materialDash;
}

/* Build the render spec for a model + overrides — port of current(). */
function stihlCurrent(model) {
  const o = StihlData.overrides[model.id] || {};
  const floorIdx = Math.min(o.floorIdx != null ? o.floorIdx : 0, model.variants.length - 1);
  const v = model.variants[floorIdx];
  const ds = stihlDefaultSpecs(model);
  const dsmParts = window.SIGN_DSM_PARTS || {};
  const d = {
    floorIdx,
    category: model.signCategory,
    model1: model.model,
    model2: model.nickname || "",
    config: stihlConfigLabel(v, model.category),
    price: (v.msrp != null ? v.msrp : 0).toFixed(2),
    sku: v.aceSku || "",
    upc: v.upc || "",
    specTitle: ds.title,
    specs: ds.specs,
    specSource: ds.source,
    isSaw: !!SAW_CATS[model.category],
    side: model.variants.map((x, i) => ({
      material: x.materialDash,
      include: model.variants.length <= 3 || i < 3,
      label: stihlSideLabel(x, model.category),
      price: (x.msrp != null ? x.msrp : 0).toFixed(2),
      sku: x.aceSku || "",
      chain: (dsmParts[x.materialDash] || {}).chain || "",
      bar: (dsmParts[x.materialDash] || {}).bar || "",
    })),
  };
  const merged = Object.assign({}, d, o);
  merged.isSaw = d.isSaw;
  if (o.specs) merged.specs = o.specs.map((s) => s.slice());
  merged.side = d.side.map((item) => Object.assign({}, item, (o.side || {})[item.material] || {}));
  return merged;
}

function stihlSetOverride(modelId, key, value) {
  const o = StihlData.overrides[modelId] || (StihlData.overrides[modelId] = {});
  if (value === undefined) delete o[key];
  else o[key] = value;
}

/* Switching floor variant clears variant-dependent overrides (legacy rule). */
function stihlSetFloorVariant(modelId, idx) {
  const o = StihlData.overrides[modelId] || (StihlData.overrides[modelId] = {});
  o.floorIdx = idx;
  delete o.price; delete o.sku; delete o.upc; delete o.config;
}

/* CSV price-file import: updates msrp/upc/aceSku on matching variants
   (matched by STIHL Material Number). Returns {updated, priceChanges, missing}. */
function stihlImportPriceCSV(text) {
  const rows = parseCSVText(text);
  if (!rows.length) throw new Error("Empty file.");
  const header = rows[0].map((h) => h.replace(/^﻿/, "").trim());
  const idx = {};
  for (const col of ["STIHL Material Number", "Material Description", "MSRP"]) {
    idx[col] = header.indexOf(col);
    if (idx[col] === -1) throw new Error(`Missing column: ${col}`);
  }
  idx.UPC = header.indexOf("UPC");
  idx["ACE SKU"] = header.indexOf("ACE SKU");

  const byMaterial = new Map();
  for (const mo of StihlData.models()) {
    for (const v of mo.variants) byMaterial.set(v.materialDash, v);
  }
  const dash = (mat) => {
    const digits = String(mat || "").replace(/\s+/g, " ").trim();
    const m = /^([A-Z0-9]{2,4})[ -]?(\d{3})[ -]?(\d{4})/i.exec(digits);
    return m ? `${m[1]}-${m[2]}-${m[3]}`.toUpperCase() : digits.toUpperCase();
  };
  let updated = 0, priceChanges = 0, missing = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const mat = dash(r[idx["STIHL Material Number"]]);
    const msrp = parseFloat(String(r[idx.MSRP] || "").replace(/[^0-9.]/g, ""));
    if (!mat || isNaN(msrp) || msrp <= 0) continue;
    const v = byMaterial.get(mat);
    if (!v) { missing++; continue; }
    if (Math.abs((v.msrp || 0) - msrp) > 0.004) priceChanges++;
    v.msrp = msrp;
    if (idx.UPC !== -1 && r[idx.UPC]) v.upc = String(r[idx.UPC]).replace(/\D/g, "");
    if (idx["ACE SKU"] !== -1 && r[idx["ACE SKU"]]) v.aceSku = String(r[idx["ACE SKU"]]).trim();
    updated++;
  }
  return { updated, priceChanges, missing };
}

/* RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF). */
function parseCSVText(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}
