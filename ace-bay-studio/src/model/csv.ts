import type { BinItem } from './types';
import { uid } from './layout';
import { parseDateLoose } from './freshness';

// Contents import: one row per item, first column says which location
// (OPTI number or sales-floor aisle code) it lives in. Header row
// optional. Headers straight out of an Epicor Compass / Eagle inventory
// query work as-is — Location, Item Description, QOH, Date Last
// Physical etc. are all recognized:
//   opti,item,qty,sku,last_physical,note
//   82,Traeger pellet grill,2,1004114,03/12/2026,display return
//   Location,Item Description,QOH,SKU,Date Last Physical      (Compass)

export interface CsvRow {
  optiLabel: string;
  item: BinItem;
}

export interface CsvParseResult {
  rows: CsvRow[];
  skipped: number;
}

/** RFC-4180-ish parser: quoted fields, embedded commas/quotes/newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    if (row.length > 1 || row[0].trim() !== '') rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      pushRow();
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

// Column-name aliases, ours first, then what Epicor Compass / Eagle
// inventory queries actually put in their header rows.
const COLS = {
  opti: ['opti', 'opti #', 'bin', 'container', 'label', 'location', 'loc', 'loc code', 'location code', 'bin location'],
  item: ['item', 'name', 'description', 'product', 'item description', 'desc'],
  qty: ['qty', 'quantity', 'count', 'qoh', 'on hand', 'on-hand', 'qty on hand', 'quantity on hand', 'oh'],
  sku: ['sku', 'sku #', 'item #', 'item no', 'item no.', 'item number', 'upc'],
  note: ['note', 'notes', 'comment'],
  lastPhysical: [
    'last_physical',
    'last physical',
    'date last physical',
    'last physical date',
    'dlp',
    'last count',
    'last counted',
    'date of last physical',
    'phys date',
    'physical date',
  ],
};
const HEADER_HINTS = new Set(Object.values(COLS).flat());

/** Column order when there is no header: opti, item, qty, sku, note, last physical. */
export function csvToRows(text: string): CsvParseResult {
  const raw = parseCsv(text);
  if (raw.length === 0) return { rows: [], skipped: 0 };

  let cols = { opti: 0, item: 1, qty: 2, sku: 3, note: 4, lastPhysical: 5 };
  let start = 0;
  const first = raw[0].map((c) => c.trim().toLowerCase());
  const isHeader = first.some((c) => HEADER_HINTS.has(c));
  if (isHeader) {
    start = 1;
    const at = (names: string[]) => first.findIndex((c) => names.includes(c));
    cols = {
      opti: Math.max(at(COLS.opti), 0),
      item: at(COLS.item),
      qty: at(COLS.qty),
      sku: at(COLS.sku),
      note: at(COLS.note),
      lastPhysical: at(COLS.lastPhysical),
    };
    if (cols.item < 0) cols.item = cols.opti === 0 ? 1 : 0;
  }

  const rows: CsvRow[] = [];
  let skipped = 0;
  for (const r of raw.slice(start)) {
    const cell = (i: number) => (i >= 0 && i < r.length ? r[i].trim() : '');
    const optiLabel = cell(cols.opti);
    const name = cell(cols.item);
    if (!optiLabel || !name) {
      skipped++;
      continue;
    }
    const rawDate = cell(cols.lastPhysical);
    rows.push({
      optiLabel,
      item: {
        id: uid('item'),
        name,
        qty: cell(cols.qty),
        sku: cell(cols.sku),
        note: cell(cols.note),
        // Normalized to ISO when the format is recognized; kept raw
        // otherwise so nothing typed in Compass is silently dropped.
        lastPhysical: parseDateLoose(rawDate) || rawDate,
      },
    });
  }
  return { rows, skipped };
}

export const CSV_TEMPLATE =
  'opti,item,qty,sku,last_physical,note\n' +
  '82,Example item name,2,1234567,03/12/2026,optional note\n' +
  '82,Second item in the same OPTI,1,,,\n' +
  '65,Item in a different OPTI,4,7654321,2026-01-05,\n';
