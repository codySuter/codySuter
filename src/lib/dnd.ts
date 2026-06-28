import type { AbilityKey, AbilityScores, CharKind, Faction } from "../types";

export const ABILITY_KEYS: AbilityKey[] = [
  "str",
  "dex",
  "con",
  "int",
  "wis",
  "cha",
];

export const ABILITY_LABEL: Record<AbilityKey, string> = {
  str: "STR",
  dex: "DEX",
  con: "CON",
  int: "INT",
  wis: "WIS",
  cha: "CHA",
};

export const DEFAULT_ABILITIES: AbilityScores = {
  str: 10,
  dex: 10,
  con: 10,
  int: 10,
  wis: 10,
  cha: 10,
};

/** D&D 5e ability modifier. */
export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Format a modifier with an explicit sign, e.g. 3 → "+3", -1 → "−1". */
export function formatMod(mod: number): string {
  return mod >= 0 ? `+${mod}` : `−${Math.abs(mod)}`;
}

/** Roll a fair die with `sides` faces. */
export function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

export const FACTION_LABEL: Record<Faction, string> = {
  enemy: "Enemy",
  ally: "Ally",
  neutral: "Neutral",
};

export const KIND_LABEL: Record<CharKind, string> = {
  monster: "Monster",
  npc: "NPC",
  boss: "Boss",
  pc: "PC",
};

/** A new unique id (no dependency — uses the platform crypto API). */
export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}
