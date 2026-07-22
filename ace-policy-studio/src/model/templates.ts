import { uid } from './blocks';
import type { Block, PolicyDoc } from './types';
import { DEFAULT_KICKER } from './types';

// "New Document" goes straight into the editor with this ready-to-edit
// outline — the store's standard employee-policy shape. No wizard.

function defaultOutline(): Block[] {
  return [
    { id: uid(), type: 'section', title: 'When this applies' },
    {
      id: uid(),
      type: 'paragraph',
      html: '<strong>Start with the rule that matters most.</strong> One or two sentences on when this policy applies and what the employee should do first.',
      muted: true,
    },
    { id: uid(), type: 'section', title: 'Requirements — check every one' },
    {
      id: uid(),
      type: 'badgeRow',
      badge: 'FIRST',
      badgeColor: 'accent',
      html: '<strong>The first requirement</strong> — what qualifies and what to do when it doesn’t.',
    },
    {
      id: uid(),
      type: 'badgeRow',
      badge: 'MANAGER',
      badgeColor: 'ink',
      html: 'If any requirement fails, get a <strong>manager</strong> — never guess.',
    },
    { id: uid(), type: 'section', title: 'What to record — every time' },
    {
      id: uid(),
      type: 'bullets',
      items: [
        '<strong>Customer name and phone number</strong> on the order.',
        '<strong>The specifics</strong> — model numbers matter; vague notes stall the process.',
      ],
    },
    {
      id: uid(),
      type: 'callout',
      heading: 'The one rule <span class="hl">nobody gets to miss</span>',
      body: 'One or two sentences of context: why the rule exists and what to do instead.',
    },
    { id: uid(), type: 'section', title: 'Questions & escalation' },
    {
      id: uid(),
      type: 'paragraph',
      html: 'Unsure about a special situation? Ask a <strong>manager</strong>. Do not guess on pricing, dates, or exceptions.',
      muted: false,
    },
  ];
}

export function newDocument(): PolicyDoc {
  const now = Date.now();
  return {
    id: uid(),
    title: '',
    kicker: DEFAULT_KICKER,
    subtitle: 'Employee Policy — What this covers',
    chip: null,
    accent: '#C8102E',
    typeScale: 100,
    blocks: defaultOutline(),
    createdAt: now,
    updatedAt: now,
  };
}
