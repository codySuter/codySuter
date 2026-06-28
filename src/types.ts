// ── Core domain model ───────────────────────────────────────────────────────
// Everything is local-first and serializable to JSON so the same shapes can be
// persisted to IndexedDB today and synced to a cloud backend later.

export type Faction = "enemy" | "ally" | "neutral";

export type CharKind = "monster" | "npc" | "boss" | "pc";

/** Tile footprint on the board. small = 1×1, medium = 2 wide, large = 2×2. */
export type TileSize = "small" | "medium" | "large";

export type AbilityKey = "str" | "dex" | "con" | "int" | "wis" | "cha";

export type AbilityScores = Record<AbilityKey, number>;

export type ActionKind = "action" | "special" | "legendary" | "reaction";

export interface Action {
  id: string;
  name: string;
  desc: string;
  /** to-hit bonus, when the action is an attack roll */
  attackBonus?: number | null;
  /** short damage string, e.g. "1d6+2 slashing" */
  damage?: string;
  kind: ActionKind;
}

export interface ActiveCondition {
  /** condition name, e.g. "Poisoned" */
  name: string;
  /** optional remaining duration in rounds; null = until removed */
  rounds: number | null;
}

export interface Character {
  id: string;
  name: string;
  kind: CharKind;
  faction: Faction;
  size: TileSize;

  /** portrait — image URL or data URL; falls back to `emoji` */
  imageUrl?: string;
  emoji?: string;

  // ── stats ──
  ac: number;
  maxHp: number;
  hp: number;
  tempHp: number;
  abilities: AbilityScores;

  // ── descriptive ──
  cr?: string; // "1/4", "5"
  xp?: number;
  creatureType?: string; // "humanoid"
  dndSize?: string; // D&D size category, e.g. "Small"
  alignment?: string;
  speed?: string;
  senses?: string;
  languages?: string;

  // ── combat live state ──
  /** dexterity-derived default initiative modifier */
  initiativeMod: number;
  /** rolled/assigned initiative for the current encounter; null = not in order */
  initiative: number | null;

  actions: Action[];
  conditions: ActiveCondition[];
  notes?: string;

  // ── organization ──
  /** library folder this character is filed under; null = unfiled */
  folderId: string | null;
  /** whether the character is currently placed on the active board */
  onBoard: boolean;
  /** manual ordering within the board / a folder */
  sortIndex: number;

  createdAt: number;
  updatedAt: number;
}

export interface Folder {
  id: string;
  name: string;
  color: string; // a tailwind-ish accent token key, see lib/theme
  sortIndex: number;
  createdAt: number;
}

/** Encounter-wide live state (round tracker + whose turn it is). */
export interface Encounter {
  active: boolean;
  round: number;
  /** id of the character whose turn it is, or null */
  turnCharId: string | null;
}

export interface AppData {
  version: number;
  folders: Folder[];
  characters: Character[];
  encounter: Encounter;
}
