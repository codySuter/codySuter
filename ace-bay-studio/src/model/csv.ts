import type { BinItem } from './types';
import { uid } from './layout';

// Contents import: one row per item, first column says which OPTI it
// lives in. Header row optional; extra columns are kept as the note.
//   opti,item,qty,sku,note
//   82,Traeger pellet grill,2,1004114,display return
//   82,Char-Broil 4-burner,1,8069731,

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

const HEADER_HINTS = ['opti', 'bin', 'container', 'label', 'item', 'name', 'description', 'qty', 'quantity', 'sku', 'note'];

/** Column order when there is no header: opti, item, qty, sku, note. */
export function csvToRows(text: string): CsvParseResult {
  const raw = parseCsv(text);
  if (raw.length === 0) return { rows: [], skipped: 0 };

  let cols = { opti: 0, item: 1, qty: 2, sku: 3, note: 4 };
  let start = 0;
  const first = raw[0].map((c) => c.trim().toLowerCase());
  const isHeader = first.some((c) => HEADER_HINTS.includes(c));
  if (isHeader) {
    start = 1;
    const at = (...names: string[]) => {
      const i = first.findIndex((c) => names.includes(c));
      return i;
    };
    cols = {
      opti: Math.max(at('opti', 'opti #', 'bin', 'container', 'label'), 0),
      item: at('item', 'name', 'description', 'product'),
      qty: at('qty', 'quantity', 'count'),
      sku: at('sku', 'sku #', 'item #', 'upc'),
      note: at('note', 'notes', 'comment'),
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
    rows.push({
      optiLabel,
      item: { id: uid('item'), name, qty: cell(cols.qty), sku: cell(cols.sku), note: cell(cols.note) },
    });
  }
  return { rows, skipped };
}

export const CSV_TEMPLATE =
  'opti,item,qty,sku,note\n' +
  '82,Example item name,2,1234567,optional note\n' +
  '82,Second item in the same OPTI,1,,\n' +
  '65,Item in a different OPTI,4,7654321,\n';
