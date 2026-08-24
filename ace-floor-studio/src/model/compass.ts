// Turning an Epicor Compass export (one row per SKU) into FloorData:
// column auto-detection, Eagle-style value parsing, and location
// resolution against the floor plan.
import { resolveLocation } from './floorplan';
import type { FloorData, SkuRecord, UnmatchedLocation } from './types';

export interface ColumnMap {
  sku: number;
  desc: number;
  /** Every column holding a location code (Loc 1, Loc 2, …). */
  locs: number[];
  qoh: number;
  cost: number;
  retail: number;
  sold: number;
  datePhys: number;
  dateSale: number;
  dateReceipt: number;
}

export const NO_COLUMN = -1;

type SingleField = Exclude<keyof ColumnMap, 'locs'>;

export const FIELD_LABELS: Record<SingleField, string> = {
  sku: 'SKU',
  desc: 'Description',
  qoh: 'Quantity on hand',
  cost: 'Unit cost',
  retail: 'Retail price',
  sold: 'Units sold',
  datePhys: 'Date last physical',
  dateSale: 'Date last sale',
  dateReceipt: 'Date last receipt',
};

// "Date Last Sale", "Dt Last Sold", bare "Last Sale" — but NOT movement
// columns like "$ Sales Last 12 Mo" / "Units Sold YTD", which also say
// "last"/"sold" without being dates.
const isDateName = (h: string) =>
  !/[$#%]/.test(h) && !/\b(units?|qty|amount|amt|\d+\s*(mo|wk|week|mos|weeks)|ytd)\b/.test(h) && (/\b(date|dt)\b/.test(h) || /^last\s/.test(h));

/**
 * Guess which export column feeds which field from the header row.
 * Every guess is editable in the import dialog — this only has to be
 * right for the common Compass/Eagle header spellings.
 */
export function detectColumns(headers: string[]): ColumnMap {
  const hs = headers.map((h) => h.trim().toLowerCase());
  const used = new Set<number>();
  const claim = (pred: (h: string, i: number) => boolean): number => {
    const i = hs.findIndex((h, idx) => !used.has(idx) && h !== '' && pred(h, idx));
    if (i >= 0) used.add(i);
    return i;
  };

  // Specific names claim their columns before looser patterns run.
  const datePhys = claim((h) => h.includes('phys'));
  const dateSale = claim((h) => (h.includes('sale') || h.includes('sold')) && isDateName(h));
  const dateReceipt = claim((h) => /rec(eipt|eived|pt|v|'d|d\b)/.test(h) && isDateName(h));
  const sku = claim((h) => h === 'sku' || h.includes('sku') || /^item ?(#|no|num|number)?$/.test(h) || h.includes('upc'));
  const desc = claim((h) => h.includes('desc'));
  const qoh = claim((h) => h.includes('qoh') || h.includes('on hand') || h.includes('on-hand') || h === 'oh' || h.includes('quantity on'));
  const cost = claim((h) => h.includes('cost'));
  const retail = claim((h) => h.includes('retail') || h === 'price');
  const sold = claim(
    (h) =>
      !isDateName(h) &&
      (h.includes('sold') || h.includes('mvmt') || h.includes('movement') || (h.includes('sales') && h.includes('unit'))),
  );
  const locs = hs
    .map((h, i) => i)
    .filter((i) => !used.has(i) && (/(^|[^a-z])loc/.test(hs[i]) || hs[i].includes('location') || hs[i].includes('bin')));

  return { sku, desc, locs, qoh, cost, retail, sold, datePhys, dateSale, dateReceipt };
}

/** Eagle numbers: "$1,299.99", "(3)" for negative, blank for nothing. */
export function parseNumber(raw: string): number | null {
  let s = raw.trim();
  if (s === '') return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, '');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  if (Number.isNaN(n)) return null;
  return negative ? -n : n;
}

const NEVER_DATES = new Set(['0', '00/00/00', '00/00/0000', '0/0/0', '01/01/1900', '12/30/1899', '12/31/1899']);

/**
 * A "date last …" cell → epoch ms at UTC midnight, or null for
 * never/blank. Handles ISO, US m/d/yyyy and m/d/yy, yyyymmdd, and raw
 * Excel date serials (what an .xlsx hands us for date cells).
 */
export function parseDate(raw: string): number | null {
  const s = raw.trim();
  if (s === '' || NEVER_DATES.has(s)) return null;

  const utc = (y: number, mo: number, d: number): number | null => {
    if (y < 1901 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const ms = Date.UTC(y, mo - 1, d);
    const back = new Date(ms);
    // Reject rollovers like 02/31.
    return back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? ms : null;
  };

  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  if (m) return utc(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return utc(Number(m[3]), Number(m[1]), Number(m[2]));

  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/.exec(s);
  if (m) {
    const yy = Number(m[3]);
    return utc(yy < 50 ? 2000 + yy : 1900 + yy, Number(m[1]), Number(m[2]));
  }

  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m && Number(m[1]) >= 1990 && Number(m[1]) <= 2100) return utc(Number(m[1]), Number(m[2]), Number(m[3]));

  // Excel serial days since 1899-12-30 (as text once the sheet is read).
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial >= 15000 && serial <= 110000) return (Math.floor(serial) - 25569) * 86400000;
  }
  return null;
}

export interface BuildResult {
  data: FloorData;
  /** Rows skipped because they had no SKU and no description. */
  skippedRows: number;
}

/** Location cells sometimes carry several codes ("BW05; EC03"). */
function splitLocationCell(cell: string): string[] {
  return cell
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

export function buildFloorData(grid: string[][], cols: ColumnMap, fileName: string): BuildResult {
  const cell = (row: string[], i: number) => (i >= 0 && i < row.length ? row[i] : '');
  const skus: SkuRecord[] = [];
  const unmatched = new Map<string, number>();
  let unlocatedRows = 0;
  let skippedRows = 0;
  let blankRows = 0;

  for (const row of grid.slice(1)) {
    const sku = cell(row, cols.sku).trim();
    const desc = cell(row, cols.desc).trim();
    if (sku === '' && desc === '') {
      // Comma-only filler lines aren't data rows at all; rows that carry
      // other values but no SKU/description are reported as skipped.
      if (row.some((c) => c.trim() !== '')) skippedRows++;
      else blankRows++;
      continue;
    }

    const locs: string[] = [];
    let sawCode = false;
    for (const li of cols.locs) {
      for (const code of splitLocationCell(cell(row, li))) {
        sawCode = true;
        const id = resolveLocation(code);
        if (id) {
          if (!locs.includes(id)) locs.push(id);
        } else {
          const key = code.toUpperCase();
          unmatched.set(key, (unmatched.get(key) ?? 0) + 1);
        }
      }
    }
    if (!sawCode) unlocatedRows++;

    skus.push({
      sku,
      desc,
      locs,
      qoh: parseNumber(cell(row, cols.qoh)),
      cost: parseNumber(cell(row, cols.cost)),
      retail: parseNumber(cell(row, cols.retail)),
      sold: parseNumber(cell(row, cols.sold)),
      datePhys: cols.datePhys >= 0 ? parseDate(cell(row, cols.datePhys)) : null,
      dateSale: cols.dateSale >= 0 ? parseDate(cell(row, cols.dateSale)) : null,
      dateReceipt: cols.dateReceipt >= 0 ? parseDate(cell(row, cols.dateReceipt)) : null,
    });
  }

  const unmatchedList: UnmatchedLocation[] = [...unmatched.entries()]
    .map(([code, rows]) => ({ code, rows }))
    .sort((a, b) => b.rows - a.rows || a.code.localeCompare(b.code));

  return {
    data: {
      fileName,
      importedAt: Date.now(),
      rowCount: Math.max(0, grid.length - 1 - blankRows),
      totalSkus: skus.length,
      // A 100k-row item file is mostly SKUs the map can't paint — keep
      // the doc (and its save file) down to the ones that landed.
      skus: skus.filter((s) => s.locs.length > 0),
      unmatched: unmatchedList,
      unlocatedRows,
    },
    skippedRows,
  };
}

/**
 * The per-fixture index the heatmaps read: fixture id → SKUs stocked
 * there, de-duplicated per fixture by SKU number (the freshest physical
 * date wins when an export repeats a SKU+location pair).
 */
export function indexByFixture(skus: SkuRecord[]): Map<string, SkuRecord[]> {
  const bySku = new Map<string, Map<string, SkuRecord>>();
  for (const rec of skus) {
    for (const loc of rec.locs) {
      let m = bySku.get(loc);
      if (!m) {
        m = new Map();
        bySku.set(loc, m);
      }
      const key = rec.sku || `~${rec.desc}`;
      const prev = m.get(key);
      if (!prev || (rec.datePhys ?? -1) > (prev.datePhys ?? -1)) m.set(key, rec);
    }
  }
  const out = new Map<string, SkuRecord[]>();
  for (const [loc, m] of bySku) out.set(loc, [...m.values()]);
  return out;
}
