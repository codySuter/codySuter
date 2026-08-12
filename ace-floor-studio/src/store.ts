import { create } from 'zustand';
import { api } from './api';
import { indexByFixture } from './model/compass';
import type { FloorData, FloorDoc, HeatSettings, MetricId, SkuRecord } from './model/types';
import { defaultDoc, defaultSettings, looksLikeDoc } from './model/types';

interface FloorState {
  doc: FloorDoc | null;
  /** Rebuilt whenever the data changes: fixture id → SKUs stocked there. */
  index: Map<string, SkuRecord[]>;
  selectedId: string | null;
  search: string;
  toast: string | null;

  init(): Promise<void>;
  setData(data: FloorData | null): void;
  setSettings(patch: Partial<HeatSettings>): void;
  setThreshold(metric: MetricId, lo: number, hi: number): void;
  select(id: string | null): void;
  setSearch(q: string): void;
  showToast(msg: string): void;
  restoreDoc(parsed: unknown): boolean;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist(doc: FloorDoc): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void api.saveDoc(doc), 400);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useFloor = create<FloorState>((set, get) => {
  const update = (doc: FloorDoc) => {
    persist(doc);
    set({ doc, index: indexByFixture(doc.data?.skus ?? []) });
  };

  return {
    doc: null,
    index: new Map(),
    selectedId: null,
    search: '',
    toast: null,

    async init() {
      const loaded = await api.loadDoc();
      const doc = loaded ?? defaultDoc();
      if (!loaded) void api.saveDoc(doc);
      set({ doc, index: indexByFixture(doc.data?.skus ?? []) });
    },

    setData(data) {
      const { doc } = get();
      if (!doc) return;
      update({ ...doc, updatedAt: Date.now(), data });
      set({ selectedId: null });
    },

    setSettings(patch) {
      const { doc } = get();
      if (!doc) return;
      update({ ...doc, updatedAt: Date.now(), settings: { ...doc.settings, ...patch } });
    },

    setThreshold(metric, lo, hi) {
      const { doc } = get();
      if (!doc) return;
      update({
        ...doc,
        updatedAt: Date.now(),
        settings: {
          ...doc.settings,
          thresholds: { ...doc.settings.thresholds, [metric]: { lo, hi } },
        },
      });
    },

    select: (selectedId) => set({ selectedId }),
    setSearch: (search) => set({ search }),

    showToast(msg) {
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => set({ toast: null }), 3200);
      set({ toast: msg });
    },

    restoreDoc(parsed) {
      if (!looksLikeDoc(parsed)) return false;
      update({ ...parsed, settings: { ...defaultSettings(), ...parsed.settings }, updatedAt: Date.now() });
      set({ selectedId: null });
      return true;
    },
  };
});

/** Search filter — does this SKU match the query? */
export function skuMatches(rec: SkuRecord, q: string): boolean {
  return rec.sku.toLowerCase().includes(q) || rec.desc.toLowerCase().includes(q);
}

/** Fixture ids whose contents match the search (empty query → null). */
export function searchHits(index: Map<string, SkuRecord[]>, query: string): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (q === '') return null;
  const hits = new Set<string>();
  for (const [loc, skus] of index) {
    if (loc.toLowerCase().includes(q) || skus.some((s) => skuMatches(s, q))) hits.add(loc);
  }
  return hits;
}
