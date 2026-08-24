import type { Block, StudioDoc } from './types';
import { FOOTER_FIELDS } from './types';
import { plainText } from './sanitize';

// A "text slot" is one editable rich-text (or single-line) string in a
// document: the title, a paragraph's html, a table cell, a list item…
// Find & replace, sanitize-on-load, and full-text search all walk the
// same list so no field is ever missed by one of them.

export interface TextSlot {
  /** Stable key: block id (or 'doc') + field path, used to locate matches. */
  key: string;
  /** The block that owns this slot ('doc' fields have no block). */
  blockId: string | null;
  get(): string;
  set(html: string): void;
}

function blockSlots(block: Block, out: TextSlot[]): void {
  const slot = (field: string, get: () => string, set: (h: string) => void) =>
    out.push({ key: `${block.id}:${field}`, blockId: block.id, get, set });

  switch (block.type) {
    case 'section':
    case 'header':
      slot('title', () => block.title, (h) => (block.title = h));
      break;
    case 'paragraph':
      slot('html', () => block.html, (h) => (block.html = h));
      break;
    case 'badgeRow':
      slot('badge', () => block.badge, (h) => (block.badge = h));
      slot('html', () => block.html, (h) => (block.html = h));
      break;
    case 'bullets':
    case 'steps':
    case 'checklist':
      block.items.forEach((_item, i) =>
        slot(`item.${i}`, () => block.items[i], (h) => (block.items[i] = h)),
      );
      break;
    case 'callout':
      slot('heading', () => block.heading, (h) => (block.heading = h));
      slot('body', () => block.body, (h) => (block.body = h));
      break;
    case 'table':
      block.header.forEach((_c, c) =>
        slot(`th.${c}`, () => block.header[c], (h) => (block.header[c] = h)),
      );
      block.rows.forEach((row, r) =>
        row.forEach((_c, c) =>
          slot(`td.${r}.${c}`, () => block.rows[r][c], (h) => (block.rows[r][c] = h)),
        ),
      );
      break;
    case 'signoff':
      slot('heading', () => block.heading, (h) => (block.heading = h));
      slot('body', () => block.body, (h) => (block.body = h));
      block.lines.forEach((_l, i) =>
        slot(`line.${i}`, () => block.lines[i].label, (h) => (block.lines[i].label = h)),
      );
      break;
    case 'image':
      slot('caption', () => block.caption, (h) => (block.caption = h));
      break;
    case 'columns':
      for (const side of ['left', 'right'] as const) {
        const col = block[side];
        out.push({
          key: `${block.id}:${side}.heading`,
          blockId: block.id,
          get: () => col.heading,
          set: (h) => (col.heading = h),
        });
        for (const child of col.blocks) blockSlots(child, out);
      }
      break;
    case 'pageBreak':
      break;
  }
}

/** Every editable text slot in the document, in reading order. */
export function docSlots(doc: StudioDoc): TextSlot[] {
  const out: TextSlot[] = [];
  const docSlot = (field: string, get: () => string, set: (h: string) => void) =>
    out.push({ key: `doc:${field}`, blockId: null, get, set });

  docSlot('kicker', () => doc.kicker, (h) => (doc.kicker = h));
  docSlot('title', () => doc.title, (h) => (doc.title = h));
  docSlot('subtitle', () => doc.subtitle, (h) => (doc.subtitle = h));
  if (doc.chip) {
    docSlot('chip', () => doc.chip!.text, (h) => (doc.chip!.text = h));
  }
  for (const block of doc.blocks) blockSlots(block, out);
  if (doc.footer?.show) {
    for (const [key] of FOOTER_FIELDS) {
      docSlot(`footer.${key}`, () => doc.footer[key], (h) => (doc.footer[key] = h));
    }
  }
  return out;
}

/** All document text as lowercase plain text — powers library search. */
export function docSearchText(doc: StudioDoc): string {
  return docSlots(doc)
    .map((s) => plainText(s.get()))
    .join(' ')
    .toLowerCase();
}
