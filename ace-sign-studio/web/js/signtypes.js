/* ============================================================
   Sign type registry: field schemas drive the editor, renderers
   draw the SVG, samples feed the gallery/nav thumbnails.
   Sizes are physical inches (width × height as printed).
   ============================================================ */
"use strict";

const SIZES = [
  { id: "letter-l",  w: 11,  h: 8.5, label: 'Full Page 11×8.5"' },
  { id: "letter-p",  w: 8.5, h: 11,  label: 'Full Page 8.5×11"' },
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
};

const SIGN_TYPES = [
  {
    id: "regular", group: "Price & Promo", label: "Regular Price",
    note: "Everyday price with photo",
    fields: [F.sku, F.name, F.detail, F.price, F.unit, F.image],
    render: (spec, w, h) => AceRenderers.regular(spec, w, h),
    sample: { name: "DeWalt 20V MAX Drill/Driver Kit", price: "129.00", sku: "2837301" },
  },
  {
    id: "sale", group: "Price & Promo", label: "Sale",
    note: "SALE chip + sale price + reg price",
    fields: [F.sku, F.name, F.detail, F.price, F.regPrice, F.unit, F.image, F.dates],
    render: (spec, w, h) => AceRenderers.sale(spec, w, h),
    sample: { name: "Scotts Turf Builder 5M", price: "19.99", regPrice: "24.99", sku: "7135975" },
  },
  {
    id: "percent_off", group: "Price & Promo", label: "Percent Off",
    note: "Big 00% OFF block",
    fields: [F.sku, F.name, F.detail, F.percent, F.upTo, F.image, F.dates],
    render: (spec, w, h) => AceRenderers.percent_off(spec, w, h),
    sample: { name: "All Weber Grill Accessories", percent: "25" },
  },
  {
    id: "bogo_free", group: "Price & Promo", label: "BOGO Free",
    note: "Buy one get one FREE",
    fields: [F.sku, F.name, F.detail, F.image, F.dates],
    render: (spec, w, h) => AceRenderers.bogo_free(spec, w, h),
    sample: { name: "Ace Wild Bird Food 20 lb." },
  },
  {
    id: "bogo_percent", group: "Price & Promo", label: "BOGO % Off",
    note: "Buy one get one 00% off",
    fields: [F.sku, F.name, F.detail, F.percent, F.image, F.dates],
    render: (spec, w, h) => AceRenderers.bogo_percent(spec, w, h),
    sample: { name: "Milwaukee Hand Tools", percent: "50" },
  },
  {
    id: "two_for", group: "Price & Promo", label: "2 for $X",
    note: "Multi-buy price (2/$00)",
    fields: [F.sku, F.name, F.detail, F.qty2, F.price, F.image, F.dates],
    render: (spec, w, h) => AceRenderers.two_for(spec, w, h),
    sample: { name: "Rust-Oleum 2X Spray Paint", price: "9.00", qty: 2 },
  },
  {
    id: "instant_savings", group: "Price & Promo", label: "Instant Savings",
    note: "Ace Rewards exclusive savings",
    fields: [F.sku, F.name, F.detail, F.price, F.regPrice, F.savings, F.image, F.dates],
    render: (spec, w, h) => AceRenderers.instant_savings(spec, w, h),
    sample: { name: "Craftsman 230-pc Mechanics Set", price: "99.00", regPrice: "129.00", savings: "30" },
  },
  {
    id: "buy_get_off", group: "Price & Promo", label: "Buy 2 Get $X Off",
    note: "Buy two get $00 off",
    fields: [F.sku, F.name, F.detail, F.qty2, F.savings, F.image, F.dates],
    render: (spec, w, h) => AceRenderers.buy_get_off(spec, w, h),
    sample: { name: "Clark+Kensington Paint Gallons", qty: 2, savings: "10" },
  },
  {
    id: "was_now", group: "Price & Promo", label: "Was / Now",
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
    id: "your_choice", group: "Price & Promo", label: "Your Choice",
    note: "Red circle — your choice $00",
    fields: [F.sku, F.name, F.detail, F.price, F.image, F.dates],
    render: (spec, w, h) => AceRenderers.your_choice(spec, w, h),
    sample: { name: "Assorted Hand Trowels & Cultivators", price: "5.00" },
  },
  {
    id: "under_amount", group: "Price & Promo", label: "Under $X",
    note: "Category under a dollar amount",
    fields: [F.category, F.price, F.dates],
    render: (spec, w, h) => AceRenderers.under_amount(spec, w, h),
    sample: { category: "STOCKING STUFFERS", price: "10" },
  },
  {
    id: "large_text", group: "Specialty", label: "Large Text",
    note: "Name as big as possible + price",
    fields: [F.sku, F.name, F.price, F.image, F.dates],
    render: (spec, w, h) => AceRenderers.large_text(spec, w, h),
    sample: { name: "PROPANE REFILLS", price: "17.99" },
  },
  {
    id: "text_only", group: "Specialty", label: "Text Only",
    note: "Message sign — no price, no photo",
    fields: [
      Object.assign({}, F.name, { label: "Message (line 1–2)" }),
      Object.assign({}, F.detail, { label: "Small line under the message" }),
      F.dates,
    ],
    render: (spec, w, h) => AceRenderers.text_only(spec, w, h),
    sample: { name: "STORE USE LADDERS", detail: "" },
  },
  {
    id: "stihl_shelf", group: "STIHL", label: "STIHL Shelf Sign",
    note: "5×3 spec sign with barcode",
    stihl: true,
    sizes: ["shelf-5x3", "counter-7x5", "holder-11x7"],
    defaultSize: "shelf-5x3",
    render: (spec, w, h) => renderStihlSign(spec, w, h),
    sample: null, // thumbnail rendered from first dataset model at runtime
  },
];

const typeById = (id) => SIGN_TYPES.find((t) => t.id === id) || null;

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
