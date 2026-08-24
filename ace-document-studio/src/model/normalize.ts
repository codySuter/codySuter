import type { Block, StudioDoc, SignoffBlock, TableBlock } from './types';
import {
  ALIGNABLE_TYPES,
  BLOCK_ALIGNS,
  emptyFooter,
  FOOTER_FIELDS,
  MIN_TABLE_COL_PCT,
  TYPE_SCALE_MAX,
  TYPE_SCALE_MIN,
} from './types';
import { clampSpaceBefore } from './docstyle';
import { sanitizeHtml } from './sanitize';
import { docSlots } from './slots';

function normalizeTableShape(b: TableBlock): void {
  const cols = b.header.length;
  if (b.aligns !== undefined) {
    if (!Array.isArray(b.aligns)) {
      delete b.aligns;
    } else {
      b.aligns = Array.from({ length: cols }, (_x, c) =>
        BLOCK_ALIGNS.includes(b.aligns![c]) ? b.aligns![c] : 'left',
      );
      if (b.aligns.every((a) => a === 'left')) delete b.aligns;
    }
  }
  if (b.widths !== undefined) {
    const ok =
      Array.isArray(b.widths) &&
      b.widths.length === cols &&
      b.widths.every((w) => typeof w === 'number' && Number.isFinite(w) && w > 0);
    if (!ok) {
      delete b.widths;
    } else {
      // Re-normalize to percentages that sum to 100, respecting the minimum.
      const sum = b.widths!.reduce((a, w) => a + w, 0);
      b.widths = b.widths!.map((w) =>
        Math.max(MIN_TABLE_COL_PCT, Math.round((w / sum) * 1000) / 10),
      );
    }
  }
}

function normalizeBlock(block: Block): void {
  if (block.spaceBefore == null || Number.isNaN(block.spaceBefore)) {
    delete block.spaceBefore;
  } else {
    block.spaceBefore = clampSpaceBefore(block.spaceBefore);
    if (block.spaceBefore === 0) delete block.spaceBefore;
  }
  // An explicit 'left' stays: it overrides a centered document default.
  if (block.align !== undefined) {
    if (!BLOCK_ALIGNS.includes(block.align) || !ALIGNABLE_TYPES.includes(block.type)) {
      delete block.align;
    }
  }
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
  if (block.type === 'table') normalizeTableShape(block);
  if (block.type === 'columns') {
    block.ratio = Math.min(70, Math.max(30, Math.round(block.ratio || 50)));
    for (const side of [block.left, block.right]) {
      if (typeof side.heading !== 'string') side.heading = '';
      if (!Array.isArray(side.blocks)) side.blocks = [];
      for (const child of side.blocks) normalizeBlock(child);
    }
  }
}

// Upgrades documents saved by older versions in place:
// - audience ('employee' | 'customer') → typeScale (% slider)
// - signoff { rows: N } → signoff { body, lines: [...] } (radio-contract style)
// - missing footer (pre-1.3) → hidden metadata footer
// - clamps any per-block spaceBefore nudge / align value (drops garbage)
// - clamps headerAt (blocks placed above the title header) into range
// Then sanitizes every rich-text slot, so a hand-edited or imported file
// can never inject markup beyond the formatting the documents use.
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

  if (!Array.isArray(doc.blocks)) doc.blocks = [];
  for (const block of doc.blocks) normalizeBlock(block);

  if (typeof doc.headerAt !== 'number' || !Number.isInteger(doc.headerAt)) {
    delete doc.headerAt;
  } else {
    doc.headerAt = Math.max(0, Math.min(doc.blocks.length, doc.headerAt));
    if (doc.headerAt === 0) delete doc.headerAt;
  }

  // headerAlign 'left' stays (it can override a centered docAlign);
  // docAlign 'left' is the default and stores as absent.
  if (doc.headerAlign !== undefined && !BLOCK_ALIGNS.includes(doc.headerAlign)) {
    delete doc.headerAlign;
  }
  if (
    doc.docAlign !== undefined &&
    (!BLOCK_ALIGNS.includes(doc.docAlign) || doc.docAlign === 'left')
  ) {
    delete doc.docAlign;
  }

  // Imported/hand-edited files go through the same HTML allowlist as
  // in-editor edits (bold, italics, <br>, the yellow highlight span).
  for (const slot of docSlots(doc)) {
    const raw = slot.get();
    if (typeof raw !== 'string') slot.set('');
    else if (/[<>]/.test(raw)) slot.set(sanitizeHtml(raw));
  }
  return doc;
}
