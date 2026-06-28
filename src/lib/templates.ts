import type { Character, CharKind, Faction, TileSize } from "../types";
import { DEFAULT_ABILITIES, abilityMod, uid } from "./dnd";

export interface Template {
  key: string;
  label: string;
  emoji: string;
  description: string;
  kind: CharKind;
  faction: Faction;
  size: TileSize;
  ac: number;
  maxHp: number;
}

/** Quick-start templates surfaced in the "New character" menu. */
export const TEMPLATES: Template[] = [
  {
    key: "monster",
    label: "Monster",
    emoji: "👹",
    description: "A generic adversary. Fill in stats or import from the bestiary.",
    kind: "monster",
    faction: "enemy",
    size: "small",
    ac: 12,
    maxHp: 11,
  },
  {
    key: "boss",
    label: "Boss / Elite",
    emoji: "👑",
    description: "A complex, important enemy. Larger tile, room for many actions.",
    kind: "boss",
    faction: "enemy",
    size: "large",
    ac: 16,
    maxHp: 90,
  },
  {
    key: "npc-ally",
    label: "Allied NPC",
    emoji: "🛡️",
    description: "A friendly NPC fighting alongside the party.",
    kind: "npc",
    faction: "ally",
    size: "small",
    ac: 13,
    maxHp: 22,
  },
  {
    key: "npc-neutral",
    label: "Neutral NPC",
    emoji: "🧑",
    description: "A bystander, contact, or wildcard whose loyalty is unclear.",
    kind: "npc",
    faction: "neutral",
    size: "small",
    ac: 11,
    maxHp: 9,
  },
  {
    key: "pc",
    label: "Player Character",
    emoji: "⭐",
    description: "Track a party member's HP and conditions during the fight.",
    kind: "pc",
    faction: "ally",
    size: "small",
    ac: 15,
    maxHp: 30,
  },
];

/** Build a fresh, blank-ish character from a template. */
export function characterFromTemplate(t: Template): Character {
  const now = Date.now();
  const abilities = { ...DEFAULT_ABILITIES };
  return {
    id: uid(),
    name: "",
    kind: t.kind,
    faction: t.faction,
    size: t.size,
    emoji: t.emoji,
    ac: t.ac,
    maxHp: t.maxHp,
    hp: t.maxHp,
    tempHp: 0,
    abilities,
    cr: "",
    xp: 0,
    creatureType: "",
    dndSize: "Medium",
    alignment: "",
    speed: "30 ft.",
    senses: "",
    languages: "",
    initiativeMod: abilityMod(abilities.dex),
    initiative: null,
    actions: [],
    conditions: [],
    notes: "",
    folderId: null,
    onBoard: true,
    sortIndex: now,
    createdAt: now,
    updatedAt: now,
  };
}
