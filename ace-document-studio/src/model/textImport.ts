import { newBlock, uid } from './blocks';
import type { Block } from './types';

// Turns plain pasted text (notes, an old Word policy, an email) into
// document blocks: bullet/numbered/checkbox lines become the matching
// list blocks, ALL-CAPS or colon-terminated lines become section
// headers, everything else becomes paragraphs.

const BULLET_RE = /^\s*(?:[-–—•*·▪◦‣])\s+/;
const STEP_RE = /^\s*\d{1,3}[.)]\s+/;
const CHECK_RE = /^\s*(?:\[[ xX]?\]|☐|❑|□|◻|◽)\s*/;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function looksLikeHeading(line: string): boolean {
  if (line.length > 80) return false;
  if (/[.?!]$/.test(line)) return false;
  if (line.endsWith(':')) return true;
  const letters = line.replace(/[^a-zA-Z]/g, '');
  return letters.length >= 3 && line.length <= 64 && line === line.toUpperCase();
}

export function parseTextToBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  // Held in an object so narrowing survives the flush() closure calls.
  const cur: { list: { type: 'bullets' | 'steps' | 'checklist'; items: string[] } | null } = {
    list: null,
  };

  const flush = () => {
    if (cur.list && cur.list.items.length > 0) {
      blocks.push({ id: uid(), type: cur.list.type, items: cur.list.items });
    }
    cur.list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const listType = CHECK_RE.test(line)
      ? ('checklist' as const)
      : BULLET_RE.test(line)
        ? ('bullets' as const)
        : STEP_RE.test(line)
          ? ('steps' as const)
          : null;
    if (listType) {
      const item = escapeHtml(
        line.replace(listType === 'checklist' ? CHECK_RE : listType === 'bullets' ? BULLET_RE : STEP_RE, '').trim(),
      );
      if (cur.list?.type !== listType) {
        flush();
        cur.list = { type: listType, items: [] };
      }
      cur.list.items.push(item);
      continue;
    }
    flush();
    if (looksLikeHeading(line)) {
      blocks.push({
        id: uid(),
        type: 'section',
        title: escapeHtml(line.replace(/:$/, '').trim()),
      });
    } else {
      const p = newBlock('paragraph');
      if (p.type === 'paragraph') p.html = escapeHtml(line);
      blocks.push(p);
    }
  }
  flush();
  return blocks;
}
