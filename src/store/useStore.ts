import { create } from "zustand";
import type {
  Character,
  Encounter,
  Folder,
  TileSize,
  Faction,
} from "../types";
import { idbStore, type Store } from "./db";
import { abilityMod, rollDie, uid } from "../lib/dnd";
import { FOLDER_COLORS } from "../lib/theme";

const store: Store = idbStore;

/** Stable board ordering: by initiative when an encounter is running, else by
 *  manual sort index. Used for both rendering and turn advancement. */
export function boardOrder(characters: Character[], encounter: Encounter): Character[] {
  const board = characters.filter((c) => c.onBoard);
  if (encounter.active) {
    return [...board].sort((a, b) => {
      const ai = a.initiative ?? -Infinity;
      const bi = b.initiative ?? -Infinity;
      if (bi !== ai) return bi - ai;
      if (b.initiativeMod !== a.initiativeMod) return b.initiativeMod - a.initiativeMod;
      return a.name.localeCompare(b.name);
    });
  }
  return [...board].sort((a, b) => a.sortIndex - b.sortIndex);
}

interface StoreState {
  loaded: boolean;
  folders: Folder[];
  characters: Character[];
  encounter: Encounter;

  init: () => Promise<void>;

  // folders
  createFolder: (name: string, color?: string) => Folder;
  renameFolder: (id: string, name: string) => void;
  recolorFolder: (id: string, color: string) => void;
  deleteFolder: (id: string, opts?: { deleteContents?: boolean }) => void;

  // characters — lifecycle
  addCharacter: (c: Character) => void;
  updateCharacter: (id: string, patch: Partial<Character>) => void;
  deleteCharacter: (id: string) => void;
  duplicateCharacter: (id: string, opts?: { toBoard?: boolean }) => Character | undefined;

  // characters — organization
  setFolder: (id: string, folderId: string | null) => void;
  setSize: (id: string, size: TileSize) => void;
  setFaction: (id: string, faction: Faction) => void;
  addToBoard: (id: string) => void;
  removeFromBoard: (id: string) => void;

  // hp
  applyDamage: (id: string, amount: number) => void;
  applyHeal: (id: string, amount: number) => void;
  setTempHp: (id: string, value: number) => void;

  // conditions
  toggleCondition: (id: string, name: string) => void;
  setConditionRounds: (id: string, name: string, rounds: number | null) => void;
  clearConditions: (id: string) => void;

  // encounter / initiative
  rollInitiativeAll: () => void;
  setInitiative: (id: string, value: number | null) => void;
  setTurn: (charId: string | null) => void;
  startEncounter: () => void;
  endEncounter: () => void;
  nextTurn: () => void;
  prevTurn: () => void;

  // backup
  replaceAll: (data: { folders: Folder[]; characters: Character[]; encounter: Encounter }) => Promise<void>;
}

export const useStore = create<StoreState>((set, get) => {
  // ── helpers that mutate one character and persist it ──
  function patchChar(id: string, fn: (c: Character) => Character) {
    let updated: Character | undefined;
    set((s) => ({
      characters: s.characters.map((c) => {
        if (c.id !== id) return c;
        updated = { ...fn(c), updatedAt: Date.now() };
        return updated;
      }),
    }));
    if (updated) void store.putCharacter(updated);
  }

  function persistEncounter(enc: Encounter) {
    void store.putEncounter(enc);
  }

  // Guards against double-ticking timed conditions: a creature's conditions
  // tick at most once per round (keyed `round:charId`), so stepping back and
  // forth across turns never burns or deletes a timer.
  const tickedTurns = new Set<string>();

  return {
    loaded: false,
    folders: [],
    characters: [],
    encounter: { active: false, round: 1, turnCharId: null },

    async init() {
      const data = await store.loadAll();
      set({
        loaded: true,
        folders: data.folders,
        characters: data.characters,
        encounter: data.encounter,
      });
    },

    // ── folders ──
    createFolder(name, color) {
      const used = new Set(get().folders.map((f) => f.color));
      const pick =
        color ??
        (FOLDER_COLORS.find((c) => !used.has(c.key))?.key ?? FOLDER_COLORS[0].key);
      const folder: Folder = {
        id: uid(),
        name: name.trim() || "New folder",
        color: pick,
        sortIndex: Date.now(),
        createdAt: Date.now(),
      };
      set((s) => ({ folders: [...s.folders, folder] }));
      void store.putFolder(folder);
      return folder;
    },

    renameFolder(id, name) {
      let updated: Folder | undefined;
      set((s) => ({
        folders: s.folders.map((f) =>
          f.id === id ? (updated = { ...f, name: name.trim() || f.name }) : f,
        ),
      }));
      if (updated) void store.putFolder(updated);
    },

    recolorFolder(id, color) {
      let updated: Folder | undefined;
      set((s) => ({
        folders: s.folders.map((f) => (f.id === id ? (updated = { ...f, color }) : f)),
      }));
      if (updated) void store.putFolder(updated);
    },

    deleteFolder(id, opts) {
      const deleteContents = opts?.deleteContents ?? false;
      const affected = get().characters.filter((c) => c.folderId === id);
      set((s) => ({
        folders: s.folders.filter((f) => f.id !== id),
        characters: deleteContents
          ? s.characters.filter((c) => c.folderId !== id)
          : s.characters.map((c) =>
              c.folderId === id ? { ...c, folderId: null, updatedAt: Date.now() } : c,
            ),
      }));
      void store.deleteFolder(id);
      if (deleteContents) {
        for (const c of affected) void store.deleteCharacter(c.id);
      } else {
        for (const c of affected) {
          void store.putCharacter({ ...c, folderId: null, updatedAt: Date.now() });
        }
      }
    },

    // ── characters lifecycle ──
    addCharacter(c) {
      // Upsert by id so an accidental double-save can't insert a duplicate.
      set((s) => ({
        characters: s.characters.some((x) => x.id === c.id)
          ? s.characters.map((x) => (x.id === c.id ? c : x))
          : [...s.characters, c],
      }));
      void store.putCharacter(c);
    },

    updateCharacter(id, patch) {
      patchChar(id, (c) => ({ ...c, ...patch }));
    },

    deleteCharacter(id) {
      const enc = get().encounter;
      set((s) => ({ characters: s.characters.filter((c) => c.id !== id) }));
      void store.deleteCharacter(id);
      if (enc.turnCharId === id) {
        const next = { ...enc, turnCharId: null };
        set({ encounter: next });
        persistEncounter(next);
      }
    },

    duplicateCharacter(id, opts) {
      const original = get().characters.find((c) => c.id === id);
      if (!original) return undefined;
      const now = Date.now();
      // Number against ALL existing siblings so copies never collide:
      // "Goblin" (+ "Goblin 2", "Goblin 3") -> "Goblin 4".
      const base = (original.name.trim().match(/^(.*?)(?:\s+(\d+))?$/)?.[1] ?? original.name).trim();
      const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s+(\\d+))?$`);
      let maxN = 1;
      for (const c of get().characters) {
        const cm = c.name.trim().match(re);
        if (cm) maxN = Math.max(maxN, cm[1] ? parseInt(cm[1], 10) : 1);
      }
      const n = maxN + 1;
      const copy: Character = {
        ...original,
        id: uid(),
        name: `${base} ${n}`,
        hp: original.maxHp,
        tempHp: 0,
        initiative: null,
        conditions: [],
        actions: original.actions.map((a) => ({ ...a, id: uid() })),
        onBoard: opts?.toBoard ?? original.onBoard,
        sortIndex: now,
        createdAt: now,
        updatedAt: now,
      };
      set((s) => ({ characters: [...s.characters, copy] }));
      void store.putCharacter(copy);
      return copy;
    },

    // ── organization ──
    setFolder(id, folderId) {
      patchChar(id, (c) => ({ ...c, folderId }));
    },
    setSize(id, size) {
      patchChar(id, (c) => ({ ...c, size }));
    },
    setFaction(id, faction) {
      patchChar(id, (c) => ({ ...c, faction }));
    },
    addToBoard(id) {
      patchChar(id, (c) => ({ ...c, onBoard: true, sortIndex: Date.now() }));
    },
    removeFromBoard(id) {
      patchChar(id, (c) => ({ ...c, onBoard: false }));
    },

    // ── hp ──
    applyDamage(id, amount) {
      if (amount <= 0) return;
      patchChar(id, (c) => {
        let remaining = amount;
        let temp = c.tempHp;
        if (temp > 0) {
          const absorbed = Math.min(temp, remaining);
          temp -= absorbed;
          remaining -= absorbed;
        }
        const hp = Math.max(0, c.hp - remaining);
        return { ...c, hp, tempHp: temp };
      });
    },
    applyHeal(id, amount) {
      if (amount <= 0) return;
      patchChar(id, (c) => ({ ...c, hp: Math.min(c.maxHp, c.hp + amount) }));
    },
    setTempHp(id, value) {
      patchChar(id, (c) => ({ ...c, tempHp: Math.max(0, Math.floor(value) || 0) }));
    },

    // ── conditions ──
    toggleCondition(id, name) {
      patchChar(id, (c) => {
        const exists = c.conditions.some((x) => x.name === name);
        return {
          ...c,
          conditions: exists
            ? c.conditions.filter((x) => x.name !== name)
            : [...c.conditions, { name, rounds: null }],
        };
      });
    },
    setConditionRounds(id, name, rounds) {
      patchChar(id, (c) => ({
        ...c,
        conditions: c.conditions.map((x) =>
          x.name === name ? { ...x, rounds } : x,
        ),
      }));
    },
    clearConditions(id) {
      patchChar(id, (c) => ({ ...c, conditions: [] }));
    },

    // ── encounter / initiative ──
    rollInitiativeAll() {
      const now = Date.now();
      const updated: Character[] = [];
      set((s) => ({
        characters: s.characters.map((c) => {
          if (!c.onBoard) return c;
          const next = {
            ...c,
            initiative: rollDie(20) + c.initiativeMod,
            updatedAt: now,
          };
          updated.push(next);
          return next;
        }),
      }));
      void store.putCharacters(updated);
    },

    setInitiative(id, value) {
      patchChar(id, (c) => ({ ...c, initiative: value }));
    },

    setTurn(charId) {
      const next: Encounter = { ...get().encounter, turnCharId: charId };
      set({ encounter: next });
      persistEncounter(next);
    },

    startEncounter() {
      const s = get();
      const ordered = boardOrder(s.characters, { ...s.encounter, active: true });
      const first = ordered[0];
      const next: Encounter = {
        active: true,
        round: 1,
        turnCharId: first?.id ?? null,
      };
      tickedTurns.clear();
      // The opening combatant doesn't tick at round 1; mark it so navigating
      // away and back doesn't retroactively tick it either.
      if (first) tickedTurns.add(`1:${first.id}`);
      set({ encounter: next });
      persistEncounter(next);
    },

    endEncounter() {
      tickedTurns.clear();
      const next: Encounter = { active: false, round: 1, turnCharId: null };
      set({ encounter: next });
      persistEncounter(next);
    },

    nextTurn() {
      const s = get();
      const ordered = boardOrder(s.characters, s.encounter);
      if (ordered.length === 0) return;
      const curIdx = ordered.findIndex((c) => c.id === s.encounter.turnCharId);
      let nextIdx: number;
      let round = s.encounter.round;
      if (curIdx === -1) {
        // Current combatant left the board; resume at the top, no round change.
        nextIdx = 0;
      } else if (curIdx === ordered.length - 1) {
        nextIdx = 0;
        round += 1;
      } else {
        nextIdx = curIdx + 1;
      }
      const nextChar = ordered[nextIdx];
      const next: Encounter = { ...s.encounter, round, turnCharId: nextChar.id };
      set({ encounter: next });
      persistEncounter(next);
      // Tick the incoming creature's timed conditions — at most once per round.
      const key = `${round}:${nextChar.id}`;
      if (!tickedTurns.has(key)) {
        tickedTurns.add(key);
        tickConditions(nextChar.id);
      }
    },

    prevTurn() {
      const s = get();
      const ordered = boardOrder(s.characters, s.encounter);
      if (ordered.length === 0) return;
      const curIdx = ordered.findIndex((c) => c.id === s.encounter.turnCharId);
      let prevIdx: number;
      let round = s.encounter.round;
      if (curIdx === -1) {
        // Current combatant left the board; land at the top, no round change.
        prevIdx = 0;
      } else if (curIdx === 0) {
        // Genuine wrap from the first combatant back to the last.
        prevIdx = ordered.length - 1;
        round = Math.max(1, round - 1);
      } else {
        prevIdx = curIdx - 1;
      }
      const next: Encounter = { ...s.encounter, round, turnCharId: ordered[prevIdx].id };
      set({ encounter: next });
      persistEncounter(next);
    },

    async replaceAll(data) {
      await store.replaceAll(data);
      set({
        folders: data.folders,
        characters: data.characters,
        encounter: data.encounter,
      });
    },
  };

  // local closure helper — needs access to set/get above
  function tickConditions(charId: string) {
    let updated: Character | undefined;
    set((s) => ({
      characters: s.characters.map((c) => {
        if (c.id !== charId) return c;
        const conditions = c.conditions
          .map((x) => (x.rounds == null ? x : { ...x, rounds: x.rounds - 1 }))
          .filter((x) => x.rounds == null || x.rounds > 0);
        updated = { ...c, conditions, updatedAt: Date.now() };
        return updated;
      }),
    }));
    if (updated) void store.putCharacter(updated);
  }
});

/** Recompute a sensible initiative modifier from a character's DEX. */
export function initiativeModFor(c: Pick<Character, "abilities">): number {
  return abilityMod(c.abilities.dex);
}
