// The heatmap engine: a catalog of metrics computable from a Compass
// export, per-fixture aggregation, and the color ramps. Ramp math runs
// in OKLab so the gradients stay perceptually even.
import type { AgeMode, FloorData, HeatSettings, MetricId, RampId, SkuRecord } from './types';

export const DAY = 86400000;

export type MetricKind = 'age' | 'pct' | 'magnitude';

type NumericField = 'qoh' | 'cost' | 'retail' | 'sold';
type DateField = 'datePhys' | 'dateSale' | 'dateReceipt';

export interface Metric {
  id: MetricId;
  label: string;
  blurb: string;
  kind: MetricKind;
  /** Fields the export must actually contain for this metric to run. */
  needs: readonly (NumericField | DateField)[];
  /** age: green ≤ lo days / red ≥ hi days · pct: red ≥ hi %. */
  defaults: { lo: number; hi: number };
  unit: string;
}

export const METRICS: readonly Metric[] = [
  {
    id: 'phys',
    label: 'Last physical count',
    blurb: 'Days since each SKU was last physically counted — the count-currency map.',
    kind: 'age',
    needs: ['datePhys'],
    defaults: { lo: 30, hi: 365 },
    unit: 'days',
  },
  {
    id: 'sale',
    label: 'Last sale (dead stock)',
    blurb: 'Days since anything in the bay sold — red bays are dead-stock candidates.',
    kind: 'age',
    needs: ['dateSale'],
    defaults: { lo: 30, hi: 365 },
    unit: 'days',
  },
  {
    id: 'receipt',
    label: 'Last receipt',
    blurb: 'Days since product last arrived for the bay.',
    kind: 'age',
    needs: ['dateReceipt'],
    defaults: { lo: 30, hi: 365 },
    unit: 'days',
  },
  {
    id: 'neverPct',
    label: 'Never-counted SKUs',
    blurb: 'Share of SKUs in the bay with no physical count on record, ever.',
    kind: 'pct',
    needs: ['datePhys'],
    defaults: { lo: 0, hi: 100 },
    unit: '%',
  },
  {
    id: 'oosPct',
    label: 'Out-of-stock SKUs',
    blurb: 'Share of SKUs showing zero or negative on-hand.',
    kind: 'pct',
    needs: ['qoh'],
    defaults: { lo: 0, hi: 50 },
    unit: '%',
  },
  {
    id: 'negPct',
    label: 'Negative on-hand SKUs',
    blurb: 'Share of SKUs with on-hand below zero — a count-accuracy red flag.',
    kind: 'pct',
    needs: ['qoh'],
    defaults: { lo: 0, hi: 20 },
    unit: '%',
  },
  {
    id: 'noSalePct',
    label: 'No-sale SKUs',
    blurb: 'Share of SKUs with zero units sold in the export’s movement window.',
    kind: 'pct',
    needs: ['sold'],
    defaults: { lo: 0, hi: 75 },
    unit: '%',
  },
  {
    id: 'skuCount',
    label: 'SKUs per location',
    blurb: 'How many distinct SKUs the export puts in each bay.',
    kind: 'magnitude',
    needs: [],
    defaults: { lo: 0, hi: 0 },
    unit: 'SKUs',
  },
  {
    id: 'units',
    label: 'Units on hand',
    blurb: 'Total on-hand units in the bay.',
    kind: 'magnitude',
    needs: ['qoh'],
    defaults: { lo: 0, hi: 0 },
    unit: 'units',
  },
  {
    id: 'retailValue',
    label: 'Retail value',
    blurb: 'On-hand × retail, summed over the bay.',
    kind: 'magnitude',
    needs: ['qoh', 'retail'],
    defaults: { lo: 0, hi: 0 },
    unit: '$',
  },
  {
    id: 'costValue',
    label: 'Cost value',
    blurb: 'On-hand × unit cost, summed over the bay.',
    kind: 'magnitude',
    needs: ['qoh', 'cost'],
    defaults: { lo: 0, hi: 0 },
    unit: '$',
  },
  {
    id: 'sold',
    label: 'Units sold',
    blurb: 'Movement over the export’s window — where the traffic is.',
    kind: 'magnitude',
    needs: ['sold'],
    defaults: { lo: 0, hi: 0 },
    unit: 'units',
  },
];

export const metricById = (id: MetricId): Metric => METRICS.find((m) => m.id === id) ?? METRICS[0];

/** A metric is available once its needed columns hold at least one value. */
export function availableFields(data: FloorData | null): Set<NumericField | DateField> {
  const present = new Set<NumericField | DateField>();
  if (!data) return present;
  const fields: (NumericField | DateField)[] = ['qoh', 'cost', 'retail', 'sold', 'datePhys', 'dateSale', 'dateReceipt'];
  for (const s of data.skus) {
    for (const f of fields) if (!present.has(f) && s[f] !== null) present.add(f);
    if (present.size === fields.length) break;
  }
  return present;
}

export function metricAvailable(metric: Metric, present: Set<string>): boolean {
  return metric.needs.every((f) => present.has(f));
}

// ---- per-fixture heat ----

export interface FixtureHeat {
  /** The aggregated metric value (days, %, units, $ …). Null = never. */
  value: number | null;
  /** 0 = best/low end of the ramp, 1 = worst/high end. */
  t: number;
  /** Every dated/valued aggregate can still contain never-counted SKUs. */
  neverCount: number;
  skuCount: number;
  text: string;
}

export function thresholdsFor(metric: Metric, settings: HeatSettings): { lo: number; hi: number } {
  return settings.thresholds[metric.id] ?? metric.defaults;
}

const daysAgo = (today: number, when: number) => Math.max(0, Math.floor((today - when) / DAY));

function aggAge(values: number[], mode: AgeMode): number {
  if (mode === 'oldest') return Math.max(...values);
  if (mode === 'newest') return Math.min(...values);
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

export function formatValue(metric: Metric, value: number | null): string {
  if (value === null) return 'never';
  if (metric.unit === '$')
    return `$${Math.round(value).toLocaleString('en-US')}`;
  if (metric.unit === '%') return `${Math.round(value)}%`;
  if (metric.unit === 'days') return `${Math.round(value)}d`;
  return `${Math.round(value).toLocaleString('en-US')}`;
}

/**
 * Compute the heat for every fixture that has SKUs in the export.
 * Fixtures absent from the map have no data at all and draw neutral.
 */
export function computeHeat(
  index: Map<string, SkuRecord[]>,
  settings: HeatSettings,
  todayMs: number,
): Map<string, FixtureHeat> {
  const metric = metricById(settings.metricId);
  const { lo, hi } = thresholdsFor(metric, settings);
  const out = new Map<string, FixtureHeat>();

  const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
  const scale = (v: number) => (hi > lo ? clamp01((v - lo) / (hi - lo)) : v > lo ? 1 : 0);

  if (metric.kind === 'age') {
    const field: DateField = metric.id === 'sale' ? 'dateSale' : metric.id === 'receipt' ? 'dateReceipt' : 'datePhys';
    for (const [loc, skus] of index) {
      const dated = skus.map((s) => s[field]).filter((d): d is number => d !== null);
      const neverCount = skus.length - dated.length;
      if (dated.length === 0) {
        out.set(loc, { value: null, t: 1, neverCount, skuCount: skus.length, text: 'never' });
      } else {
        const v = aggAge(dated.map((d) => daysAgo(todayMs, d)), settings.ageMode);
        out.set(loc, { value: v, t: scale(v), neverCount, skuCount: skus.length, text: formatValue(metric, v) });
      }
    }
    return out;
  }

  if (metric.kind === 'pct') {
    for (const [loc, skus] of index) {
      let hit = 0;
      let denom = 0;
      for (const s of skus) {
        if (metric.id === 'neverPct') {
          denom++;
          if (s.datePhys === null) hit++;
        } else if (metric.id === 'noSalePct') {
          denom++;
          if ((s.sold ?? 0) === 0) hit++;
        } else if (s.qoh !== null) {
          denom++;
          if (metric.id === 'oosPct' ? s.qoh <= 0 : s.qoh < 0) hit++;
        }
      }
      if (denom === 0) continue;
      const v = (100 * hit) / denom;
      out.set(loc, { value: v, t: scale(v), neverCount: 0, skuCount: skus.length, text: formatValue(metric, v) });
    }
    return out;
  }

  // magnitude — sum per fixture, scaled to the 95th percentile so one
  // monster bay doesn't wash out the rest of the floor.
  const sums = new Map<string, { v: number; n: number }>();
  for (const [loc, skus] of index) {
    let v = 0;
    for (const s of skus) {
      if (metric.id === 'skuCount') v += 1;
      else if (metric.id === 'units') v += s.qoh ?? 0;
      else if (metric.id === 'sold') v += s.sold ?? 0;
      else if (metric.id === 'retailValue') v += (s.qoh ?? 0) * (s.retail ?? 0);
      else v += (s.qoh ?? 0) * (s.cost ?? 0);
    }
    sums.set(loc, { v, n: skus.length });
  }
  const positives = [...sums.values()].map((s) => s.v).filter((v) => v > 0).sort((a, b) => a - b);
  const p95 = positives.length > 0 ? positives[Math.min(positives.length - 1, Math.floor(positives.length * 0.95))] : 0;
  for (const [loc, { v, n }] of sums) {
    out.set(loc, {
      value: v,
      t: p95 > 0 ? clamp01(v / p95) : 0,
      neverCount: 0,
      skuCount: n,
      text: formatValue(metric, v),
    });
  }
  return out;
}

/** The magnitude legend needs the domain top to label the dark end. */
export function magnitudeTop(heat: Map<string, FixtureHeat>): number {
  let top = 0;
  for (const h of heat.values()) if (h.t >= 1 && (h.value ?? 0) > 0) top = Math.max(top, h.value ?? 0);
  if (top === 0) for (const h of heat.values()) top = Math.max(top, h.value ?? 0);
  return top;
}

// ---- color ramps (OKLab interpolation) ----

type Stop = [number, string];

// The classic traffic-light read the store asked for, in brand hues:
// green → brand yellow → brand gold → Ace red. The green is kept dark
// (#186B2B) so the ramp's ends stay apart on lightness alone — that plus
// the printed values/tooltips is what keeps this readable under CVD; the
// blue→red toggle below is the fully colorblind-safe option.
const CLASSIC: Stop[] = [
  [0, '#186B2B'],
  [0.45, '#F5C714'],
  [0.7, '#FAA227'],
  [1, '#D40029'],
];

// Colorblind-friendly alternative: a proper diverging pair — cool blue
// through a neutral gray midpoint into the brand dark red. Blue/red
// survives deuteranopia and protanopia where green/red collapses.
const CVD: Stop[] = [
  [0, '#2166AC'],
  [0.5, '#E6E7E8'],
  [1, '#9E0620'],
];

// Sequential single-hue ramp for magnitude metrics (light → dark red).
// Light end stays visible against the white floor (~2:1 contrast).
const MAGNITUDE: Stop[] = [
  [0, '#DF97A9'],
  [0.55, '#C22246'],
  [1, '#5B0014'],
];

export const NEVER_FILL = '#5B0014';
export const NO_DATA_FILL = '#ECEDEF';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const srgbToLinear = (c: number) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
};
const linearToSrgb = (x: number) => {
  const c = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
};

function rgbToOklab([r, g, b]: [number, number, number]): [number, number, number] {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, a, b]: [number, number, number]): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function sampleStops(stops: Stop[], t: number): string {
  const x = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < stops.length - 2 && x > stops[i + 1][0]) i++;
  const [t0, c0] = stops[i];
  const [t1, c1] = stops[i + 1];
  const f = t1 > t0 ? (x - t0) / (t1 - t0) : 0;
  const a = rgbToOklab(hexToRgb(c0));
  const b = rgbToOklab(hexToRgb(c1));
  const [r, g, bl] = oklabToRgb([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

export function rampStops(kind: MetricKind, ramp: RampId): Stop[] {
  if (kind === 'magnitude') return MAGNITUDE;
  return ramp === 'cvd' ? CVD : CLASSIC;
}

export function heatColor(kind: MetricKind, ramp: RampId, t: number): string {
  return sampleStops(rampStops(kind, ramp), t);
}

/** CSS gradient for the legend bar, sampled off the same ramp. */
export function rampGradient(kind: MetricKind, ramp: RampId): string {
  const steps = 12;
  const parts: string[] = [];
  for (let i = 0; i <= steps; i++) parts.push(sampleStops(rampStops(kind, ramp), i / steps));
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

/** Pick label ink that survives the fill behind it. */
export function inkFor(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const lum = 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
  return lum > 0.35 ? '#15181D' : '#FFFFFF';
}
