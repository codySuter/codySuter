import type { Aisle, Bank, BayMap, Bin, BinAddress, Side } from './types';

// Snyder's back room: 4 bay aisles, racking on BOTH sides of each
// walkway, each side 3 shelves high × 8 OPTIs per shelf. All of it is
// editable in Settings — this is just the day-one map.
export const DEFAULT_AISLES = 4;
export const DEFAULT_SHELVES = 3;
export const DEFAULT_PER_SHELF = 8;

let counter = 0;
export function uid(prefix: string): string {
  counter = (counter + 1) % 1296;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}${Math.floor(
    Math.random() * 1296,
  ).toString(36)}`;
}

export function emptyBin(): Bin {
  return { id: uid('bin'), label: '', overlayIds: [], items: [], notes: '' };
}

function emptyBank(side: Side, shelves: number, perShelf: number): Bank {
  return {
    side,
    shelves: Array.from({ length: shelves }, () =>
      Array.from({ length: perShelf }, () => emptyBin()),
    ),
  };
}

export function emptyAisle(name: string, shelves = DEFAULT_SHELVES, perShelf = DEFAULT_PER_SHELF): Aisle {
  return {
    id: uid('aisle'),
    name,
    banks: [emptyBank('left', shelves, perShelf), emptyBank('right', shelves, perShelf)],
  };
}

export function defaultMap(): BayMap {
  return {
    version: 1,
    aisles: Array.from({ length: DEFAULT_AISLES }, (_, i) => emptyAisle(`Bay Aisle ${i + 1}`)),
    overlays: [],
    updatedAt: Date.now(),
  };
}

/**
 * Resize an aisle's banks, keeping every bin that still has a slot.
 * Shrinking drops the outermost shelves/slots (and any data on them) —
 * the caller warns before doing that.
 */
export function resizeAisle(aisle: Aisle, shelves: number, perShelf: number): Aisle {
  const banks = aisle.banks.map((bank) => ({
    ...bank,
    shelves: Array.from({ length: shelves }, (_, s) =>
      Array.from({ length: perShelf }, (_, p) => bank.shelves[s]?.[p] ?? emptyBin()),
    ),
  }));
  return { ...aisle, banks };
}

/** True when shrinking to shelves×perShelf would drop a bin holding data. */
export function resizeLosesData(aisle: Aisle, shelves: number, perShelf: number): boolean {
  return aisle.banks.some((bank) =>
    bank.shelves.some((row, s) =>
      row.some(
        (bin, p) =>
          (s >= shelves || p >= perShelf) &&
          (bin.label.trim() !== '' || bin.items.length > 0 || bin.notes.trim() !== '' || bin.overlayIds.length > 0),
      ),
    ),
  );
}

export function* allBins(map: BayMap): Generator<{ bin: Bin; address: BinAddress }> {
  for (const aisle of map.aisles) {
    for (const bank of aisle.banks) {
      for (let s = 0; s < bank.shelves.length; s++) {
        for (let p = 0; p < bank.shelves[s].length; p++) {
          yield {
            bin: bank.shelves[s][p],
            address: {
              aisleId: aisle.id,
              aisleName: aisle.name,
              side: bank.side,
              shelf: s + 1,
              slot: p + 1,
            },
          };
        }
      }
    }
  }
}

export function findBin(map: BayMap, binId: string): { bin: Bin; address: BinAddress } | undefined {
  for (const entry of allBins(map)) if (entry.bin.id === binId) return entry;
  return undefined;
}

export const sideLabel = (side: Side): string => (side === 'left' ? 'Left side' : 'Right side');

export function addressText(a: BinAddress): string {
  return `${a.aisleName} · ${sideLabel(a.side)} · Shelf ${a.shelf} · Slot ${a.slot}`;
}

/**
 * Labels are matched loosely for imports/search: trimmed,
 * case-insensitive, and "07" equals "7" so a leading zero in a
 * spreadsheet never causes a miss.
 */
export function normalizeLabel(label: string): string {
  const t = label.trim().toUpperCase();
  if (/^\d+$/.test(t)) return String(parseInt(t, 10));
  return t;
}

/** Basic shape check for restores/imports of the whole map. */
export function looksLikeMap(parsed: unknown): parsed is BayMap {
  const m = parsed as BayMap | null;
  return (
    !!m &&
    typeof m === 'object' &&
    Array.isArray(m.aisles) &&
    Array.isArray(m.overlays) &&
    m.aisles.every(
      (a) =>
        a &&
        typeof a.id === 'string' &&
        typeof a.name === 'string' &&
        Array.isArray(a.banks) &&
        a.banks.every((b) => Array.isArray(b.shelves)),
    )
  );
}
