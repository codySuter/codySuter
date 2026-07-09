/**
 * Typed access to the JSON `data` prop carried by Loreforge's custom blocks,
 * plus sensible defaults for freshly inserted blocks.
 */
import { localId } from "../../lib/utils";

export function parseData<T>(raw: string, fallback: T): T {
  if (!raw) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    return fallback;
  }
}

// ---------- statblock ----------
export interface SBEntry {
  name: string;
  text: string;
}
export interface StatblockData {
  name: string;
  meta: string;
  ac: string;
  hp: string;
  hpFormula: string;
  speed: string;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  saves: string;
  skills: string;
  resistances: string;
  immunities: string;
  vulnerabilities: string;
  senses: string;
  languages: string;
  cr: string;
  traits: SBEntry[];
  actions: SBEntry[];
  bonusActions: SBEntry[];
  reactions: SBEntry[];
  legendary: SBEntry[];
}
export const defaultStatblock: StatblockData = {
  name: "New Creature",
  meta: "Medium Humanoid, Neutral",
  ac: "12",
  hp: "22",
  hpFormula: "4d8 + 4",
  speed: "30 ft.",
  str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 10,
  saves: "", skills: "", resistances: "", immunities: "", vulnerabilities: "",
  senses: "Passive Perception 10",
  languages: "Common",
  cr: "1/2 (XP 100; PB +2)",
  traits: [],
  actions: [{ name: "Strike", text: "Melee Attack Roll: +3, reach 5 ft. Hit: 5 (1d6 + 2) damage." }],
  bonusActions: [],
  reactions: [],
  legendary: [],
};

// ---------- adversary (Daggerheart) ----------
export interface AdvFeature {
  name: string;
  type: string;
  text: string;
}
export interface AdversaryData {
  name: string;
  tier: number;
  role: string;
  description: string;
  motives: string;
  difficulty: number;
  thresholds: string;
  hp: number;
  stress: number;
  atk: string;
  weapon: string;
  range: string;
  damage: string;
  experience: string;
  features: AdvFeature[];
}
export const defaultAdversary: AdversaryData = {
  name: "New Adversary",
  tier: 1,
  role: "Standard",
  description: "A fitting description of this threat.",
  motives: "Menace, pursue, survive",
  difficulty: 11,
  thresholds: "7/12",
  hp: 5,
  stress: 3,
  atk: "+1",
  weapon: "Claws",
  range: "Melee",
  damage: "1d8+2 phy",
  experience: "",
  features: [],
};

// ---------- roll table ----------
export interface RollTableRow {
  min: number;
  max: number;
  text: string;
}
export interface RollTableData {
  title: string;
  die: string;
  rows: RollTableRow[];
}
export const defaultRollTable: RollTableData = {
  title: "Random Table",
  die: "d6",
  rows: [
    { min: 1, max: 2, text: "Something ominous." },
    { min: 3, max: 4, text: "Something curious." },
    { min: 5, max: 6, text: "Something valuable." },
  ],
};

// ---------- tracker ----------
export type TrackerKind = "hp" | "stress" | "hope" | "fear" | "armor" | "custom";
export interface TrackerItem {
  id: string;
  name: string;
  kind: TrackerKind;
  current: number;
  max: number;
}
export interface TrackerData {
  title: string;
  items: TrackerItem[];
}
export const defaultTracker = (mode: "dnd5e" | "daggerheart"): TrackerData =>
  mode === "daggerheart"
    ? {
        title: "Party Tracker",
        items: [
          { id: localId(), name: "Hope", kind: "hope", current: 2, max: 6 },
          { id: localId(), name: "Stress", kind: "stress", current: 0, max: 6 },
          { id: localId(), name: "Fear (GM)", kind: "fear", current: 2, max: 12 },
        ],
      }
    : {
        title: "Party Tracker",
        items: [
          { id: localId(), name: "Hit Points", kind: "hp", current: 20, max: 20 },
          { id: localId(), name: "Torch (rounds)", kind: "custom", current: 10, max: 10 },
        ],
      };

// ---------- ability card ----------
export interface AbilityCardData {
  name: string;
  kind: string;
  subtitle: string;
  stats: { label: string; value: string }[];
  text: string;
  flavor: string;
}
export const defaultAbilityCard = (mode: "dnd5e" | "daggerheart"): AbilityCardData =>
  mode === "daggerheart"
    ? {
        name: "New Ability",
        kind: "Domain · Level 1 Ability",
        subtitle: "",
        stats: [{ label: "Recall", value: "1" }],
        text: "Describe what the ability does.",
        flavor: "",
      }
    : {
        name: "New Spell",
        kind: "Spell · 1st Level",
        subtitle: "Evocation",
        stats: [
          { label: "Casting Time", value: "Action" },
          { label: "Range", value: "60 ft." },
          { label: "Duration", value: "Instantaneous" },
        ],
        text: "Describe what the spell does.",
        flavor: "",
      };

// ---------- encounter ----------
export interface Combatant {
  id: string;
  name: string;
  init: number;
  hp: number;
  maxHp: number;
  ac: string;
  isPC: boolean;
  conditions: string[];
  note: string;
}
export interface EncounterData {
  title: string;
  round: number;
  activeIndex: number;
  useInitiative: boolean;
  combatants: Combatant[];
}
export const defaultEncounter = (mode: "dnd5e" | "daggerheart"): EncounterData => ({
  title: mode === "daggerheart" ? "Spotlight Tracker" : "Encounter",
  round: 1,
  activeIndex: 0,
  useInitiative: mode !== "daggerheart",
  combatants: [],
});
export const normalizeCombatant = (c: Partial<Combatant>): Combatant => ({
  id: c.id ?? localId(),
  name: c.name ?? "Combatant",
  init: c.init ?? 0,
  hp: c.hp ?? 10,
  maxHp: c.maxHp ?? c.hp ?? 10,
  ac: c.ac ?? "",
  isPC: c.isPC ?? false,
  conditions: c.conditions ?? [],
  note: c.note ?? "",
});

// ---------- timeline ----------
export interface TimelineEvent {
  id: string;
  date: string;
  title: string;
  text: string;
  targetType?: "page" | "entry";
  targetId?: string;
  targetLabel?: string;
}
export interface TimelineEra {
  id: string;
  name: string;
  color: string;
  events: TimelineEvent[];
}
export interface TimelineData {
  title: string;
  eras: TimelineEra[];
}
export const defaultTimeline: TimelineData = {
  title: "Timeline",
  eras: [
    {
      id: localId(),
      name: "The First Era",
      color: "gold",
      events: [{ id: localId(), date: "Year 1", title: "It begins", text: "" }],
    },
  ],
};

// ---------- map ----------
export interface MapPin {
  id: string;
  x: number;
  y: number;
  label: string;
  color: string;
  targetType?: "page" | "entry";
  targetId?: string;
}
export interface MapData {
  title: string;
  pins: MapPin[];
}
export const defaultMap: MapData = { title: "New Map", pins: [] };

export const PIN_COLORS = ["gold", "red", "green", "blue", "violet", "teal", "gray"];
export const ERA_COLORS = ["gold", "red", "violet", "green", "blue", "gray"];

// ---------- line-format helpers (Name. Text) ----------

/** "Name. Text" per line -> entries. Lines without a period become text-only continuation. */
export function parseEntryLines(value: string): SBEntry[] {
  const entries: SBEntry[] = [];
  for (const raw of value.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const match = /^(.{1,80}?)\.\s+(.*)$/.exec(line);
    if (match) entries.push({ name: match[1], text: match[2] });
    else if (entries.length > 0) entries[entries.length - 1].text += ` ${line}`;
    else entries.push({ name: line.replace(/\.$/, ""), text: "" });
  }
  return entries;
}
export function entryLines(entries: SBEntry[]): string {
  return entries.map((e) => `${e.name}. ${e.text}`).join("\n");
}

/** "Name (Type). Text" per line for adversary features. */
export function parseFeatureLines(value: string): AdvFeature[] {
  const features: AdvFeature[] = [];
  for (const raw of value.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const match = /^(.{1,60}?)\s*\(([^)]+)\)\s*\.\s*(.*)$/.exec(line);
    if (match) features.push({ name: match[1], type: match[2], text: match[3] });
    else {
      const simple = /^(.{1,60}?)\.\s+(.*)$/.exec(line);
      if (simple) features.push({ name: simple[1], type: "Passive", text: simple[2] });
      else if (features.length > 0) features[features.length - 1].text += ` ${line}`;
    }
  }
  return features;
}
export function featureLines(features: AdvFeature[]): string {
  return features.map((f) => `${f.name} (${f.type}). ${f.text}`).join("\n");
}

/** "1-3. Text" or "4. Text" per line for roll tables. */
export function parseTableLines(value: string): RollTableRow[] {
  const rows: RollTableRow[] = [];
  for (const raw of value.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const match = /^(\d+)(?:\s*[-–]\s*(\d+))?[.):]\s*(.*)$/.exec(line);
    if (match) {
      const min = parseInt(match[1], 10);
      const max = match[2] ? parseInt(match[2], 10) : min;
      rows.push({ min, max: Math.max(min, max), text: match[3] });
    } else if (rows.length > 0) {
      rows[rows.length - 1].text += ` ${line}`;
    }
  }
  return rows;
}
export function tableLines(rows: RollTableRow[]): string {
  return rows
    .map((r) => `${r.min === r.max ? r.min : `${r.min}-${r.max}`}. ${r.text}`)
    .join("\n");
}

/** "Label: Value" per line for ability card stats. */
export function parseStatLines(value: string): { label: string; value: string }[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(":");
      if (idx === -1) return { label: line, value: "" };
      return { label: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
    });
}
export function statLines(stats: { label: string; value: string }[]): string {
  return stats.map((s) => `${s.label}: ${s.value}`).join("\n");
}
