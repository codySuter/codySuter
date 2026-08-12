// The data model: one Compass export, parsed once, stored as a single
// JSON document ("the doc") together with the heatmap settings. The
// floor plan itself is code (floorplan.ts), not data — a location code
// is the join key between the two.

export interface SkuRecord {
  sku: string;
  desc: string;
  /** Fixture ids this SKU is stocked in (resolved from the Loc columns). */
  locs: string[];
  qoh: number | null;
  cost: number | null;
  retail: number | null;
  /** Units sold over the export's movement window (blank reads as 0). */
  sold: number | null;
  /** Epoch ms at UTC midnight — null means never / blank in the export. */
  datePhys: number | null;
  dateSale: number | null;
  dateReceipt: number | null;
}

export interface UnmatchedLocation {
  code: string;
  rows: number;
}

export interface FloorData {
  fileName: string;
  importedAt: number;
  rowCount: number;
  skus: SkuRecord[];
  /** Location codes in the export that match nothing on the plan. */
  unmatched: UnmatchedLocation[];
  /** Rows whose location cells were all blank. */
  unlocatedRows: number;
}

export type MetricId =
  | 'phys'
  | 'sale'
  | 'receipt'
  | 'neverPct'
  | 'oosPct'
  | 'negPct'
  | 'noSalePct'
  | 'skuCount'
  | 'units'
  | 'retailValue'
  | 'costValue'
  | 'sold';

export type AgeMode = 'oldest' | 'newest' | 'average';
export type RampId = 'classic' | 'cvd';

export interface HeatSettings {
  metricId: MetricId;
  ageMode: AgeMode;
  ramp: RampId;
  /** Print each bay's metric value on the map. */
  showValues: boolean;
  /** Per-metric scale overrides: age = green≤lo / red≥hi days, pct = red≥hi %. */
  thresholds: Partial<Record<MetricId, { lo: number; hi: number }>>;
}

export interface FloorDoc {
  version: 1;
  updatedAt: number;
  data: FloorData | null;
  settings: HeatSettings;
}

export function defaultSettings(): HeatSettings {
  return {
    metricId: 'phys',
    ageMode: 'oldest',
    ramp: 'classic',
    showValues: false,
    thresholds: {},
  };
}

export function defaultDoc(): FloorDoc {
  return { version: 1, updatedAt: Date.now(), data: null, settings: defaultSettings() };
}

/** Basic shape check for restores of the whole doc. */
export function looksLikeDoc(parsed: unknown): parsed is FloorDoc {
  const d = parsed as FloorDoc | null;
  return (
    !!d &&
    typeof d === 'object' &&
    d.version === 1 &&
    !!d.settings &&
    typeof d.settings === 'object' &&
    (d.data === null ||
      (!!d.data &&
        typeof d.data === 'object' &&
        Array.isArray(d.data.skus) &&
        d.data.skus.every((s) => s && typeof s.sku === 'string' && Array.isArray(s.locs))))
  );
}
