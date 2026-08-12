// Just-enough .xlsx reader for Compass exports: unzip with fflate, pull
// the first worksheet's cells into a string grid. Numbers stay numeric
// strings (Excel date serials included — the Compass date parser detects
// those); shared and inline strings are resolved.
import { strFromU8, unzipSync } from 'fflate';

const XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"
const XLS_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]; // legacy BIFF compound file

export type SheetFormat = 'xlsx' | 'xls' | 'text';

export function sniffFormat(bytes: Uint8Array): SheetFormat {
  const startsWith = (magic: number[]) => magic.every((b, i) => bytes[i] === b);
  if (startsWith(XLSX_MAGIC)) return 'xlsx';
  if (startsWith(XLS_MAGIC)) return 'xls';
  return 'text';
}

function xml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}

/** "B7" → 1 (zero-based column index). */
function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    if (ch < 'A' || ch > 'Z') break;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

function textOf(el: Element): string {
  // An <si> can be a plain <t> or a run of <r><t> pieces.
  let out = '';
  for (const t of el.getElementsByTagName('t')) out += t.textContent ?? '';
  return out;
}

export function xlsxToGrid(bytes: Uint8Array): string[][] {
  const files = unzipSync(bytes);
  const read = (name: string): string | null => (files[name] ? strFromU8(files[name]) : null);

  const shared: string[] = [];
  const sst = read('xl/sharedStrings.xml');
  if (sst) {
    for (const si of xml(sst).getElementsByTagName('si')) shared.push(textOf(si));
  }

  // First sheet in workbook order; fall back to the conventional path.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = read('xl/workbook.xml');
  const rels = read('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const sheet = xml(wb).getElementsByTagName('sheet')[0];
    const rid =
      sheet?.getAttribute('r:id') ??
      Array.from(sheet?.attributes ?? []).find((a) => a.localName === 'id')?.value;
    if (rid) {
      for (const rel of xml(rels).getElementsByTagName('Relationship')) {
        if (rel.getAttribute('Id') === rid) {
          const target = rel.getAttribute('Target') ?? '';
          sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
        }
      }
    }
  }

  const sheet = read(sheetPath);
  if (!sheet) throw new Error('No worksheet found in the workbook.');

  const grid: string[][] = [];
  for (const rowEl of xml(sheet).getElementsByTagName('row')) {
    const row: string[] = [];
    let cursor = 0;
    for (const c of rowEl.getElementsByTagName('c')) {
      const ref = c.getAttribute('r');
      const col = ref ? colIndex(ref) : cursor;
      while (row.length < col) row.push('');
      const t = c.getAttribute('t');
      let value = '';
      if (t === 'inlineStr') {
        value = textOf(c);
      } else {
        const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
        if (t === 's') value = shared[Number(v)] ?? '';
        else if (t === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
        else value = v; // n, str, d — keep the raw text
      }
      row[col] = value;
      cursor = col + 1;
    }
    grid.push(row);
  }
  // Trim fully-empty trailing rows Excel likes to leave behind.
  while (grid.length > 0 && grid[grid.length - 1].every((c) => c.trim() === '')) grid.pop();
  return grid;
}
