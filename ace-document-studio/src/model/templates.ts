import { uid } from './blocks';
import type { Block, StudioDoc } from './types';
import { CUSTOMER_KICKER, DEFAULT_KICKER, MEMO_KICKER, SOP_KICKER, emptyFooter } from './types';

// Built-in starting points for the store's document types. "New Document"
// opens a picker over these (plus any templates the user has saved); each
// one lands in the editor ready to edit, no forms first.

export interface BuiltinTemplate {
  id: string;
  name: string;
  tagline: string;
  make(): StudioDoc;
}

function base(kicker: string, subtitle: string, blocks: Block[], typeScale = 100): StudioDoc {
  const now = Date.now();
  return {
    id: uid(),
    title: '',
    kicker,
    subtitle,
    chip: null,
    accent: '#C8102E',
    typeScale,
    footer: emptyFooter(),
    blocks,
    createdAt: now,
    updatedAt: now,
  };
}

function policyOutline(): Block[] {
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

function procedureOutline(): Block[] {
  return [
    { id: uid(), type: 'section', title: 'Purpose' },
    {
      id: uid(),
      type: 'paragraph',
      html: '<strong>What this procedure produces and when to run it.</strong> One or two sentences, plain language.',
      muted: true,
    },
    { id: uid(), type: 'section', title: 'Steps — in order' },
    {
      id: uid(),
      type: 'steps',
      items: [
        'First step — one action per line.',
        'Second step — include where things live and who to ask.',
        'Third step — say what “done” looks like.',
      ],
    },
    { id: uid(), type: 'section', title: 'Before you walk away' },
    {
      id: uid(),
      type: 'checklist',
      items: [
        'Everything put back where it belongs.',
        'Anything unusual written down and passed to a manager.',
      ],
    },
    {
      id: uid(),
      type: 'callout',
      heading: 'If something looks wrong, <span class="hl">stop</span>',
      body: 'Get a manager before continuing — never guess through a procedure.',
    },
  ];
}

function postingOutline(): Block[] {
  return [
    { id: uid(), type: 'header', title: 'What you need to know' },
    {
      id: uid(),
      type: 'paragraph',
      html: 'The message in one or two friendly sentences — big type, readable from a few feet away.',
      muted: false,
    },
    {
      id: uid(),
      type: 'bullets',
      items: ['The first thing customers should know.', 'The second thing — keep each line short.'],
    },
    {
      id: uid(),
      type: 'callout',
      heading: 'Questions? <span class="hl">Ask any associate</span>',
      body: 'We’re happy to help at the front counter or at 610-565-3785.',
    },
  ];
}

function agreementOutline(): Block[] {
  return [
    {
      id: uid(),
      type: 'paragraph',
      html: '<strong>What this agreement covers.</strong> One or two sentences on the equipment, privilege, or responsibility being agreed to.',
      muted: true,
    },
    { id: uid(), type: 'section', title: 'Terms' },
    {
      id: uid(),
      type: 'bullets',
      items: [
        '<strong>The first term</strong> — specific and checkable.',
        '<strong>The second term</strong> — what happens if it isn’t met.',
      ],
    },
    {
      id: uid(),
      type: 'signoff',
      heading: 'Employee Acknowledgment & Agreement',
      body: 'By signing below, I acknowledge that I have read and understand the terms above, and I agree to follow them.',
      lines: [
        { label: 'Employee signature', withDate: true },
        { label: 'Manager signature', withDate: true },
        { label: 'Printed name', withDate: false },
      ],
    },
  ];
}

function memoOutline(): Block[] {
  return [
    { id: uid(), type: 'header', title: 'What changed' },
    {
      id: uid(),
      type: 'paragraph',
      html: '<strong>The change in one sentence.</strong> Then a line or two of context — why, and starting when.',
      muted: true,
    },
    { id: uid(), type: 'header', title: 'What to do' },
    {
      id: uid(),
      type: 'bullets',
      items: ['The first thing that changes day-to-day.', 'Who to ask when something doesn’t fit.'],
    },
  ];
}

function checklistOutline(): Block[] {
  return [
    { id: uid(), type: 'header', title: 'Opening' },
    {
      id: uid(),
      type: 'checklist',
      items: ['First opening task.', 'Second opening task.', 'Third opening task.'],
    },
    { id: uid(), type: 'header', title: 'Closing' },
    {
      id: uid(),
      type: 'checklist',
      items: ['First closing task.', 'Second closing task.'],
    },
  ];
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: 'policy',
    name: 'Policy',
    tagline: 'Numbered sections, badges, the warning callout',
    make: () => base(DEFAULT_KICKER, 'Employee Policy — What this covers', policyOutline()),
  },
  {
    id: 'procedure',
    name: 'Procedure (SOP)',
    tagline: 'Purpose, numbered steps, verify checklist',
    make: () => base(SOP_KICKER, 'Standard Operating Procedure', procedureOutline()),
  },
  {
    id: 'posting',
    name: 'Customer posting',
    tagline: 'Big type, centered, for the sales floor or front door',
    make: () => {
      const doc = base(CUSTOMER_KICKER, 'A Note for Our Customers', postingOutline(), 124);
      doc.docAlign = 'center';
      return doc;
    },
  },
  {
    id: 'agreement',
    name: 'Agreement',
    tagline: 'Terms plus the signature block',
    make: () => base(DEFAULT_KICKER, 'Employee Agreement', agreementOutline()),
  },
  {
    id: 'memo',
    name: 'Memo',
    tagline: 'What changed and what to do',
    make: () => base(MEMO_KICKER, 'Internal Memo', memoOutline()),
  },
  {
    id: 'checklist',
    name: 'Checklist sheet',
    tagline: 'Print-and-tick opening / closing lists',
    make: () => base(DEFAULT_KICKER, 'Daily Checklist', checklistOutline()),
  },
  {
    id: 'blank',
    name: 'Blank',
    tagline: 'Just the title header — build it up yourself',
    make: () => base(DEFAULT_KICKER, 'What this document covers', []),
  },
];

/** The historical "New Document" shape — the policy outline. */
export function newDocument(): StudioDoc {
  return BUILTIN_TEMPLATES[0].make();
}

/** A fresh document created from any existing document or template body. */
export function documentFromTemplate(src: StudioDoc): StudioDoc {
  const doc = structuredClone(src);
  doc.id = uid();
  doc.createdAt = Date.now();
  doc.updatedAt = Date.now();
  return doc;
}
