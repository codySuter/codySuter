import type {
  Action,
  Character,
  Faction,
  TileSize,
} from "../types";
import { uid } from "./dnd";

/** Shape of an entry in src/data/srd-monsters.json (produced by the transform). */
export interface SrdMonster {
  id: string;
  name: string;
  dndSize: string;
  creatureType: string;
  alignment: string;
  ac: number;
  maxHp: number;
  hitDice: string;
  speed: string;
  abilities: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  cr: string;
  crNum: number;
  xp: number;
  senses: string;
  languages: string;
  conditionImmunities: string[];
  initiativeMod: number;
  emoji: string;
  image: string | null;
  actions: Array<{
    name: string;
    desc: string;
    attackBonus: number | null;
    damage: string;
    kind: Action["kind"];
  }>;
  suggestedSize: TileSize;
  isBoss: boolean;
}

/** Base host for the optional official portrait art referenced by `image`. */
const SRD_IMAGE_HOST = "https://www.dnd5eapi.co";

export function srdImageUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${SRD_IMAGE_HOST}${path}`;
}

let cache: SrdMonster[] | null = null;

/** Lazily load (and cache) the bundled bestiary so it isn't in the initial JS. */
export async function loadBestiary(): Promise<SrdMonster[]> {
  if (cache) return cache;
  const mod = await import("../data/srd-monsters.json");
  cache = (mod.default ?? mod) as unknown as SrdMonster[];
  return cache;
}

/** Case-insensitive search across name and creature type, ranked by relevance. */
export function searchBestiary(list: SrdMonster[], query: string): SrdMonster[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  const scored = list
    .map((m) => {
      const name = m.name.toLowerCase();
      let score = -1;
      if (name === q) score = 100;
      else if (name.startsWith(q)) score = 80;
      else if (name.includes(q)) score = 50;
      else if (m.creatureType.toLowerCase().includes(q)) score = 20;
      return { m, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.m.crNum - b.m.crNum);
  return scored.map((x) => x.m);
}

/** Convert a bestiary entry into a fresh, editable board character. */
export function srdToCharacter(
  srd: SrdMonster,
  opts: { faction?: Faction; folderId?: string | null; onBoard?: boolean; useArt?: boolean } = {},
): Character {
  const now = Date.now();
  return {
    id: uid(),
    name: srd.name,
    kind: srd.isBoss ? "boss" : "monster",
    faction: opts.faction ?? "enemy",
    size: srd.suggestedSize,
    imageUrl: opts.useArt ? srdImageUrl(srd.image) : undefined,
    emoji: srd.emoji,
    ac: srd.ac,
    maxHp: srd.maxHp,
    hp: srd.maxHp,
    tempHp: 0,
    abilities: { ...srd.abilities },
    cr: srd.cr,
    xp: srd.xp,
    creatureType: srd.creatureType,
    dndSize: srd.dndSize,
    alignment: srd.alignment,
    speed: srd.speed,
    senses: srd.senses,
    languages: srd.languages,
    initiativeMod: srd.initiativeMod,
    initiative: null,
    actions: srd.actions.map((a) => ({
      id: uid(),
      name: a.name,
      desc: a.desc,
      attackBonus: a.attackBonus,
      damage: a.damage,
      kind: a.kind,
    })),
    conditions: [],
    notes: "",
    folderId: opts.folderId ?? null,
    onBoard: opts.onBoard ?? true,
    sortIndex: now,
    createdAt: now,
    updatedAt: now,
  };
}
