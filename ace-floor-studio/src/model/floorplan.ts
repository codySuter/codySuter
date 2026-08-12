// The Media PA sales floor, transcribed from the store's fixture plan
// (12/19/2022 — 8/10/2026). Every fixture that can hold inventory is a
// Fixture with the location code Eagle/Compass uses; walls, the entrance,
// the vestibule room, and the open-floor display tables are decor.
//
// Coordinates live in one fixed 2000×1590 plan space (SVG viewBox units).
// Tweak a bay here and the whole app — map, import matching, heatmaps —
// picks it up.

export interface Fixture {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rotate the label 90° for tall skinny bays, like the printed plan. */
  vertical?: boolean;
  /** Override label size (plan units) for tiny or giant fixtures. */
  fontSize?: number;
  /** What to print when it differs from the location code. */
  label?: string;
}

export interface WallSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const PLAN_W = 2000;
export const PLAN_H = 1590;

const fixtures: Fixture[] = [];
const add = (f: Fixture) => fixtures.push(f);

const pad2 = (n: number) => String(n).padStart(2, '0');

/** A horizontal run of same-size bays, left to right. */
function hRun(ids: string[], x: number, y: number, w: number, h: number, gap = 2, fontSize?: number) {
  ids.forEach((id, i) => add({ id, x: x + i * (w + gap), y, w, h, fontSize }));
}

/**
 * A vertical run of one aisle face. Bay 01 sits at the BOTTOM (the front
 * of the store) and numbers climb toward the back wall, exactly like the
 * printed plan.
 */
function aisleFace(prefix: string, count: number, x: number, y: number, w: number, h: number, gap = 2) {
  for (let i = 0; i < count; i++) {
    add({ id: `${prefix}${pad2(count - i)}`, x, y: y + i * (h + gap), w, h, vertical: true });
  }
}

// ---- back wall (BW23 left → BW01 right, gaps at the columns) ----
{
  const y = 72;
  let x = 88;
  for (let n = 23; n >= 1; n--) {
    add({ id: `BW${pad2(n)}`, x, y, w: 74, h: 34 });
    x += 76;
    if (n === 18 || n === 12 || n === 6) x += 16;
  }
}

// ---- side walls of the top room ----
aisleFace('13L', 9, 70, 128, 34, 76); // left wall
aisleFace('01R', 9, 1896, 128, 34, 76); // right wall

// ---- gondola runs (pairs of back-to-back aisle faces) + endcaps ----
// Each pair: left column faces the higher-numbered aisle (its R side),
// right column faces the lower-numbered aisle (its L side).
{
  const TOP = 186;
  const BAY_H = 76;
  const BAY_W = 38;
  const runs: Array<{ x: number; left: string; right: string; count: number; ec: string }> = [
    { x: 192, left: '13R', right: '12L', count: 7, ec: 'EC12' },
    { x: 332, left: '12R', right: '11L', count: 9, ec: 'EC11' },
    { x: 470, left: '11R', right: '10L', count: 9, ec: 'EC10' },
    { x: 612, left: '10R', right: '09L', count: 9, ec: 'EC09' },
    { x: 756, left: '09R', right: '08L', count: 9, ec: 'EC08' },
    { x: 882, left: '08R', right: '07L', count: 9, ec: 'EC07' },
    { x: 1024, left: '07R', right: '06L', count: 5, ec: 'EC06' },
    { x: 1170, left: '06R', right: '05L', count: 5, ec: 'EC05' },
    { x: 1470, left: '04R', right: '03L', count: 9, ec: 'EC03' },
    { x: 1612, left: '03R', right: '02L', count: 9, ec: 'EC02' },
    { x: 1752, left: '02R', right: '01L', count: 7, ec: 'EC01' },
  ];
  for (const r of runs) {
    aisleFace(r.left, r.count, r.x, TOP, BAY_W, BAY_H);
    aisleFace(r.right, r.count, r.x + BAY_W, TOP, BAY_W, BAY_H);
    add({ id: r.ec, x: r.x, y: TOP + r.count * (BAY_H + 2) + 4, w: BAY_W * 2, h: 26 });
  }

  // The paint-aisle gondola is asymmetric: 05R runs 5 bays and then the
  // COLOR CHIPS section fills the rest, while 04L runs the full 9 bays.
  const x = 1330;
  aisleFace('05R', 5, x, TOP, BAY_W, BAY_H);
  add({
    id: 'COLORCHIPS',
    label: 'COLOR CHIPS',
    x,
    y: TOP + 5 * (BAY_H + 2),
    w: BAY_W,
    h: 4 * (BAY_H + 2) - 2,
    vertical: true,
    fontSize: 13,
  });
  aisleFace('04L', 9, x + BAY_W, TOP, BAY_W, BAY_H);
  add({ id: 'EC04', x, y: TOP + 9 * (BAY_H + 2) + 4, w: BAY_W * 2, h: 26 });
}

// ---- left side wall, working down toward the front ----
add({ id: 'STW13', x: 132, y: 842, w: 76, h: 30 });
add({ id: 'STW12', x: 70, y: 880, w: 32, h: 74, vertical: true });
add({ id: 'STW11', x: 70, y: 956, w: 32, h: 74, vertical: true });
add({ id: 'STW10', x: 74, y: 1036, w: 72, h: 30 });
add({ id: 'STW09', x: 152, y: 1078, w: 32, h: 74, vertical: true });
add({ id: 'STW08', x: 152, y: 1154, w: 32, h: 74, vertical: true });
add({ id: 'STW07', x: 152, y: 1230, w: 32, h: 74, vertical: true });
add({ id: 'STW06', x: 132, y: 1370, w: 76, h: 30 });
add({ id: 'STW05', x: 210, y: 1506, w: 32, h: 30, fontSize: 8 });
hRun(['STW04', 'STW03', 'STW02', 'STW01'], 246, 1506, 74, 30);

// ---- paint department ----
add({ id: 'PPL07', x: 318, y: 1000, w: 82, h: 54, fontSize: 15 });
add({ id: 'PPL06', x: 402, y: 1000, w: 82, h: 54, fontSize: 15 });
hRun(['PPR05', 'PPR04', 'PPR03', 'PPR02', 'PPR01'], 486, 1000, 74, 26);
hRun(['PPL05', 'PPL04', 'PPL03', 'PPL02', 'PPL01'], 486, 1028, 74, 26);
add({ id: 'BAIT', x: 866, y: 1000, w: 26, h: 54, vertical: true, fontSize: 9 });

// ---- the small ST gondola by the paint desk ----
add({ id: 'STEC1', x: 318, y: 1130, w: 68, h: 28 });
aisleFace('STMR', 3, 318, 1162, 33, 76);
aisleFace('STML', 3, 353, 1162, 33, 76);
add({ id: 'STEC2', x: 318, y: 1396, w: 68, h: 28 });
// STM bays number 1..3 top-down on the plan, not bottom-up like aisles —
// flip them back.
for (const f of fixtures) {
  const m = /^(STMR|STML)0(\d)$/.exec(f.id);
  if (m) f.id = `${m[1]}${4 - Number(m[2])}`;
}

// ---- impulse / queue merchandising at the checkout ----
add({ id: 'IMO05', x: 494, y: 1136, w: 30, h: 24, fontSize: 8 });
hRun(['IMO04', 'IMO03', 'IMO02', 'IMO01'], 526, 1136, 76, 24);
hRun(['IMR04', 'IMR03', 'IMR02', 'IMR01'], 526, 1162, 76, 26);
add({ id: 'IMO06', x: 494, y: 1196, w: 24, h: 80, vertical: true, fontSize: 9 });
add({ id: 'IMR05', x: 520, y: 1196, w: 26, h: 80, vertical: true, fontSize: 9 });
add({ id: 'IMO07', x: 494, y: 1280, w: 24, h: 80, vertical: true, fontSize: 9 });
add({ id: 'IMR06', x: 520, y: 1280, w: 26, h: 80, vertical: true, fontSize: 9 });
add({ id: 'IML01', x: 902, y: 1190, w: 24, h: 72, vertical: true, fontSize: 9 });
add({ id: 'IML09', x: 928, y: 1190, w: 24, h: 72, vertical: true, fontSize: 9 });
hRun(['IML04', 'IML03', 'IML02'], 664, 1266, 78, 24);
hRun(['IML05', 'IML06', 'IML07'], 664, 1292, 78, 24);
add({ id: 'IML08', x: 902, y: 1292, w: 24, h: 24, fontSize: 7 });
add({ id: 'BEV01', x: 518, y: 1320, w: 42, h: 30, fontSize: 9 });
add({ id: 'BEV02', x: 518, y: 1364, w: 42, h: 30, fontSize: 9 });
add({ id: 'REG', x: 560, y: 1402, w: 346, h: 30 });

// ---- grilling department (front right) ----
add({ id: 'BBEC3', x: 1526, y: 1032, w: 26, h: 74, vertical: true, fontSize: 9 });
hRun(['BB2L1', 'BB2L2', 'BB2L3'], 1554, 1032, 78, 36);
hRun(['BB2R1', 'BB2R2', 'BB2R3'], 1554, 1070, 78, 36);
add({ id: 'BBEC4', x: 1794, y: 1032, w: 26, h: 74, vertical: true, fontSize: 9 });
add({ id: 'BBEC1', x: 1444, y: 1178, w: 26, h: 74, vertical: true, fontSize: 9 });
hRun(['BB1L1', 'BB1L2', 'BB1L3', 'BB1L4'], 1472, 1178, 78, 36);
hRun(['BB1R1', 'BB1R2', 'BB1R3', 'BB1R4'], 1472, 1216, 78, 36);
add({ id: 'BBEC2', x: 1792, y: 1178, w: 26, h: 74, vertical: true, fontSize: 9 });
add({ id: 'GRILL', label: 'GRILL DISPLAY', x: 1092, y: 1288, w: 718, h: 178, fontSize: 30 });

// ---- front + right walls of the lower room ----
hRun(
  Array.from({ length: 11 }, (_, i) => `BBW${pad2(i + 1)}`),
  1076,
  1506,
  72,
  30,
  1,
);
aisleFace('BBW', 8, 1896, 888, 34, 72); // renders BBW08..BBW01 — fix below
// The right-wall run is BBW19 (top) down to BBW12 — renumber the aisleFace.
for (const f of fixtures) {
  const m = /^BBW0(\d)$/.exec(f.id);
  if (m && f.x === 1896) f.id = `BBW${11 + Number(m[1])}`;
}
add({ id: 'BBW20', x: 1786, y: 842, w: 76, h: 30 });

export const FIXTURES: readonly Fixture[] = fixtures;

// ---- decor: walls, rooms, entrance, open-floor tables ----

export const WALLS: readonly WallSegment[] = [
  // perimeter
  { x1: 60, y1: 60, x2: 1938, y2: 60 },
  { x1: 1938, y1: 60, x2: 1938, y2: 1546 },
  { x1: 1938, y1: 1546, x2: 60, y2: 1546 },
  { x1: 60, y1: 1546, x2: 60, y2: 60 },
  // stub walls that split the back room from the front
  { x1: 60, y1: 836, x2: 214, y2: 836 },
  { x1: 1782, y1: 836, x2: 1938, y2: 836 },
  // the notched-out room on the left side
  { x1: 60, y1: 1068, x2: 148, y2: 1068 },
  { x1: 148, y1: 1068, x2: 148, y2: 1360 },
  { x1: 148, y1: 1360, x2: 60, y2: 1360 },
];

/** The walled vestibule room mid-floor (drawn, not a stock location). */
export const ROOMS: readonly { x: number; y: number; w: number; h: number }[] = [
  { x: 1000, y: 660, w: 215, h: 270 },
];

/** Unlabeled open-floor display tables, drawn faintly like the plan. */
export const TABLES: readonly { x: number; y: number; w: number; h: number }[] = [
  { x: 1082, y: 1078, w: 88, h: 88 },
  { x: 1210, y: 1082, w: 88, h: 88 },
  { x: 1338, y: 1086, w: 88, h: 88 },
  { x: 1104, y: 1190, w: 88, h: 72 },
  { x: 1330, y: 1190, w: 88, h: 72 },
];

export const ENTRANCE = { x: 556, y: 1506, w: 214, h: 40, label: 'ENTRANCE' };

// ---- location lookup for Compass imports ----

const byId = new Map(FIXTURES.map((f) => [f.id, f]));

/** Uppercase and strip everything that isn't a letter or digit. */
export function normalizeLocation(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Families whose bay numbers are zero-padded to two digits on the plan
// ("EC4" → EC04), vs. families that use bare single digits ("BB1L2").
const PAD2_FAMILY = /^(BW|BBW|STW|EC|IMO|IMR|IML|PPL|PPR|BEV)(\d{1,2})([A-Z]\d*)?$/;
const BARE_FAMILY = /^(STEC|STML|STMR|BBEC|BB1L|BB1R|BB2L|BB2R)0*(\d{1,2})([A-Z]\d*)?$/;
const AISLE_BAY = /^0*(\d{1,2})(L|R)0*(\d{1,2})([A-Z]\d*)?$/;

const idsByLength = [...byId.keys()].sort((a, b) => b.length - a.length);

/**
 * Resolve one Compass location code to a fixture id, tolerating the ways
 * real location fields drift: lowercase, dashes/spaces ("13R-05"),
 * missing zero padding ("13R5", "EC4"), and shelf/sub-position suffixes
 * ("13R05A", "EC12B2"). Returns null when the code matches nothing.
 */
export function resolveLocation(raw: string): string | null {
  const norm = normalizeLocation(raw);
  if (norm === '') return null;
  if (byId.has(norm)) return norm;

  let m = AISLE_BAY.exec(norm);
  if (m) {
    const id = `${pad2(Number(m[1]))}${m[2]}${pad2(Number(m[3]))}`;
    if (byId.has(id)) return id;
  }
  m = PAD2_FAMILY.exec(norm);
  if (m) {
    const id = `${m[1]}${pad2(Number(m[2]))}`;
    if (byId.has(id)) return id;
  }
  m = BARE_FAMILY.exec(norm);
  if (m) {
    const id = `${m[1]}${Number(m[2])}`;
    if (byId.has(id)) return id;
  }

  // Aliases for the named areas.
  if (norm.startsWith('GRILL')) return 'GRILL';
  if (norm.startsWith('COLORCHIP')) return 'COLORCHIPS';
  if (norm === 'REGISTER' || norm === 'CHECKOUT') return 'REG';

  // Last resort: a known id followed by extra position text ("13R05A3").
  for (const id of idsByLength) {
    if (norm.startsWith(id)) return id;
  }
  return null;
}

export function getFixture(id: string): Fixture | undefined {
  return byId.get(id);
}
