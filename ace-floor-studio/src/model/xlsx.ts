// Just-enough .xlsx reader for Compass/Eagle exports: unzip with fflate,
// pull the first worksheet's cells into a string grid. Numbers stay
// numeric strings (Excel date serials included — the Compass date parser
// detects those); shared and inline strings are resolved.
//
// The worksheet and sharedStrings parts of a full item-file export run
// to hundreds of megabytes of XML — a DOMParser round-trip took ~45s on
// a 109k-row store export, so those two parts are read with a hand
// scanner instead (seconds, not minutes). DOMParser still reads the tiny
// workbook/rels files.
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

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isNaN(n) ? m : String.fromCodePoint(n);
    }
    return ENTITIES[code] ?? m;
  });
}

const T_RE = /<t(?:\s[^>]*)?\/>|<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;

/** Concatenate every <t> run inside an <si>/<is> block. */
function gatherT(block: string): string {
  let out = '';
  T_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = T_RE.exec(block))) out += m[1] === undefined ? '' : unescapeXml(m[1]);
  return out;
}

function parseSharedStrings(text: string): string[] {
  const out: string[] = [];
  const re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(gatherT(m[1]));
  return out;
}

const CELL_RE = /<c(\s[^>]*)?\/>|<c(\s[^>]*)?>([\s\S]*?)<\/c>/g;
const V_RE = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/;

function parseSheet(text: string, shared: string[]): string[][] {
  const grid: string[][] = [];
  const rowRe = /<row(?:\s[^>]*)?\/>|<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(text))) {
    const row: string[] = [];
    const inner = rm[1];
    if (inner !== undefined) {
      let cursor = 0;
      CELL_RE.lastIndex = 0;
      let cm: RegExpExecArray | null;
      while ((cm = CELL_RE.exec(inner))) {
        const attrs = cm[1] ?? cm[2] ?? '';
        const body = cm[3] ?? '';
        const ref = /\br="([^"]*)"/.exec(attrs)?.[1];
        const col = ref ? colIndex(ref) : cursor;
        while (row.length < col) row.push('');
        const t = /\bt="([^"]*)"/.exec(attrs)?.[1];
        let value = '';
        if (t === 'inlineStr') {
          value = gatherT(body);
        } else {
          const v = V_RE.exec(body)?.[1] ?? '';
          if (t === 's') value = shared[Number(v)] ?? '';
          else if (t === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
          else value = unescapeXml(v); // n, str, d — keep the raw text
        }
        row[col] = value;
        cursor = col + 1;
      }
    }
    grid.push(row);
  }
  return grid;
}

export function xlsxToGrid(bytes: Uint8Array): string[][] {
  const files = unzipSync(bytes);
  const read = (name: string): string | null => (files[name] ? strFromU8(files[name]) : null);

  const sst = read('xl/sharedStrings.xml');
  const shared = sst ? parseSharedStrings(sst) : [];

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

  const grid = parseSheet(sheet, shared);
  // Trim fully-empty trailing rows Excel likes to leave behind.
  while (grid.length > 0 && grid[grid.length - 1].every((c) => c.trim() === '')) grid.pop();
  return grid;
}
