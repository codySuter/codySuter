import type { StudioDoc } from './types';
import { docSlots } from './slots';

// Find & replace over the document's text slots. Matching and replacing
// operate on the TEXT NODES of each slot's HTML (case-insensitive), so
// tags and attributes are never touched and never match.

export interface FindMatch {
  slotKey: string;
  blockId: string | null;
  /** Which occurrence within the slot (0-based). */
  occurrence: number;
}

function textOf(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
}

function countOccurrences(text: string, query: string): number {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return 0;
  let n = 0;
  let i = t.indexOf(q);
  while (i !== -1) {
    n++;
    i = t.indexOf(q, i + q.length);
  }
  return n;
}

/** Every match of `query` in the document, in reading order. */
export function findMatches(doc: StudioDoc, query: string): FindMatch[] {
  const q = query.trim();
  if (!q) return [];
  const out: FindMatch[] = [];
  for (const slot of docSlots(doc)) {
    const n = countOccurrences(textOf(slot.get()), q);
    for (let occurrence = 0; occurrence < n; occurrence++) {
      out.push({ slotKey: slot.key, blockId: slot.blockId, occurrence });
    }
  }
  return out;
}

// Replaces occurrences of `query` inside the HTML's text nodes. A match
// that spans two text nodes (e.g. across a <strong> boundary) is left
// alone — it still counts in findMatches but can't be replaced cleanly.
function replaceInHtml(
  html: string,
  query: string,
  replacement: string,
  which: 'all' | number,
): { html: string; replaced: number } {
  const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = parsed.body.firstElementChild!;
  const q = query.toLowerCase();
  let seen = 0;
  let replaced = 0;

  const walker = parsed.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  for (const node of textNodes) {
    const text = node.textContent ?? '';
    const lower = text.toLowerCase();
    let i = lower.indexOf(q);
    if (i === -1) continue;
    let out = '';
    let last = 0;
    while (i !== -1) {
      const hit = which === 'all' || seen === which;
      seen++;
      if (hit) {
        out += text.slice(last, i) + replacement;
        last = i + query.length;
        replaced++;
      }
      i = lower.indexOf(q, i + q.length);
    }
    if (last > 0) node.textContent = out + text.slice(last);
    if (which !== 'all' && seen > which) break;
  }
  return { html: root.innerHTML, replaced };
}

/**
 * Replace one match (by slot + occurrence) in place. Returns true if a
 * replacement happened.
 */
export function replaceMatch(
  doc: StudioDoc,
  match: FindMatch,
  query: string,
  replacement: string,
): boolean {
  const slot = docSlots(doc).find((s) => s.key === match.slotKey);
  if (!slot) return false;
  const r = replaceInHtml(slot.get(), query, replacement, match.occurrence);
  if (r.replaced > 0) slot.set(r.html);
  return r.replaced > 0;
}

/** Replace every match in the document. Returns how many were replaced. */
export function replaceAll(doc: StudioDoc, query: string, replacement: string): number {
  const q = query.trim();
  if (!q) return 0;
  let total = 0;
  for (const slot of docSlots(doc)) {
    const r = replaceInHtml(slot.get(), q, replacement, 'all');
    if (r.replaced > 0) {
      slot.set(r.html);
      total += r.replaced;
    }
  }
  return total;
}
