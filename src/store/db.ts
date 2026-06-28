import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Character, Encounter, Folder } from "../types";

// ── Swappable persistence boundary ──────────────────────────────────────────
// The app talks to this `Store` interface only. Today it's backed by IndexedDB
// (local-first, offline). A cloud-synced implementation can be dropped in later
// without touching the UI or the zustand store — it just has to satisfy `Store`.

export interface Store {
  loadAll(): Promise<{ folders: Folder[]; characters: Character[]; encounter: Encounter }>;
  putFolder(folder: Folder): Promise<void>;
  deleteFolder(id: string): Promise<void>;
  putCharacter(character: Character): Promise<void>;
  putCharacters(characters: Character[]): Promise<void>;
  deleteCharacter(id: string): Promise<void>;
  putEncounter(encounter: Encounter): Promise<void>;
  /** Wholesale replace (used by backup import). */
  replaceAll(data: { folders: Folder[]; characters: Character[]; encounter: Encounter }): Promise<void>;
}

const DEFAULT_ENCOUNTER: Encounter = { active: false, round: 1, turnCharId: null };

interface EBSchema extends DBSchema {
  folders: { key: string; value: Folder };
  characters: { key: string; value: Character };
  meta: { key: string; value: unknown };
}

const DB_NAME = "encounter-board";
const DB_VERSION = 1;
const ENCOUNTER_KEY = "encounter";

let dbPromise: Promise<IDBPDatabase<EBSchema>> | null = null;

function db(): Promise<IDBPDatabase<EBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<EBSchema>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains("folders")) {
          database.createObjectStore("folders", { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains("characters")) {
          database.createObjectStore("characters", { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains("meta")) {
          database.createObjectStore("meta");
        }
      },
    });
  }
  return dbPromise;
}

export const idbStore: Store = {
  async loadAll() {
    const database = await db();
    const [folders, characters, encounter] = await Promise.all([
      database.getAll("folders"),
      database.getAll("characters"),
      database.get("meta", ENCOUNTER_KEY) as Promise<Encounter | undefined>,
    ]);
    return {
      folders,
      characters,
      encounter: encounter ?? { ...DEFAULT_ENCOUNTER },
    };
  },

  async putFolder(folder) {
    const database = await db();
    await database.put("folders", folder);
  },

  async deleteFolder(id) {
    const database = await db();
    await database.delete("folders", id);
  },

  async putCharacter(character) {
    const database = await db();
    await database.put("characters", character);
  },

  async putCharacters(characters) {
    const database = await db();
    const tx = database.transaction("characters", "readwrite");
    await Promise.all([
      ...characters.map((c) => tx.store.put(c)),
      tx.done,
    ]);
  },

  async deleteCharacter(id) {
    const database = await db();
    await database.delete("characters", id);
  },

  async putEncounter(encounter) {
    const database = await db();
    await database.put("meta", encounter, ENCOUNTER_KEY);
  },

  async replaceAll(data) {
    const database = await db();
    const tx = database.transaction(["folders", "characters", "meta"], "readwrite");
    await tx.objectStore("folders").clear();
    await tx.objectStore("characters").clear();
    for (const f of data.folders) await tx.objectStore("folders").put(f);
    for (const c of data.characters) await tx.objectStore("characters").put(c);
    await tx.objectStore("meta").put(data.encounter, ENCOUNTER_KEY);
    await tx.done;
  },
};
