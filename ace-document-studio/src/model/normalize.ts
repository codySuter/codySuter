import type { StudioDoc, SignoffBlock } from './types';
import { emptyFooter, FOOTER_FIELDS, TYPE_SCALE_MAX, TYPE_SCALE_MIN } from './types';

// Upgrades documents saved by older versions in place:
// - audience ('employee' | 'customer') → typeScale (% slider)
// - signoff { rows: N } → signoff { body, lines: [...] } (radio-contract style)
// - missing footer (pre-1.3) → hidden metadata footer
export function normalizeDoc(doc: StudioDoc): StudioDoc {
  if (typeof doc.typeScale !== 'number' || Number.isNaN(doc.typeScale)) {
    doc.typeScale = doc.audience === 'customer' ? 116 : 100;
  }
  doc.typeScale = Math.min(TYPE_SCALE_MAX, Math.max(TYPE_SCALE_MIN, Math.round(doc.typeScale)));

  if (!doc.footer || typeof doc.footer !== 'object') {
    doc.footer = emptyFooter();
  } else {
    doc.footer.show = !!doc.footer.show;
    for (const [key] of FOOTER_FIELDS) {
      if (typeof doc.footer[key] !== 'string') doc.footer[key] = '';
    }
  }

  for (const block of doc.blocks ?? []) {
    if (block.type === 'signoff') {
      const b = block as SignoffBlock;
      if (!Array.isArray(b.lines)) {
        const n = Math.max(1, Math.min(20, typeof b.rows === 'number' ? b.rows : 2));
        b.lines = Array.from({ length: n }, () => ({
          label: 'Employee signature',
          withDate: true,
        }));
      }
      if (typeof b.body !== 'string') b.body = '';
      delete b.rows;
    }
    if (block.type === 'columns') {
      block.ratio = Math.min(70, Math.max(30, Math.round(block.ratio || 50)));
      for (const side of [block.left, block.right]) {
        if (typeof side.heading !== 'string') side.heading = '';
        if (!Array.isArray(side.blocks)) side.blocks = [];
      }
    }
  }
  return doc;
}
