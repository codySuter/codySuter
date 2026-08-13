import type { Bin, FreshnessPreset } from './types';

// The "how old is the data?" preset: each location is colored by the
// OLDEST Date Last Physical among its items — a location is only as
// current as its least-recently-counted item.

/** "03/12/2026", "3/12/26", "2026-03-12" → "2026-03-12"; else ''. */
export function parseDateLoose(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  let y: number, mo: number, d: number;
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:[ T].*)?$/);
    if (!m) return '';
    [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y < 100) y += 2000;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Oldest parseable Date Last Physical in the bin, ISO — or null. */
export function binOldestPhysical(bin: Bin): string | null {
  let oldest: string | null = null;
  for (const it of bin.items) {
    const iso = parseDateLoose(it.lastPhysical);
    if (iso && (oldest === null || iso < oldest)) oldest = iso;
  }
  return oldest;
}

export function ageDays(iso: string, now: number): number {
  const then = new Date(`${iso}T00:00:00`).getTime();
  return Math.max(0, Math.floor((now - then) / 86_400_000));
}

const GREEN = [0x2e, 0x93, 0x3c];
const AMBER = [0xfa, 0xa2, 0x27];
const RED = [0xd4, 0x00, 0x29];

/** Age in days → hex color: green (fresh) → amber → red (stale). */
export function freshnessColor(days: number, preset: FreshnessPreset): string {
  const span = Math.max(1, preset.redDays - preset.greenDays);
  const t = Math.min(1, Math.max(0, (days - preset.greenDays) / span));
  const [from, to] = t < 0.5 ? [GREEN, AMBER] : [AMBER, RED];
  const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  const hex = from
    .map((c, i) => Math.round(c + (to[i] - c) * u))
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('');
  return `#${hex}`;
}

/** The color a bin gets in the preset, or null when it has no dated items. */
export function binFreshnessColor(bin: Bin, preset: FreshnessPreset, now: number): string | null {
  const oldest = binOldestPhysical(bin);
  return oldest ? freshnessColor(ageDays(oldest, now), preset) : null;
}
