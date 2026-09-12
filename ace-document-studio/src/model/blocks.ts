import type { Block, BlockType } from './types';

export function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export const BLOCK_LABELS: Record<BlockType, string> = {
  section: 'Numbered section',
  header: 'Header (no number)',
  paragraph: 'Paragraph',
  badgeRow: 'Badge row',
  bullets: 'Bullet list',
  steps: 'Step list',
  checklist: 'Checklist',
  callout: 'Callout box',
  table: 'Table',
  signoff: 'Signature block',
  image: 'Image',
  columns: 'Two columns',
  pageBreak: 'Page break',
};

export function newBlock(type: BlockType): Block {
  const id = uid();
  switch (type) {
    case 'section':
      return { id, type, title: 'New section' };
    case 'header':
      return { id, type, title: 'New header' };
    case 'paragraph':
      return {
        id,
        type,
        html: 'Write it plainly — what the reader needs to know, in a sentence or two.',
        muted: false,
      };
    case 'badgeRow':
      return {
        id,
        type,
        badge: 'LABEL',
        badgeColor: 'accent',
        html: '<strong>The rule in bold up front.</strong> Then the detail that backs it up.',
      };
    case 'bullets':
      return {
        id,
        type,
        items: ['<strong>First point</strong> — keep each one short and specific.'],
      };
    case 'steps':
      return {
        id,
        type,
        items: ['First step — one action per line.'],
      };
    case 'checklist':
      return {
        id,
        type,
        items: ['Something to verify before moving on.'],
      };
    case 'callout':
      return {
        id,
        type,
        heading: 'The one rule <span class="hl">nobody gets to miss</span>',
        body: 'One or two sentences of context: why the rule exists and what to do instead.',
      };
    case 'table':
      return {
        id,
        type,
        header: ['Item', 'Detail'],
        rows: [
          ['', ''],
          ['', ''],
        ],
      };
    case 'signoff':
      return {
        id,
        type,
        heading: 'Employee Acknowledgment & Agreement',
        body: 'By signing below, I acknowledge that I have read and understand the policy above, and I agree to follow it.',
        lines: [
          { label: 'Employee signature', withDate: true },
          { label: 'Manager signature', withDate: true },
        ],
      };
    case 'image':
      return { id, type, src: '', caption: '', widthPct: 60 };
    case 'pageBreak':
      return { id, type };
    case 'columns':
      return {
        id,
        type,
        ratio: 50,
        left: {
          heading: 'Left column',
          blocks: [
            {
              id: uid(),
              type: 'paragraph',
              html: 'Click to edit — use the buttons under this column to add lists.',
              muted: false,
            },
          ],
        },
        right: {
          heading: 'Right column',
          blocks: [
            {
              id: uid(),
              type: 'paragraph',
              html: 'Two columns are great for DO / DON’T lists or side-by-side steps.',
              muted: false,
            },
          ],
        },
      };
  }
}

export function cloneBlock(block: Block): Block {
  const copy = structuredClone(block) as Block;
  copy.id = uid();
  if (copy.type === 'columns') {
    for (const side of [copy.left, copy.right]) {
      side.blocks = side.blocks.map((b) => cloneBlock(b));
    }
  }
  return copy;
}

// ---- deep helpers (columns hold nested child blocks) ----

/** Every array that directly contains blocks: the top level plus each column. */
export function blockArrays(doc: { blocks: Block[] }): Block[][] {
  const arrays: Block[][] = [doc.blocks];
  for (const b of doc.blocks) {
    if (b.type === 'columns') {
      arrays.push(b.left.blocks, b.right.blocks);
    }
  }
  return arrays;
}

export function findBlockDeep(doc: { blocks: Block[] }, id: string): Block | undefined {
  for (const arr of blockArrays(doc)) {
    const hit = arr.find((b) => b.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/** The array containing the block with this id, or undefined. */
export function containerOf(doc: { blocks: Block[] }, id: string): Block[] | undefined {
  return blockArrays(doc).find((arr) => arr.some((b) => b.id === id));
}

/** Index of the top-level block that is — or contains — this id. */
export function topLevelIndexOf(doc: { blocks: Block[] }, id: string): number {
  return doc.blocks.findIndex(
    (b) =>
      b.id === id ||
      (b.type === 'columns' &&
        (b.left.blocks.some((c) => c.id === id) || b.right.blocks.some((c) => c.id === id))),
  );
}

// Auto-numbering: a section's number is its position among section blocks.
export function sectionNumber(blocks: Block[], index: number): number {
  let n = 0;
  for (let i = 0; i <= index; i++) {
    if (blocks[i].type === 'section') n++;
  }
  return n;
}
