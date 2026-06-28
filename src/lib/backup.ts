import type {
  Action,
  ActionKind,
  ActiveCondition,
  AppData,
  CharKind,
  Character,
  Faction,
  Folder,
  TileSize,
} from "../types";
import { ABILITY_KEYS, DEFAULT_ABILITIES, abilityMod, uid } from "./dnd";

/** Serialize the full dataset and trigger a download as a .json backup file. */
export function downloadBackup(data: AppData): void {
  const payload = JSON.stringify(data, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `encounter-board-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── normalization helpers ───────────────────────────────────────────────────
// A backup file is untrusted input. Every record is coerced into a fully-formed
// value BEFORE the (destructive) import runs, so a malformed file is either
// rejected up front or safely repaired — never half-applied over good data.

const FACTIONS: Faction[] = ["enemy", "ally", "neutral"];
const KINDS: CharKind[] = ["monster", "npc", "boss", "pc"];
const SIZES: TileSize[] = ["small", "medium", "large"];
const ACTION_KINDS: ActionKind[] = ["action", "special", "reaction", "legendary"];

function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function oneOf<T extends string>(v: unknown, allowed: T[], fallback: T): T {
  return typeof v === "string" && (allowed as string[]).includes(v) ? (v as T) : fallback;
}

function normalizeAction(raw: unknown): Action {
  const a = (raw ?? {}) as Record<string, unknown>;
  const attackBonus =
    a.attackBonus == null ? null : Number.isFinite(Number(a.attackBonus)) ? Number(a.attackBonus) : null;
  return {
    id: typeof a.id === "string" && a.id ? a.id : uid(),
    name: typeof a.name === "string" ? a.name : "",
    desc: typeof a.desc === "string" ? a.desc : "",
    attackBonus,
    damage: typeof a.damage === "string" ? a.damage : "",
    kind: oneOf(a.kind, ACTION_KINDS, "action"),
  };
}

function normalizeConditions(raw: unknown): ActiveCondition[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && typeof (c as { name?: unknown }).name === "string")
    .map((c) => ({
      name: c.name as string,
      rounds: c.rounds == null ? null : Number.isFinite(Number(c.rounds)) ? Number(c.rounds) : null,
    }));
}

function normalizeCharacter(raw: unknown): Character {
  if (!raw || typeof raw !== "object") {
    throw new Error("Backup contains a character that isn't an object.");
  }
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== "string" || !c.id) {
    throw new Error("Backup contains a character with no id.");
  }

  const abilitiesRaw = (c.abilities ?? {}) as Record<string, unknown>;
  const abilities = { ...DEFAULT_ABILITIES };
  for (const k of ABILITY_KEYS) abilities[k] = num(abilitiesRaw[k], DEFAULT_ABILITIES[k]);

  const maxHp = Math.max(1, Math.round(num(c.maxHp, 1)));
  const now = Date.now();

  return {
    id: c.id,
    name: typeof c.name === "string" ? c.name : "",
    kind: oneOf(c.kind, KINDS, "monster"),
    faction: oneOf(c.faction, FACTIONS, "enemy"),
    size: oneOf(c.size, SIZES, "small"),
    imageUrl: typeof c.imageUrl === "string" ? c.imageUrl : undefined,
    emoji: typeof c.emoji === "string" ? c.emoji : undefined,
    ac: Math.max(0, Math.round(num(c.ac, 10))),
    maxHp,
    hp: Math.max(0, Math.min(maxHp, Math.round(num(c.hp, maxHp)))),
    tempHp: Math.max(0, Math.round(num(c.tempHp, 0))),
    abilities,
    cr: typeof c.cr === "string" ? c.cr : "",
    xp: num(c.xp, 0),
    creatureType: typeof c.creatureType === "string" ? c.creatureType : "",
    dndSize: typeof c.dndSize === "string" ? c.dndSize : "",
    alignment: typeof c.alignment === "string" ? c.alignment : "",
    speed: typeof c.speed === "string" ? c.speed : "",
    senses: typeof c.senses === "string" ? c.senses : "",
    languages: typeof c.languages === "string" ? c.languages : "",
    initiativeMod: Math.round(num(c.initiativeMod, abilityMod(abilities.dex))),
    initiative: c.initiative == null ? null : Number.isFinite(Number(c.initiative)) ? Number(c.initiative) : null,
    actions: Array.isArray(c.actions) ? c.actions.map(normalizeAction) : [],
    conditions: normalizeConditions(c.conditions),
    notes: typeof c.notes === "string" ? c.notes : "",
    folderId: typeof c.folderId === "string" ? c.folderId : null,
    onBoard: Boolean(c.onBoard),
    sortIndex: num(c.sortIndex, now),
    createdAt: num(c.createdAt, now),
    updatedAt: num(c.updatedAt, now),
  };
}

function normalizeFolder(raw: unknown): Folder {
  if (!raw || typeof raw !== "object") {
    throw new Error("Backup contains a folder that isn't an object.");
  }
  const f = raw as Record<string, unknown>;
  if (typeof f.id !== "string" || !f.id) {
    throw new Error("Backup contains a folder with no id.");
  }
  return {
    id: f.id,
    name: typeof f.name === "string" && f.name ? f.name : "Folder",
    color: typeof f.color === "string" ? f.color : "slate",
    sortIndex: num(f.sortIndex, Date.now()),
    createdAt: num(f.createdAt, Date.now()),
  };
}

/** Parse, validate, and normalize an uploaded backup file. Throws on bad input
 *  BEFORE anything destructive happens, so existing data is never lost to a
 *  malformed file. */
export async function readBackup(file: File): Promise<AppData> {
  const text = await file.text();
  let parsed: Partial<AppData>;
  try {
    parsed = JSON.parse(text) as Partial<AppData>;
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (!parsed || !Array.isArray(parsed.characters) || !Array.isArray(parsed.folders)) {
    throw new Error("That file doesn't look like an Encounter Board backup.");
  }

  const folders = parsed.folders.map(normalizeFolder);
  const folderIds = new Set(folders.map((f) => f.id));
  const characters = parsed.characters.map(normalizeCharacter).map((c) =>
    // drop dangling folder references so a character never hides in a missing folder
    c.folderId && !folderIds.has(c.folderId) ? { ...c, folderId: null } : c,
  );

  const enc = (parsed.encounter ?? {}) as Record<string, unknown>;
  return {
    version: num(parsed.version, 1),
    folders,
    characters,
    encounter: {
      active: Boolean(enc.active),
      round: Math.max(1, Math.round(num(enc.round, 1))),
      turnCharId: typeof enc.turnCharId === "string" ? enc.turnCharId : null,
    },
  };
}
