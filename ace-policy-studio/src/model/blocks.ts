import type { Block, BlockType } from './types';

export function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export const BLOCK_LABELS: Record<BlockType, string> = {
  section: 'Section header',
  paragraph: 'Paragraph',
  badgeRow: 'Badge row',
  bullets: 'Bullet list',
  steps: 'Step list',
  checklist: 'Checklist',
  callout: 'Callout box',
  table: 'Table',
  signoff: 'Sign-off lines',
  image: 'Image',
};

export function newBlock(type: BlockType): Block {
  const id = uid();
  switch (type) {
    case 'section':
      return { id, type, title: 'New section' };
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
        heading: 'Employee acknowledgment',
        rows: 5,
      };
    case 'image':
      return { id, type, src: '', caption: '', widthPct: 60 };
  }
}

export function cloneBlock(block: Block): Block {
  const copy = structuredClone(block) as Block;
  copy.id = uid();
  return copy;
}

// Auto-numbering: a section's number is its position among section blocks.
export function sectionNumber(blocks: Block[], index: number): number {
  let n = 0;
  for (let i = 0; i <= index; i++) {
    if (blocks[i].type === 'section') n++;
  }
  return n;
}
