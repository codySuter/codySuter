import type { CSSProperties } from 'react';

// Exact design language of the store's Policy & Procedures documents.
export const FONT_DISPLAY = "'Barlow Semi Condensed', sans-serif";
export const FONT_BODY = "'IBM Plex Sans', sans-serif";

export const INK = '#15181D';
export const BODY_TEXT = '#20242B';
export const MUTED_TEXT = '#4A4F57';
export const KICKER_GRAY = '#8A9099';
export const YELLOW = '#F5C714';
export const HAIRLINE = '#E1E3E6';
export const RULE_GRAY = '#BCBEC0';

export interface DocStyles {
  scale: number;
  page: CSSProperties;
  accentBar: CSSProperties;
  headerRow: CSSProperties;
  kicker: CSSProperties;
  title: CSSProperties;
  subtitle: CSSProperties;
  chip: (color: string) => CSSProperties;
  sectionHead: CSSProperties;
  sectionNumber: CSSProperties;
  sectionTitle: CSSProperties;
  bodyText: CSSProperties;
  mutedText: CSSProperties;
  badge: (bg: string) => CSSProperties;
  badgeRow: CSSProperties;
  bulletRow: CSSProperties;
  bulletSquare: (accent: string) => CSSProperties;
  stepRow: CSSProperties;
  stepNumber: (accent: string) => CSSProperties;
  checkRow: CSSProperties;
  checkBox: CSSProperties;
  calloutBox: CSSProperties;
  calloutHead: CSSProperties;
  calloutBody: CSSProperties;
  tableWrap: CSSProperties;
  th: CSSProperties;
  td: CSSProperties;
  signBlock: CSSProperties;
  signHeading: CSSProperties;
  signBody: CSSProperties;
  signGrid: CSSProperties;
  signLine: CSSProperties;
  colHeading: CSSProperties;
  imageCaption: CSSProperties;
  footerWrap: CSSProperties;
  footerItem: CSSProperties;
  footerLabel: CSSProperties;
  footerValue: CSSProperties;
}

// typeScale is a percentage: 100 = employee docs, ~116 reads well for
// customer postings, and the slider runs 90–140.
export function makeStyles(accent: string, typeScale: number): DocStyles {
  const k = (typeScale || 100) / 100;
  const fs = (n: number) => `${Math.round(n * k * 10) / 10}px`;

  return {
    scale: k,
    page: {
      fontFamily: FONT_BODY,
      color: BODY_TEXT,
      background: '#fff',
    },
    accentBar: { height: 8, background: accent },
    headerRow: {
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      padding: '10px 0 8px',
    },
    kicker: {
      fontSize: fs(11),
      fontWeight: 600,
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
      color: KICKER_GRAY,
    },
    title: {
      fontFamily: FONT_DISPLAY,
      fontWeight: 800,
      fontSize: fs(30),
      lineHeight: 1.0,
      letterSpacing: '-0.01em',
      margin: '5px 0 0',
      color: INK,
      textTransform: 'uppercase',
    },
    subtitle: {
      fontFamily: FONT_DISPLAY,
      fontWeight: 700,
      fontSize: fs(16),
      letterSpacing: '0.02em',
      color: accent,
      textTransform: 'uppercase',
      marginTop: 2,
    },
    chip: (color: string) => ({
      background: color,
      color: '#fff',
      fontFamily: FONT_DISPLAY,
      fontWeight: 800,
      fontSize: fs(15),
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      padding: '6px 14px',
      borderRadius: 4,
      marginBottom: 4,
      whiteSpace: 'nowrap',
    }),
    sectionHead: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 12,
      borderBottom: `2px solid ${accent}`,
      paddingBottom: 6,
    },
    sectionNumber: {
      fontFamily: FONT_DISPLAY,
      fontWeight: 800,
      fontSize: fs(26),
      lineHeight: 0.8,
      color: accent,
      flex: 'none',
    },
    sectionTitle: {
      fontFamily: FONT_DISPLAY,
      fontWeight: 800,
      fontSize: fs(19),
      textTransform: 'uppercase',
      letterSpacing: '0.01em',
      color: INK,
      flex: 1,
      minWidth: 0,
    },
    bodyText: { fontSize: fs(12.5), lineHeight: 1.45 },
    mutedText: { fontSize: fs(12.5), lineHeight: 1.45, color: MUTED_TEXT },
    badge: (bg: string) => ({
      flex: 'none',
      width: 92 * k,
      textAlign: 'center',
      background: bg,
      color: '#fff',
      fontFamily: FONT_DISPLAY,
      fontWeight: 800,
      fontSize: fs(13),
      letterSpacing: '0.04em',
      padding: '4px 0',
      borderRadius: 4,
    }),
    badgeRow: { display: 'flex', gap: 12, alignItems: 'center' },
    bulletRow: { display: 'flex', gap: 11 },
    bulletSquare: (accent: string) => ({
      flex: 'none',
      width: 8,
      height: 8,
      background: accent,
      marginTop: 6 * k,
    }),
    stepRow: { display: 'flex', gap: 10 },
    stepNumber: (accent: string) => ({
      flex: 'none',
      width: 20 * k,
      textAlign: 'right',
      fontFamily: FONT_DISPLAY,
      fontWeight: 800,
      fontSize: fs(14),
      lineHeight: 1.3,
      color: accent,
    }),
    checkRow: { display: 'flex', gap: 10, alignItems: 'flex-start' },
    checkBox: {
      flex: 'none',
      width: 12 * k,
      height: 12 * k,
      border: `1.6px solid ${INK}`,
      borderRadius: 2,
      marginTop: 3 * k,
    },
    calloutBox: {
      border: `1px solid ${INK}`,
      borderRadius: 7,
      overflow: 'hidden',
    },
    calloutHead: {
      background: INK,
      color: '#fff',
      padding: '8px 14px',
      fontFamily: FONT_DISPLAY,
      fontWeight: 800,
      fontSize: fs(16),
      letterSpacing: '0.03em',
      lineHeight: 1.35,
      textTransform: 'uppercase',
    },
    calloutBody: {
      padding: '9px 16px',
      fontSize: fs(12),
      lineHeight: 1.45,
      color: MUTED_TEXT,
    },
    tableWrap: {
      border: `1px solid ${RULE_GRAY}`,
      borderRadius: 6,
      overflow: 'hidden',
    },
    th: {
      background: INK,
      color: '#fff',
      fontFamily: FONT_DISPLAY,
      fontWeight: 700,
      fontSize: fs(11.5),
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      textAlign: 'left',
      padding: '6px 10px',
    },
    td: {
      fontSize: fs(12),
      lineHeight: 1.4,
      padding: '5px 10px',
      borderTop: `1px solid ${HAIRLINE}`,
      verticalAlign: 'top',
    },
    // Agreement block — exact styles from the Radio & Scanner contract.
    signBlock: {
      borderTop: `2px solid ${INK}`,
      paddingTop: 8,
    },
    signHeading: {
      fontFamily: FONT_DISPLAY,
      fontWeight: 800,
      fontSize: fs(17),
      textTransform: 'uppercase',
      letterSpacing: '0.02em',
      color: INK,
    },
    signBody: {
      fontSize: fs(12),
      lineHeight: 1.4,
      color: MUTED_TEXT,
      paddingTop: 4,
    },
    signGrid: {
      display: 'grid',
      gridTemplateColumns: `1fr ${Math.round(170 * k)}px`,
      gap: '10px 28px',
      paddingTop: Math.round(40 * k),
    },
    signLine: {
      borderTop: `1.5px solid ${BODY_TEXT}`,
      paddingTop: 5,
      fontSize: fs(11),
      fontWeight: 600,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: '#6D6E71',
    },
    colHeading: {
      fontFamily: FONT_DISPLAY,
      fontWeight: 800,
      fontSize: fs(13),
      textTransform: 'uppercase',
      letterSpacing: '0.03em',
      color: '#6D6E71',
      marginBottom: 4,
    },
    imageCaption: {
      fontSize: fs(10.5),
      color: KICKER_GRAY,
      textAlign: 'center',
      marginTop: 4,
    },
    // Metadata footer: hairline rule, then small uppercase label / value
    // pairs across the width — effective date, version, supersedes, approver.
    footerWrap: {
      display: 'flex',
      gap: 24,
      borderTop: `1.5px solid ${INK}`,
      paddingTop: 6,
    },
    footerItem: { minWidth: 0, flex: '1 1 0%' },
    footerLabel: {
      fontFamily: FONT_DISPLAY,
      fontWeight: 700,
      fontSize: fs(9),
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color: '#6D6E71',
    },
    footerValue: {
      fontSize: fs(10.5),
      fontWeight: 600,
      color: BODY_TEXT,
      marginTop: 1,
    },
  };
}

// Vertical rhythm between blocks, matching the source documents:
// sections open a 12px break, callouts 9px, everything else 6px, and the
// first block after a section header sits 8px under its red rule.
// Unnumbered headers share the section rhythm exactly.
export function blockMarginTop(
  prevType: string | null,
  type: string,
): number {
  if (prevType === null) return 0;
  if (type === 'section' || type === 'header') return 12;
  if (type === 'signoff') return 10; // radio contract: agreement sits 10px under content
  if (prevType === 'section' || prevType === 'header') return 8;
  if (type === 'callout') return 9;
  return 6;
}

// Per-block spacing nudge: how far a single "Space above" step moves the
// gap, and the range the control (and stored value) is clamped to. The gap
// can be pulled tighter than the default (down to flush) or opened up to
// separate ideas, without ever going negative on the page.
export const SPACE_STEP = 4;
export const SPACE_MIN = -24;
export const SPACE_MAX = 96;

export const clampSpaceBefore = (n: number): number =>
  Math.max(SPACE_MIN, Math.min(SPACE_MAX, Math.round(n)));

// Final gap above a block: its type-based default plus the author's nudge,
// never less than zero so blocks can sit flush but never overlap.
export function effectiveMarginTop(
  prevType: string | null,
  type: string,
  spaceBefore?: number,
): number {
  return Math.max(0, blockMarginTop(prevType, type) + (spaceBefore || 0));
}
