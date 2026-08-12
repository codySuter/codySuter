// Regenerates sample/compass-sample.csv — a realistic, deterministic
// Compass-shaped export over the real floor plan, so the demo heatmap
// has fresh zones, stale zones, dead stock, and a few messy rows.
//
//   npm run sample     (node >= 22.18, where type stripping is on by
//                       default — on 22.6-22.17 add --experimental-strip-types)
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { FIXTURES } = await import('../src/model/floorplan.ts');

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Deterministic PRNG so the checked-in sample is stable.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const ri = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const ITEMS = [
  'Interior Latex Gal', 'Exterior Semi-Gloss Gal', 'Painters Tape 1.88in', 'Roller Cover 9in', 'Brush Set 3pc',
  'Deck Stain Gal', 'Wood Screws #8 1lb', 'Drywall Anchors 50ct', 'Hex Bolts 1/4in', 'Finish Nails 4d',
  'PVC Elbow 3/4in', 'Ball Valve 1/2in', 'Teflon Tape', 'Sump Pump 1/3HP', 'Faucet Repair Kit',
  'Wire Nuts 25ct', 'Outlet Duplex 15A', 'LED Bulb 60W 4pk', 'Ext Cord 25ft', 'Smoke Alarm',
  'Potting Mix 25qt', 'Grass Seed 3lb', 'Weed Killer Conc', 'Bird Seed 20lb', 'Mulch Cedar 2cf',
  'Grill Brush 18in', 'Charcoal 16lb', 'Pellets Hickory 20lb', 'Grill Cover 58in', 'Propane Exchange',
  'Tape Measure 25ft', 'Utility Knife', 'Claw Hammer 16oz', 'Screwdriver Set 6pc', 'Level 24in',
  'Duct Tape Silver', 'Super Glue 4g', 'Zip Ties 100ct', 'Sandpaper Asst 220', 'WD-40 11oz',
  'Furnace Filter 16x25', 'Shop Towels 55ct', 'Trash Bags 33gal', 'Batteries AA 16pk', 'Flashlight 400lm',
  'Ant Bait 6ct', 'Mouse Trap 2pk', 'Bug Spray Deet 6oz', 'Live Bait Nightcrawlers', 'Ice Melt 20lb',
  'Key Blank KW1', 'Padlock 40mm', 'Door Hinge 3.5in', 'Cabinet Pull Satin', 'Weatherstrip 17ft',
  'Soda 20oz', 'Candy Bar King', 'Chips Grab Bag', 'Water 1L', 'Jerky Original',
];

// How stale each zone of the floor runs (days since last physical),
// so the demo map reads in bands like a real count cycle would.
function zoneOf(id) {
  if (/^0[123][LR]/.test(id) || /^EC0[123]$/.test(id) || /^BW/.test(id)) return { phys: [3, 60], never: 0.02 };
  if (/^0[456][LR]/.test(id) || /^EC0[456]$/.test(id)) return { phys: [45, 200], never: 0.03 };
  if (/^0[789][LR]/.test(id) || /^EC0[789]$/.test(id)) return { phys: [140, 420], never: 0.05 };
  if (/^1[0-3][LR]/.test(id) || /^EC1[0-2]$/.test(id) || /^STW/.test(id)) return { phys: [280, 900], never: 0.12 };
  if (/^IM|^BEV|^REG/.test(id)) return { phys: [20, 150], never: 0.02 };
  if (/^PP|^BAIT|^COLORCHIPS|^ST(EC|ML|MR)/.test(id)) return { phys: [90, 500], never: 0.08 };
  if (/^BB|^GRILL/.test(id)) return { phys: [150, 650], never: 0.06 };
  return { phys: [60, 400], never: 0.05 };
}

const NEVER_FIXTURES = new Set(['COLORCHIPS', 'STW07', '12L03', '11R06', 'BBW17']);
const EMPTY_FIXTURES = new Set(['IML08', 'STW05', 'BEV02', '13L02', '10L08', 'BBW09', 'EC10', '05R03']);

const TODAY = Date.UTC(2026, 7, 12); // stamp of the day the sample was generated
const DAY = 86400000;
const fmt = (ms) => {
  const d = new Date(ms);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
};
const daysAgo = (n) => fmt(TODAY - n * DAY);

const rows = [];
const usedSkus = new Set();
function newSku() {
  let s;
  do s = String(ri(1000000, 8999999));
  while (usedSkus.has(s));
  usedSkus.add(s);
  return s;
}

for (const f of FIXTURES) {
  if (EMPTY_FIXTURES.has(f.id)) continue;
  const zone = zoneOf(f.id);
  const n = f.id === 'GRILL' ? 8 : f.id === 'REG' ? 6 : ri(1, 4);
  for (let i = 0; i < n; i++) {
    const never = NEVER_FIXTURES.has(f.id) || rand() < zone.never;
    const physDays = never ? null : ri(zone.phys[0], zone.phys[1]);
    const dead = rand() < (zone.phys[0] > 250 ? 0.35 : 0.08);
    const saleDays = dead ? ri(380, 950) : ri(1, 200);
    const receiptDays = ri(5, 420);
    const qoh = rand() < 0.04 ? -ri(1, 6) : rand() < 0.08 ? 0 : ri(1, 48);
    const cost = (ri(89, 3999) / 100).toFixed(2);
    const retail = (cost * (1.35 + rand() * 0.6)).toFixed(2);
    const sold = dead ? 0 : ri(0, 120);
    const name = `${pick(ITEMS)} ${String.fromCharCode(65 + (i % 26))}`;
    // A few SKUs live in two spots (endcap + home bay), Compass-style.
    const loc2 = rand() < 0.04 ? pick(FIXTURES.filter((g) => g.id.startsWith('EC'))).id : '';
    rows.push([
      newSku(),
      name.toUpperCase(),
      String(ri(1, 78)),
      f.id,
      loc2,
      String(qoh),
      `$${cost}`,
      `$${retail}`,
      String(sold),
      physDays === null ? '' : daysAgo(physDays),
      daysAgo(saleDays),
      daysAgo(receiptDays),
    ]);
  }
}

// The messy rows every real export has: codes not on the plan, sloppy
// location spellings, and a negative shown in parentheses.
rows.push([newSku(), 'RECEIVING CAGE STOCK', '12', 'RECV', '', '4', '$12.99', '$19.99', '2', daysAgo(410), daysAgo(30), daysAgo(12)]);
rows.push([newSku(), 'OUTBUILDING OVERSTOCK', '31', 'OUTBLDG', '', '9', '$8.49', '$14.99', '0', '', daysAgo(600), daysAgo(300)]);
rows.push([newSku(), 'MYSTERY BAY ITEM', '9', '13R99', '', '1', '$5.00', '$9.99', '1', daysAgo(200), daysAgo(90), daysAgo(60)]);
rows.push([newSku(), 'SLOPPY LOCATION SPELLING', '44', '13r-5a', '', '(3)', '$2.19', '$4.49', '7', daysAgo(500), daysAgo(45), daysAgo(20)]);

const HEADERS = [
  'SKU', 'DESCRIPTION', 'DEPT', 'LOC 1', 'LOC 2', 'QOH', 'AVG COST', 'RETAIL',
  'UNITS SOLD 12MO', 'DATE LAST PHYSICAL', 'DATE LAST SALE', 'DATE LAST RECEIPT',
];
const csv = [HEADERS, ...rows].map((r) => r.join(',')).join('\n') + '\n';
const out = path.join(HERE, '..', 'sample', 'compass-sample.csv');
writeFileSync(out, csv, 'utf8');
console.log(`✓ sample/compass-sample.csv — ${rows.length} rows over ${new Set(rows.map((r) => r[3])).size} locations`);
