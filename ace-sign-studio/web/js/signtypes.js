/* ============================================================
   Sign type registry: field schemas drive the editor, renderers
   draw the SVG, samples feed the gallery/nav thumbnails.
   Sizes are physical inches (width × height as printed).
   ============================================================ */
"use strict";

/* PALLET_CUT: dashed cut-guide inset for Pallet Sign Holder sizes — the
   legacy tool's CUT_MARGIN of 22pt. Print full page, cut on the dashed
   line, laminate; the sealed edge brings it back to ≤ 8.5×11 so it slides
   into the pallet holder. */
const PALLET_CUT = 22 / 72;

const SIZES = [
  { id: "letter-l",  w: 11,  h: 8.5, label: 'Full Page 11×8.5"' },
  { id: "letter-p",  w: 8.5, h: 11,  label: 'Full Page 8.5×11"' },
  { id: "pallet-l",  w: 11,  h: 8.5, cut: PALLET_CUT, label: 'Pallet Holder 11×8.5"' },
  { id: "pallet-p",  w: 8.5, h: 11,  cut: PALLET_CUT, label: 'Pallet Holder 8.5×11"' },
  { id: "holder-11x7", w: 11, h: 7,  label: 'Sign Holder 11×7"' },
  { id: "counter-7x5", w: 7,  h: 5,  label: 'Counter 7×5"' },
  { id: "card-6x4",  w: 6,   h: 4,   label: 'Card 6×4"' },
  { id: "shelf-5x3", w: 5,   h: 3,   label: 'Shelf 5×3"' },
  { id: "shelf-55x35", w: 5.5, h: 3.5, label: 'Shelf 5.5×3.5"' },
];
const sizeById = (id) => SIZES.find((s) => s.id === id) || SIZES[0];

/* Field kinds: sku (with auto-lookup), text, money, percent, int, image,
   dates, check, textarea. `show` may hide a field per spec state. */
const F = {
  sku:    { key: "sku", kind: "sku", label: "SKU / item number", help: "Type or paste — price, name & photo auto-fill from acehardware.com" },
  name:   { key: "name", kind: "text", label: "Product name" },
  detail: { key: "detail", kind: "text", label: "Detail line (brand · size · model)", optional: true },
  price:  { key: "price", kind: "money", label: "Price" },
  regPrice: { key: "regPrice", kind: "money", label: "Regular price", optional: true },
  savings:  { key: "savings", kind: "money", label: "Savings amount" },
  percent:  { key: "percent", kind: "percent", label: "Percent off" },
  qty2:   { key: "qty", kind: "int", label: "Quantity", def: 2 },
  unit:   { key: "unit", kind: "text", label: "Unit (optional — each, /ft, /gal)", optional: true },
  image:  { key: "image", kind: "image", label: "Product photo" },
  dates:  { key: "dates", kind: "dates", label: "Sale dates" },
  upTo:   { key: "upTo", kind: "check", label: "Show “UP TO” above the percent" },
  category: { key: "category", kind: "text", label: "Category name (e.g. HAND TOOLS)" },
  message:  { key: "message", kind: "textarea", label: "Message" },
  barcode:  { key: "barcode", kind: "check", label: "Print a scannable SKU barcode (Code 128)" },
};

const SIGN_TYPES = [
  {
    id: "regular", hideable: ["logo", "image", "name", "detail", "price", "sku"], group: "Price & Promo", label: "Regular Price",
    note: "Everyday price with photo",
    fields: [F.sku, F.name, F.detail, F.price, F.unit, F.image],
    render: (spec, w, h) => AceRenderers.regular(spec, w, h),
    sample: { name: "DeWalt 20V MAX Drill/Driver Kit", price: "129.00", sku: "2837301" },
  },
  {
    id: "sale", hideable: ["logo", "image", "name", "detail", "price", "regPrice", "sku"], group: "Price & Promo", label: "Sale",
    note: "SALE chip + sale price + reg price",
    fields: [F.sku, F.name, F.detail, F.price, F.regPrice, F.unit, F.image, F.dates],
    render: (spec, w, h) => AceRenderers.sale(spec, w, h),
    sample: { name: "Scotts Turf Builder 5M", price: "19.99", regPrice: "24.99", sku: "7135975" },
  },
  {
    id: "percent_off", hideable: ["logo", "image", "name", "detail", "sku"], group: "Price & Promo", label: "Percent Off",
    note: "Big 00% OFF block",
    fields: [F.sku, F.name, F.detail, F.percent, F.upTo, F.image, F.dates],
    render: (spec, w, h) => AceRenderers.percent_off(spec, w, h),
    sample: { name: "All Weber Grill Accessories", percent: "25" },
  },
  {
    id: "bogo_free", hideable: ["logo", "image", "name", "detail", "sku"], group: "Price & Promo", label: "BOGO Free",
    note: "Buy one get one FREE",
    fields: [F.sku, F.name, F.detail, F.image, F.dates],
    render: (spec, w, h) => AceRenderers.bogo_free(spec, w, h),
    sample: { name: "Ace Wild Bird Food 20 lb." },
  },
  {
    id: "bogo_percent", hideable: ["logo", "image", "name", "detail", "sku"], group: "Price & Promo", label: "BOGO % Off",
    note: "Buy one get one 00% off",
    fields: [F.sku, F.name, F.detail, F.percent, F.image, F.dates],
    render: (spec, w, h) => AceRenderers.bogo_percent(spec, w, h),
    sample: { name: "Milwaukee Hand Tools", percent: "50" },
  },
  {
    id: "two_for", hideable: ["logo", "image", "name", "detail", "sku"], group: "Price & Promo", label: "2 for $X",
    note: "Multi-buy price (2/$00)",
    fields: [F.sku, F.name, F.detail, F.qty2, F.price, F.image, F.dates],
    render: (spec, w, h) => AceRenderers.two_for(spec, w, h),
    sample: { name: "Rust-Oleum 2X Spray Paint", price: "9.00", qty: 2 },
  },
  {
    id: "instant_savings", hideable: ["logo", "image", "name", "detail", "price", "regPrice", "sku"], group: "Price & Promo", label: "Instant Savings",
    note: "Ace Rewards exclusive savings",
    fields: [F.sku, F.name, F.detail, F.price, F.regPrice, F.savings, F.image, F.dates],
    render: (spec, w, h) => AceRenderers.instant_savings(spec, w, h),
    sample: { name: "Craftsman 230-pc Mechanics Set", price: "99.00", regPrice: "129.00", savings: "30" },
  },
  {
    id: "buy_get_off", hideable: ["logo", "image", "name", "detail", "sku"], group: "Price & Promo", label: "Buy 2 Get $X Off",
    note: "Buy two get $00 off",
    fields: [F.sku, F.name, F.detail, F.qty2, F.savings, F.image, F.dates],
    render: (spec, w, h) => AceRenderers.buy_get_off(spec, w, h),
    sample: { name: "Clark+Kensington Paint Gallons", qty: 2, savings: "10" },
  },
  {
    id: "was_now", hideable: ["logo", "image", "name", "detail", "sku"], group: "Price & Promo", label: "Was / Now",
    note: "Clearance — this unit only",
    fields: [
      F.sku, F.name, F.detail,
      Object.assign({}, F.regPrice, { label: "Was price", optional: false }),
      Object.assign({}, F.price, { label: "Now price" }),
      { key: "unitOnly", kind: "check", label: "Show “THIS UNIT ONLY”", def: true },
      F.image, F.dates,
    ],
    render: (spec, w, h) => AceRenderers.was_now(spec, w, h),
    sample: { name: "Weber Spirit E-325 Gas Grill", regPrice: "549.00", price: "399.00", unitOnly: true },
  },
  {
    id: "final_sale", hideable: ["logo", "image", "name", "detail", "price", "sku"], group: "Price & Promo", label: "Final Sale",
    note: "FINAL SALE — *No returns",
    fields: [
      F.sku, F.name, F.detail,
      Object.assign({}, F.price, { label: "Final price" }),
      { key: "note", kind: "text", label: "Fine print (small line)", def: "*No returns" },
      F.image, F.dates,
    ],
    render: (spec, w, h) => AceRenderers.final_sale(spec, w, h),
    sample: { name: "Char-Broil Performance 4-Burner Grill", price: "249.00", note: "*No returns" },
  },
  {
    id: "your_choice", hideable: ["logo", "image", "name", "detail", "sku"], group: "Price & Promo", label: "Your Choice",
    note: "Red circle — your choice $00",
    fields: [F.sku, F.name, F.detail, F.price, F.image, F.dates],
    render: (spec, w, h) => AceRenderers.your_choice(spec, w, h),
    sample: { name: "Assorted Hand Trowels & Cultivators", price: "5.00" },
  },
  {
    id: "under_amount", hideable: ["logo"], group: "Price & Promo", label: "Under $X",
    note: "Category under a dollar amount",
    fields: [F.category, F.price, F.dates],
    render: (spec, w, h) => AceRenderers.under_amount(spec, w, h),
    sample: { category: "STOCKING STUFFERS", price: "10" },
  },
  {
    id: "large_text", hideable: ["logo", "image", "price", "sku"], group: "Specialty", label: "Large Text",
    note: "Name as big as possible + price",
    fields: [F.sku, F.name, F.price, F.image, F.dates],
    render: (spec, w, h) => AceRenderers.large_text(spec, w, h),
    sample: { name: "PROPANE REFILLS", price: "17.99" },
  },
  {
    id: "text_only", hideable: ["logo"], group: "Specialty", label: "Text Only",
    note: "Message sign — no price, no photo",
    fields: [
      Object.assign({}, F.name, { label: "Message (line 1–2)" }),
      Object.assign({}, F.detail, { label: "Small line under the message" }),
      F.dates,
    ],
    render: (spec, w, h) => AceRenderers.text_only(spec, w, h),
    sample: { name: "STORE USE LADDERS", detail: "" },
  },
];

const typeById = (id) => SIGN_TYPES.find((t) => t.id === id) || null;

/* Every sign type that shows a SKU can also print it as a barcode. */
for (const t of SIGN_TYPES) {
  if (t.fields.some((f) => f.kind === "sku")) t.fields.push(F.barcode);
}

/* ---------- gallery template product ----------
   Gallery/nav thumbnails render with a real product so previews show an
   actual photo. Default template SKU 81995 (Ace Premium Wild Bird Food
   20 lb); a live lookup at launch swaps in the real store photo/price and
   caches it. This fallback keeps thumbnails working offline. */
const TEMPLATE_FALLBACK = {
  sku: "81995",
  name: "Ace Premium Wild Bird Food 20 lb",
  price: "12.99",
  salePrice: "",
  image: "img/template_product.png",
};

function applyTemplateProduct(p) {
  const price = parseFloat(p.price) || 12.99;
  const sale = parseFloat(p.salePrice) || null;
  const onSale = sale != null && sale < price;
  const now = (onSale ? sale : price).toFixed(2);
  const was = (onSale ? price : Math.max(price + 1, price * 1.25)).toFixed(2);
  const base = { name: p.name, image: p.image, sku: p.sku };
  const set = (id, extra) => {
    const t = typeById(id);
    if (t) t.sample = Object.assign({}, base, extra);
  };
  set("regular", { price: price.toFixed(2) });
  set("sale", { price: now, regPrice: was });
  set("percent_off", { percent: "25" });
  set("bogo_free", {});
  set("bogo_percent", { percent: "50" });
  set("two_for", { qty: 2, price: Math.max(1, Math.round(price * 0.8)) + ".00" });
  set("instant_savings", { price: now, regPrice: was, savings: String(Math.max(1, Math.round(was - now))) });
  set("buy_get_off", { qty: 2, savings: "10" });
  set("your_choice", { price: price.toFixed(2) });
  set("was_now", { price: now, regPrice: was, unitOnly: true });
  set("final_sale", { price: now, note: "*No returns" });
  set("large_text", { price: price.toFixed(2) });
}

applyTemplateProduct(TEMPLATE_FALLBACK);

/* Per-type allowed sizes (Ace types allow all; STIHL keeps 5:3 aspect). */
function sizesForType(t) {
  if (t.sizes) return t.sizes.map(sizeById);
  return SIZES;
}
function defaultSizeForType(t) {
  return sizeById(t.defaultSize || "letter-l");
}

/* ---------- per-field visibility toggles ----------
   Each sign type lists its hideable elements; hiding one blanks the
   matching field on the render spec so the layout reflows around it. */
const TOGGLE_DEFS = {
  logo: { label: "Ace logo", apply: (s) => { s.showLogo = false; } },
  image: { label: "Photo", apply: (s) => { s.image = null; } },
  name: { label: "Name", apply: (s) => { s.name = ""; } },
  detail: { label: "Detail line", apply: (s) => { s.detail = ""; } },
  price: { label: "Price", apply: (s) => { s.price = ""; } },
  regPrice: { label: "Reg price", apply: (s) => { s.regPrice = ""; } },
  sku: { label: "SKU", apply: (s) => { s.sku = ""; } },
};

function togglesForType(t) {
  return (t.hideable || []).map((k) => ({ key: k, label: TOGGLE_DEFS[k].label }));
}

/* ---------- per-element size sliders ----------
   Each sign type exposes a size slider per major element. The factors
   live on the spec (spec.scale = {key: 0.5–1.6}, 1 = automatic); the
   renderers treat them as preferences and re-balance the layout so a
   boosted element squeezes its neighbors instead of overlapping them. */
const SCALE_DEFS = {
  logo: "Ace logo",
  image: "Photo",
  name: "Name",
  price: "Price / promo",
  detail: "Small line",
  footer: "SKU & footer",
};

function scalablesForType(t) {
  const has = (k) => t.fields.some((f) => f.key === k);
  const keys = ["logo"];
  if (has("image")) keys.push("image");
  if (has("name")) keys.push("name");
  if (t.id !== "text_only") keys.push("price"); // every other type draws a price/promo block
  else keys.push("detail"); // Text Only's small line under the message
  if (has("sku")) keys.push("footer");
  return keys.map((k) => ({
    key: k,
    label: t.id === "text_only" && k === "name" ? "Message" : SCALE_DEFS[k],
  }));
}

function applyHiddenFields(spec, hide) {
  for (const k of Object.keys(hide || {})) {
    if (hide[k] && TOGGLE_DEFS[k]) TOGGLE_DEFS[k].apply(spec);
  }
  return spec;
}
