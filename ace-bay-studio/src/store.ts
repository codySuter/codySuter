import { create } from 'zustand';
import { api } from './api';
import type { Area, Aisle, BayMap, Bin, BinItem, FreshnessPreset, Overlay } from './model/types';
import {
  defaultMap,
  emptyAisle,
  emptyBin,
  looksLikeMap,
  normalizeLabel,
  normalizeMap,
  resizeAisle,
  uid,
} from './model/layout';
import type { CsvRow } from './model/csv';

// Preset brush colors: brand reds/golds first, then functional hues that
// stay tellable-apart as a translucent wash over the gray bin icon.
export const OVERLAY_COLORS = [
  '#D40029', // Ace Red
  '#FAA227', // Gold
  '#F5C714', // Yellow
  '#2E933C', // Green
  '#0FA3B1', // Teal
  '#2667FF', // Blue
  '#071E3A', // Navy
  '#7B2CBF', // Purple
  '#E5446D', // Pink
  '#855723', // Brown
  '#D8AA5A', // Tan
  '#6D6E71', // Gray
];

export type Tool = 'select' | 'paint';

/** Which map an import's location numbers refer to. */
export type ImportScope = Area | 'both';

export interface ImportSummary {
  binsMatched: number;
  itemsAdded: number;
  unmatchedLabels: string[];
  skippedRows: number;
}

interface BayState {
  map: BayMap | null;
  area: Area;
  tool: Tool;
  activeOverlayId: string | null;
  selectedBinId: string | null;
  search: string;
  /** While the pointer is down in paint mode: are we adding or removing? */
  stroke: { overlayId: string; adding: boolean } | null;
  settingsOpen: boolean;
  toast: string | null;

  init(): Promise<void>;
  setArea(area: Area): void;
  setTool(tool: Tool): void;
  setSearch(q: string): void;
  setSettingsOpen(open: boolean): void;
  showToast(msg: string): void;

  selectBin(binId: string | null): void;
  setBinLabel(binId: string, label: string): void;
  setBinNotes(binId: string, notes: string): void;
  setBinOverlay(binId: string, overlayId: string, on: boolean): void;
  addBinItem(binId: string, item?: Partial<BinItem>): void;
  updateBinItem(binId: string, itemId: string, patch: Partial<BinItem>): void;
  removeBinItem(binId: string, itemId: string): void;
  clearBinItems(binId: string): void;

  addOverlay(name?: string): void;
  updateOverlay(id: string, patch: Partial<Pick<Overlay, 'name' | 'color' | 'visible'>>): void;
  removeOverlay(id: string): void;
  setActiveOverlay(id: string | null): void;
  updateFreshness(patch: Partial<FreshnessPreset>): void;
  beginStroke(binId: string): void;
  strokeOver(binId: string): void;
  endStroke(): void;

  renameAisle(aisleId: string, name: string): void;
  resizeAisleTo(aisleId: string, shelves: number, perShelf: number): void;
  addAisle(): void;
  removeAisle(aisleId: string): void;
  addFloorLocations(count: number): void;
  removeFloorLocation(binId: string): void;

  importContents(rows: CsvRow[], mode: 'append' | 'replace', scope: ImportScope, skippedRows: number): ImportSummary;
  restoreMap(parsed: unknown): boolean;
  resetMap(): void;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist(map: BayMap): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void api.saveMap(map), 400);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function withBin(map: BayMap, binId: string, fn: (bin: Bin) => Bin): BayMap {
  const each = (bin: Bin) => (bin.id === binId ? fn(bin) : bin);
  return {
    ...map,
    updatedAt: Date.now(),
    aisles: map.aisles.map((aisle) => ({
      ...aisle,
      banks: aisle.banks.map((bank) => ({
        ...bank,
        shelves: bank.shelves.map((row) => row.map(each)),
      })),
    })),
    floor: map.floor.map(each),
  };
}

function mapAllBins(map: BayMap, fn: (bin: Bin) => Bin): BayMap {
  return {
    ...map,
    updatedAt: Date.now(),
    aisles: map.aisles.map((aisle) => ({
      ...aisle,
      banks: aisle.banks.map((bank) => ({
        ...bank,
        shelves: bank.shelves.map((row) => row.map(fn)),
      })),
    })),
    floor: map.floor.map(fn),
  };
}

/** Every bin an import scope covers, in match-priority order. */
function scopedBins(map: BayMap, scope: ImportScope): Bin[] {
  const bays: Bin[] = [];
  for (const aisle of map.aisles)
    for (const bank of aisle.banks)
      for (const row of bank.shelves) bays.push(...row);
  if (scope === 'bays') return bays;
  if (scope === 'floor') return [...map.floor];
  return [...bays, ...map.floor];
}

export const useBay = create<BayState>((set, get) => {
  const update = (map: BayMap) => {
    persist(map);
    set({ map });
  };
  const mutateBin = (binId: string, fn: (bin: Bin) => Bin) => {
    const { map } = get();
    if (map) update(withBin(map, binId, fn));
  };

  return {
    map: null,
    area: 'bays',
    tool: 'select',
    activeOverlayId: null,
    selectedBinId: null,
    search: '',
    stroke: null,
    settingsOpen: false,
    toast: null,

    async init() {
      const loaded = await api.loadMap();
      const map = normalizeMap(loaded ?? defaultMap());
      if (!loaded) void api.saveMap(map);
      set({ map, activeOverlayId: map.overlays[0]?.id ?? null });
    },

    setArea: (area) => set({ area, selectedBinId: null }),
    setTool: (tool) => set({ tool, ...(tool === 'paint' ? { selectedBinId: null } : {}) }),
    setSearch: (search) => set({ search }),
    setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

    showToast(msg) {
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => set({ toast: null }), 3200);
      set({ toast: msg });
    },

    selectBin: (selectedBinId) => set({ selectedBinId }),

    setBinLabel: (binId, label) => mutateBin(binId, (bin) => ({ ...bin, label })),
    setBinNotes: (binId, notes) => mutateBin(binId, (bin) => ({ ...bin, notes })),

    setBinOverlay(binId, overlayId, on) {
      mutateBin(binId, (bin) => ({
        ...bin,
        overlayIds: on
          ? bin.overlayIds.includes(overlayId)
            ? bin.overlayIds
            : [...bin.overlayIds, overlayId]
          : bin.overlayIds.filter((id) => id !== overlayId),
      }));
    },

    addBinItem(binId, item) {
      mutateBin(binId, (bin) => ({
        ...bin,
        items: [
          ...bin.items,
          { id: uid('item'), name: '', qty: '', sku: '', note: '', lastPhysical: '', ...item },
        ],
      }));
    },

    updateBinItem(binId, itemId, patch) {
      mutateBin(binId, (bin) => ({
        ...bin,
        items: bin.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
      }));
    },

    removeBinItem(binId, itemId) {
      mutateBin(binId, (bin) => ({ ...bin, items: bin.items.filter((it) => it.id !== itemId) }));
    },

    clearBinItems: (binId) => mutateBin(binId, (bin) => ({ ...bin, items: [] })),

    addOverlay(name) {
      const { map } = get();
      if (!map) return;
      const used = new Set(map.overlays.map((o) => o.color));
      const color = OVERLAY_COLORS.find((c) => !used.has(c)) ?? OVERLAY_COLORS[map.overlays.length % OVERLAY_COLORS.length];
      const overlay: Overlay = {
        id: uid('ov'),
        name: name ?? `Overlay ${map.overlays.length + 1}`,
        color,
        visible: true,
      };
      update({ ...map, updatedAt: Date.now(), overlays: [...map.overlays, overlay] });
      set({ activeOverlayId: overlay.id, tool: 'paint', selectedBinId: null });
    },

    updateOverlay(id, patch) {
      const { map } = get();
      if (!map) return;
      update({
        ...map,
        updatedAt: Date.now(),
        overlays: map.overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)),
      });
    },

    removeOverlay(id) {
      const { map, activeOverlayId } = get();
      if (!map) return;
      const next = mapAllBins(
        { ...map, overlays: map.overlays.filter((o) => o.id !== id) },
        (bin) =>
          bin.overlayIds.includes(id)
            ? { ...bin, overlayIds: bin.overlayIds.filter((x) => x !== id) }
            : bin,
      );
      update(next);
      if (activeOverlayId === id) set({ activeOverlayId: next.overlays[0]?.id ?? null });
    },

    setActiveOverlay: (activeOverlayId) => set({ activeOverlayId }),

    updateFreshness(patch) {
      const { map } = get();
      if (!map) return;
      update({ ...map, updatedAt: Date.now(), freshness: { ...map.freshness, ...patch } });
    },

    beginStroke(binId) {
      const { map, activeOverlayId } = get();
      if (!map || !activeOverlayId) return;
      const bin = scopedBins(map, 'both').find((b) => b.id === binId);
      const adding = !bin || !bin.overlayIds.includes(activeOverlayId);
      set({ stroke: { overlayId: activeOverlayId, adding } });
      get().setBinOverlay(binId, activeOverlayId, adding);
    },

    strokeOver(binId) {
      const { stroke } = get();
      if (stroke) get().setBinOverlay(binId, stroke.overlayId, stroke.adding);
    },

    endStroke: () => set({ stroke: null }),

    renameAisle(aisleId, name) {
      const { map } = get();
      if (!map) return;
      update({
        ...map,
        updatedAt: Date.now(),
        aisles: map.aisles.map((a) => (a.id === aisleId ? { ...a, name } : a)),
      });
    },

    resizeAisleTo(aisleId, shelves, perShelf) {
      const { map } = get();
      if (!map) return;
      update({
        ...map,
        updatedAt: Date.now(),
        aisles: map.aisles.map((a) => (a.id === aisleId ? resizeAisle(a, shelves, perShelf) : a)),
      });
    },

    addAisle() {
      const { map } = get();
      if (!map) return;
      const aisle: Aisle = emptyAisle(`Bay Aisle ${map.aisles.length + 1}`);
      update({ ...map, updatedAt: Date.now(), aisles: [...map.aisles, aisle] });
    },

    removeAisle(aisleId) {
      const { map } = get();
      if (!map) return;
      update({ ...map, updatedAt: Date.now(), aisles: map.aisles.filter((a) => a.id !== aisleId) });
    },

    addFloorLocations(count) {
      const { map } = get();
      if (!map || count < 1) return;
      const start = map.floor.length + 1;
      const added = Array.from({ length: count }, (_, i) => emptyBin(String(start + i)));
      update({ ...map, updatedAt: Date.now(), floor: [...map.floor, ...added] });
    },

    removeFloorLocation(binId) {
      const { map, selectedBinId } = get();
      if (!map) return;
      update({ ...map, updatedAt: Date.now(), floor: map.floor.filter((b) => b.id !== binId) });
      if (selectedBinId === binId) set({ selectedBinId: null });
    },

    importContents(rows, mode, scope, skippedRows) {
      const { map } = get();
      const summary: ImportSummary = { binsMatched: 0, itemsAdded: 0, unmatchedLabels: [], skippedRows };
      if (!map) return summary;

      // First labeled bin in the scope wins for each normalized label.
      const binsByLabel = new Map<string, Bin>();
      for (const bin of scopedBins(map, scope)) {
        const key = normalizeLabel(bin.label);
        if (key && !binsByLabel.has(key)) binsByLabel.set(key, bin);
      }

      const itemsByBinId = new Map<string, BinItem[]>();
      const unmatched = new Set<string>();
      for (const row of rows) {
        const bin = binsByLabel.get(normalizeLabel(row.optiLabel));
        if (!bin) {
          unmatched.add(row.optiLabel.trim());
          continue;
        }
        const list = itemsByBinId.get(bin.id) ?? [];
        list.push(row.item);
        itemsByBinId.set(bin.id, list);
        summary.itemsAdded++;
      }
      summary.binsMatched = itemsByBinId.size;
      summary.unmatchedLabels = [...unmatched];

      if (itemsByBinId.size > 0) {
        update(
          mapAllBins(map, (bin) => {
            const incoming = itemsByBinId.get(bin.id);
            if (!incoming) return bin;
            return { ...bin, items: mode === 'replace' ? incoming : [...bin.items, ...incoming] };
          }),
        );
      }
      return summary;
    },

    restoreMap(parsed) {
      if (!looksLikeMap(parsed)) return false;
      const map = normalizeMap({ ...parsed, updatedAt: Date.now() });
      update(map);
      set({ selectedBinId: null, activeOverlayId: map.overlays[0]?.id ?? null });
      return true;
    },

    resetMap() {
      const map = defaultMap();
      update(map);
      set({ selectedBinId: null, activeOverlayId: null });
    },
  };
});

/** Search filter — empty query matches everything. */
export function binMatches(bin: Bin, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (bin.label.toLowerCase().includes(q)) return true;
  if (normalizeLabel(bin.label) !== '' && normalizeLabel(bin.label) === normalizeLabel(q)) return true;
  if (bin.notes.toLowerCase().includes(q)) return true;
  return bin.items.some(
    (it) =>
      it.name.toLowerCase().includes(q) ||
      it.sku.toLowerCase().includes(q) ||
      it.note.toLowerCase().includes(q),
  );
}

export function overlayBinCount(map: BayMap, overlayId: string): number {
  let n = 0;
  for (const aisle of map.aisles)
    for (const bank of aisle.banks)
      for (const row of bank.shelves)
        for (const bin of row) if (bin.overlayIds.includes(overlayId)) n++;
  for (const bin of map.floor) if (bin.overlayIds.includes(overlayId)) n++;
  return n;
}
