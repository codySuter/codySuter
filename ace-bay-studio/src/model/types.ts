// The data model: the whole back room is one JSON document ("the map").
// Bins live in fixed grid positions; identity for imports/search is the
// user-entered label (the number spray-painted on the OPTI).

export type Side = 'left' | 'right';

export interface BinItem {
  id: string;
  name: string;
  qty: string;
  sku: string;
  note: string;
  /** Eagle's Date Last Physical, ISO (YYYY-MM-DD) when parseable, else raw. */
  lastPhysical: string;
}

export interface Bin {
  id: string;
  /** The painted OPTI number. Empty until the store labels it. */
  label: string;
  overlayIds: string[];
  items: BinItem[];
  notes: string;
}

export interface Bank {
  side: Side;
  /** shelves[0] is the TOP shelf, drawn first — like facing the rack. */
  shelves: Bin[][];
}

export interface Aisle {
  id: string;
  name: string;
  banks: Bank[];
}

export interface Overlay {
  id: string;
  name: string;
  /** Hex like #FAA227 — rendered translucent over the bin icon. */
  color: string;
  visible: boolean;
}

/** The built-in "how old is the data?" preset (red→green by Date Last Physical). */
export interface FreshnessPreset {
  enabled: boolean;
  /** Counted this recently (days) → full green. */
  greenDays: number;
  /** This long ago or more (days) → full red. */
  redDays: number;
}

export interface BayMap {
  version: 1;
  aisles: Aisle[];
  /** Sales-floor location tiles (aisle codes), same shape as back-room bins. */
  floor: Bin[];
  overlays: Overlay[];
  freshness: FreshnessPreset;
  updatedAt: number;
}

export type Area = 'bays' | 'floor';

/** Where a bin sits, for tooltips and the details panel. */
export type BinAddress =
  | {
      kind: 'bay';
      aisleId: string;
      aisleName: string;
      side: Side;
      /** 1-based, counted from the top shelf down. */
      shelf: number;
      /** 1-based, counted left to right. */
      slot: number;
    }
  | { kind: 'floor'; index: number };
