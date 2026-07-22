// Document model for Ace Policy Studio.
// Blocks mirror the section styles used in the store's existing
// Policy & Procedures documents (claude.ai design project).

export type BadgeColor = 'accent' | 'ink';

export interface SectionBlock {
  id: string;
  type: 'section';
  title: string; // rendered uppercase, auto-numbered by position
}

export interface ParagraphBlock {
  id: string;
  type: 'paragraph';
  html: string;
  muted: boolean; // gray intro text (#4A4F57) with dark <strong>
}

export interface BadgeRowBlock {
  id: string;
  type: 'badgeRow';
  badge: string; // pill label, e.g. "IN STOCK", "$399+"
  badgeColor: BadgeColor;
  html: string;
}

export interface BulletsBlock {
  id: string;
  type: 'bullets';
  items: string[]; // square accent bullets
}

export interface StepsBlock {
  id: string;
  type: 'steps';
  items: string[]; // numbered 1. 2. 3.
}

export interface ChecklistBlock {
  id: string;
  type: 'checklist';
  items: string[]; // empty checkboxes to tick on paper
}

export interface CalloutBlock {
  id: string;
  type: 'callout';
  heading: string; // dark bar; <span class="hl"> renders brand yellow
  body: string;
}

export interface TableBlock {
  id: string;
  type: 'table';
  header: string[];
  rows: string[][];
}

export interface SignLine {
  label: string;
  withDate: boolean; // false = one wide line (e.g. "Assigned Radio Serial #")
}

// Agreement block in the style of the Radio & Scanner Policy Contract:
// heavy top rule, acknowledgment paragraph, sign-above-the-line rows
// with the small uppercase label under each line and a date column.
export interface SignoffBlock {
  id: string;
  type: 'signoff';
  heading: string;
  body: string; // acknowledgment paragraph
  lines: SignLine[];
  /** @deprecated pre-1.1 field; normalizeDoc converts it into `lines`. */
  rows?: number;
}

export interface ColumnContent {
  heading: string; // optional mini-heading (hidden when empty)
  blocks: Block[]; // paragraph / bullets / steps / checklist only
}

export interface ColumnsBlock {
  id: string;
  type: 'columns';
  ratio: number; // left column width, % (30–70)
  left: ColumnContent;
  right: ColumnContent;
}

export interface ImageBlock {
  id: string;
  type: 'image';
  src: string; // data URL (kept inside the document file)
  caption: string;
  widthPct: number; // 20–100
}

export type Block =
  | SectionBlock
  | ParagraphBlock
  | BadgeRowBlock
  | BulletsBlock
  | StepsBlock
  | ChecklistBlock
  | CalloutBlock
  | TableBlock
  | SignoffBlock
  | ImageBlock
  | ColumnsBlock;

// Block types allowed inside a column.
export const COLUMN_CHILD_TYPES = ['paragraph', 'bullets', 'steps', 'checklist'] as const;
export type ColumnChildType = (typeof COLUMN_CHILD_TYPES)[number];

export type BlockType = Block['type'];

export interface BrandChip {
  text: string;
  color: string;
}

export type Audience = 'employee' | 'customer';

export const TYPE_SCALE_MIN = 90;
export const TYPE_SCALE_MAX = 140;

export interface PolicyDoc {
  id: string;
  title: string;
  kicker: string;
  subtitle: string;
  chip: BrandChip | null;
  accent: string;
  typeScale: number; // % type size: 100 = employee docs, ~116 = customer postings
  /** @deprecated pre-1.1 field; normalizeDoc converts it into `typeScale`. */
  audience?: Audience;
  blocks: Block[];
  createdAt: number;
  updatedAt: number;
}

export const ACCENT_PRESETS = ['#C8102E', '#9E0620', '#15181D'] as const;

export const DEFAULT_KICKER = "Snyder's Ace Hardware · Store Policy & Procedures";
export const SOP_KICKER = "Snyder's Ace Hardware · Standard Operating Procedure";
export const CUSTOMER_KICKER = "Snyder's Ace Hardware · Media, PA";

// Letter page geometry at CSS 96dpi, matching the printed documents
// (0.4in margins on letter paper).
export const PAGE = {
  widthIn: 8.5,
  heightIn: 11,
  marginIn: 0.4,
  dpi: 96,
} as const;

export const PAGE_W_PX = PAGE.widthIn * PAGE.dpi; // 816
export const PAGE_MARGIN_PX = PAGE.marginIn * PAGE.dpi; // 38.4
export const PRINTABLE_H_PX = (PAGE.heightIn - 2 * PAGE.marginIn) * PAGE.dpi; // 979.2
export const CONTENT_W_IN = PAGE.widthIn - 2 * PAGE.marginIn; // 7.7
