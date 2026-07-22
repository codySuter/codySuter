import { newBlock, uid } from './blocks';
import type { Block, BrandChip, PolicyDoc } from './types';
import { CUSTOMER_KICKER, DEFAULT_KICKER, SOP_KICKER } from './types';

export type TemplateKind = 'policy' | 'sop' | 'customer';

export interface TemplateSection {
  key: string;
  label: string;
  hint: string;
  recommended: boolean;
  build: () => Block[];
}

export interface WizardAnswers {
  kind: TemplateKind;
  title: string;
  subtitle: string;
  accent: string;
  chip: BrandChip | null;
  sectionKeys: string[];
}

const b = {
  section(title: string): Block {
    return { id: uid(), type: 'section', title };
  },
  para(html: string, muted = false): Block {
    return { id: uid(), type: 'paragraph', html, muted };
  },
  badge(badge: string, html: string, badgeColor: 'accent' | 'ink' = 'accent'): Block {
    return { id: uid(), type: 'badgeRow', badge, badgeColor, html };
  },
  bullets(items: string[]): Block {
    return { id: uid(), type: 'bullets', items };
  },
  steps(items: string[]): Block {
    return { id: uid(), type: 'steps', items };
  },
  checklist(items: string[]): Block {
    return { id: uid(), type: 'checklist', items };
  },
  callout(heading: string, body: string): Block {
    return { id: uid(), type: 'callout', heading, body };
  },
};

export const TEMPLATE_META: Record<
  TemplateKind,
  { label: string; description: string; kicker: string; subtitlePlaceholder: string }
> = {
  policy: {
    label: 'Employee policy',
    description:
      'The format of your Grill, STIHL, and Pickup docs — numbered sections, badge rows, and a warning callout.',
    kicker: DEFAULT_KICKER,
    subtitlePlaceholder: 'Employee Policy — Scope of this document',
  },
  sop: {
    label: 'Procedure (SOP)',
    description:
      'A task walkthrough: purpose, before-you-start checklist, numbered steps, common mistakes.',
    kicker: SOP_KICKER,
    subtitlePlaceholder: 'Standard Procedure — Task name',
  },
  customer: {
    label: 'Customer posting',
    description:
      'Customer-facing: bigger type, friendlier wording, no internal details. Great for counter and door postings.',
    kicker: CUSTOMER_KICKER,
    subtitlePlaceholder: 'What customers need to know',
  },
};

export const TEMPLATE_SECTIONS: Record<TemplateKind, TemplateSection[]> = {
  policy: [
    {
      key: 'overview',
      label: 'When this applies',
      hint: 'Opens the doc: who this is for and when it kicks in.',
      recommended: true,
      build: () => [
        b.section('When this applies'),
        b.para(
          '<strong style="color: #20242B;">Start with the rule that matters most.</strong> One or two sentences on when this policy applies and what the employee should do first.',
          true,
        ),
      ],
    },
    {
      key: 'requirements',
      label: 'Requirements (badge rows)',
      hint: 'The must-hit conditions, each with a red badge.',
      recommended: true,
      build: () => [
        b.section('Requirements — check every one'),
        b.badge('FIRST', '<strong>The first requirement</strong> — what qualifies and what to do when it doesn’t.'),
        b.badge('SECOND', '<strong>The second requirement</strong> — keep each one checkable at a glance.'),
        b.badge('MANAGER', 'If any requirement fails, get a <strong>manager</strong> — never guess.', 'ink'),
      ],
    },
    {
      key: 'record',
      label: 'What to record',
      hint: 'Square-bullet list of what goes on every order/ticket.',
      recommended: true,
      build: () => [
        b.section('What to record — every time'),
        b.bullets([
          '<strong>Customer name and phone number</strong> on the order.',
          '<strong>The specifics</strong> — model numbers matter; vague notes stall the process.',
          '<strong>Who approved it</strong> when a manager signs off on an exception.',
        ]),
      ],
    },
    {
      key: 'callout',
      label: 'Warning callout',
      hint: 'The dark box with the one rule nobody gets to miss.',
      recommended: true,
      build: () => [
        b.callout(
          'Never promise what we can’t <span class="hl">guarantee</span>',
          'One or two sentences of context: why the rule exists, and what to tell the customer instead.',
        ),
      ],
    },
    {
      key: 'filing',
      label: 'After the sale — filing & follow-up',
      hint: 'Where paperwork goes and who follows up.',
      recommended: false,
      build: () => [
        b.section('After the sale — filing & follow-up'),
        b.bullets([
          '<strong>Printed invoice</strong> goes in the folder behind the register.',
          '<strong>Set expectations:</strong> we contact the customer when it’s ready.',
        ]),
      ],
    },
    {
      key: 'escalation',
      label: 'Questions & escalation',
      hint: 'The standard closer from your current docs.',
      recommended: true,
      build: () => [
        b.section('Questions & escalation'),
        b.para(
          'Unsure about a special situation? Ask a <strong>manager</strong>. Do not guess on pricing, dates, or exceptions.',
        ),
      ],
    },
  ],
  sop: [
    {
      key: 'purpose',
      label: 'Purpose',
      hint: 'One sentence on what this procedure accomplishes.',
      recommended: true,
      build: () => [
        b.section('Purpose'),
        b.para(
          '<strong style="color: #20242B;">What this procedure accomplishes and when to run it.</strong> Keep it to a sentence or two.',
          true,
        ),
      ],
    },
    {
      key: 'before',
      label: 'Before you start',
      hint: 'Checklist of prerequisites.',
      recommended: true,
      build: () => [
        b.section('Before you start'),
        b.checklist([
          'What you need in hand before step 1.',
          'Anything to verify in POS or on the floor.',
        ]),
      ],
    },
    {
      key: 'steps',
      label: 'The steps',
      hint: 'Numbered walkthrough — one action per line.',
      recommended: true,
      build: () => [
        b.section('The steps'),
        b.steps([
          'First action — start where the task starts.',
          'Second action — include the screen, key, or location.',
          'Third action — say what “done” looks like.',
        ]),
      ],
    },
    {
      key: 'mistakes',
      label: 'Common mistakes',
      hint: 'Square bullets on what trips people up.',
      recommended: false,
      build: () => [
        b.section('Common mistakes'),
        b.bullets([
          '<strong>The most common miss</strong> — and how to avoid it.',
        ]),
      ],
    },
    {
      key: 'callout',
      label: 'Warning callout',
      hint: 'The dark box for the step that must never be skipped.',
      recommended: true,
      build: () => [
        b.callout(
          'The step people <span class="hl">skip — don’t</span>',
          'Why it matters and what happens when it’s missed.',
        ),
      ],
    },
    {
      key: 'escalation',
      label: 'Questions & escalation',
      hint: 'The standard closer.',
      recommended: true,
      build: () => [
        b.section('Questions & escalation'),
        b.para(
          'Stuck partway through, or something doesn’t match this page? Ask a <strong>manager</strong> before improvising.',
        ),
      ],
    },
  ],
  customer: [
    {
      key: 'intro',
      label: 'The short version',
      hint: 'A warm two-sentence opener.',
      recommended: true,
      build: () => [
        b.section('The short version'),
        b.para(
          'Lead with what your neighbor needs to know — friendly, direct, and free of store jargon.',
        ),
      ],
    },
    {
      key: 'how',
      label: 'How it works',
      hint: 'Three numbered steps from the customer’s side.',
      recommended: true,
      build: () => [
        b.section('How it works'),
        b.steps([
          'What happens first.',
          'What we take care of for you.',
          'How you’ll know it’s ready.',
        ]),
      ],
    },
    {
      key: 'details',
      label: 'The details',
      hint: 'Square bullets: timing, pricing, fine print.',
      recommended: true,
      build: () => [
        b.section('The details'),
        b.bullets([
          '<strong>Timing</strong> — when to expect it.',
          '<strong>Payment</strong> — what’s due and when.',
        ]),
      ],
    },
    {
      key: 'callout',
      label: 'Highlight box',
      hint: 'The dark box for the one thing to remember.',
      recommended: false,
      build: () => [
        b.callout(
          'Good to know: <span class="hl">the one thing to remember</span>',
          'A friendly line about the detail customers ask about most.',
        ),
      ],
    },
    {
      key: 'ask',
      label: 'Questions? Just ask.',
      hint: 'A neighborly closer.',
      recommended: true,
      build: () => [
        b.section('Questions? Just ask.'),
        b.para(
          'Any red vest can help — and if we don’t know the answer, we’ll find the person who does.',
        ),
      ],
    },
  ],
};

export function generateDoc(answers: WizardAnswers): PolicyDoc {
  const meta = TEMPLATE_META[answers.kind];
  const sections = TEMPLATE_SECTIONS[answers.kind];
  const chosen = sections.filter((s) => answers.sectionKeys.includes(s.key));
  const now = Date.now();
  return {
    id: uid(),
    title: answers.title.trim() || 'Untitled document',
    kicker: meta.kicker,
    subtitle: answers.subtitle.trim() || meta.subtitlePlaceholder,
    chip: answers.chip,
    accent: answers.accent,
    audience: answers.kind === 'customer' ? 'customer' : 'employee',
    blocks: chosen.flatMap((s) => s.build()),
    createdAt: now,
    updatedAt: now,
  };
}

export { newBlock };
