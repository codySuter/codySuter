import { Swords, Plus, BookOpen } from "lucide-react";
import type { Character, Encounter } from "../types";
import { CharacterCard } from "./CharacterCard";

interface BoardProps {
  characters: Character[]; // already ordered for display
  encounter: Encounter;
  onEdit: (id: string) => void;
  onNew: () => void;
  onImport: () => void;
}

export function Board({ characters, encounter, onEdit, onNew, onImport }: BoardProps) {
  if (characters.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-slate-800/70 text-slate-500">
          <Swords size={30} />
        </div>
        <h2 className="text-lg font-semibold text-slate-200">Your board is empty</h2>
        <p className="mt-1 max-w-sm text-sm text-slate-500">
          Add monsters, NPCs, and adversaries as tiles. Drop in an SRD creature or
          build one from scratch — tiles resize to fill the space.
        </p>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onImport}
            className="flex items-center gap-2 rounded-lg bg-sky-500/15 px-3.5 py-2 text-sm font-semibold text-sky-300 transition hover:bg-sky-500/25"
          >
            <BookOpen size={16} /> Import from bestiary
          </button>
          <button
            type="button"
            onClick={onNew}
            className="flex items-center gap-2 rounded-lg bg-slate-800 px-3.5 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-700"
          >
            <Plus size={16} /> New character
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid auto-rows-[8rem] grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-3 p-4">
      {characters.map((c) => (
        <CharacterCard
          key={c.id}
          character={c}
          isTurn={encounter.active && encounter.turnCharId === c.id}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}
