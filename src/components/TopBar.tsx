import {
  ChevronLeft,
  ChevronRight,
  Dices,
  Flag,
  Play,
  Square,
  Swords,
} from "lucide-react";
import type { Character } from "../types";
import { useStore, boardOrder } from "../store/useStore";
import { FACTION_LABEL } from "../lib/dnd";
import { cn } from "../lib/cn";

export function TopBar() {
  const characters = useStore((s) => s.characters);
  const encounter = useStore((s) => s.encounter);
  const rollInitiativeAll = useStore((s) => s.rollInitiativeAll);
  const startEncounter = useStore((s) => s.startEncounter);
  const endEncounter = useStore((s) => s.endEncounter);
  const nextTurn = useStore((s) => s.nextTurn);
  const prevTurn = useStore((s) => s.prevTurn);

  const board = characters.filter((c) => c.onBoard);
  const ordered = boardOrder(characters, encounter);
  const current = board.find((c) => c.id === encounter.turnCharId) ?? null;

  const counts = board.reduce(
    (acc, c) => {
      acc[c.faction] += 1;
      return acc;
    },
    { enemy: 0, ally: 0, neutral: 0 },
  );

  return (
    <div className="border-b border-slate-800 bg-slate-950/60">
      {/* main row */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <Swords size={18} className="text-slate-500" />
          <div>
            <div className="text-sm font-semibold text-slate-200">Active Board</div>
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <span>{board.length} on board</span>
              {board.length > 0 && (
                <span className="flex items-center gap-1.5">
                  {counts.enemy > 0 && <Tally faction="enemy" n={counts.enemy} />}
                  {counts.ally > 0 && <Tally faction="ally" n={counts.ally} />}
                  {counts.neutral > 0 && <Tally faction="neutral" n={counts.neutral} />}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={rollInitiativeAll}
            disabled={board.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-200 transition enabled:hover:bg-slate-700 disabled:opacity-40"
            title="Roll initiative for everyone on the board"
          >
            <Dices size={15} /> Roll Initiative
          </button>

          {!encounter.active ? (
            <button
              type="button"
              onClick={startEncounter}
              disabled={board.length === 0}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-sm font-semibold text-emerald-300 transition enabled:hover:bg-emerald-500/30 disabled:opacity-40"
            >
              <Play size={15} /> Start Encounter
            </button>
          ) : (
            <>
              <div className="flex items-center gap-1 rounded-lg bg-slate-800 px-1 py-1">
                <button
                  type="button"
                  onClick={prevTurn}
                  className="rounded-md p-1 text-slate-300 transition hover:bg-slate-700"
                  aria-label="Previous turn"
                >
                  <ChevronLeft size={16} />
                </button>
                <div className="flex items-center gap-1.5 px-1.5 text-sm">
                  <Flag size={13} className="text-amber-400" />
                  <span className="font-semibold text-slate-100">Round {encounter.round}</span>
                </div>
                <button
                  type="button"
                  onClick={nextTurn}
                  className="rounded-md bg-slate-700 p-1 text-slate-100 transition hover:bg-slate-600"
                  aria-label="Next turn"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <button
                type="button"
                onClick={endEncounter}
                className="flex items-center gap-1.5 rounded-lg bg-rose-500/15 px-3 py-1.5 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/25"
              >
                <Square size={13} /> End
              </button>
            </>
          )}
        </div>
      </div>

      {/* initiative order strip */}
      {encounter.active && ordered.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto border-t border-slate-800/70 px-4 py-2">
          <span className="shrink-0 pr-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
            Order
          </span>
          {ordered.map((c) => (
            <TurnChip key={c.id} character={c} isCurrent={c.id === current?.id} />
          ))}
        </div>
      )}
    </div>
  );
}

function Tally({ faction, n }: { faction: Character["faction"]; n: number }) {
  return (
    <span data-faction={faction} className="inline-flex items-center gap-1" title={FACTION_LABEL[faction]}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }} />
      <span className="tabular-nums text-slate-400">{n}</span>
    </span>
  );
}

function TurnChip({ character: c, isCurrent }: { character: Character; isCurrent: boolean }) {
  const setTurn = useStore((s) => s.setTurn);

  return (
    <button
      type="button"
      data-faction={c.faction}
      onClick={() => setTurn(c.id)}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition",
        isCurrent ? "bg-[var(--accent-soft)]" : "border-transparent bg-slate-800/60 hover:bg-slate-800",
      )}
      style={isCurrent ? { borderColor: "var(--accent)" } : undefined}
      title={`${c.name} — initiative ${c.initiative ?? "—"}`}
    >
      <span className="text-sm leading-none">{c.emoji ?? "❔"}</span>
      <span className={cn("max-w-[8rem] truncate", isCurrent ? "font-semibold text-slate-100" : "text-slate-300")}>
        {c.name || "Unnamed"}
      </span>
      <span
        className="rounded bg-slate-950/60 px-1 text-[10px] font-bold tabular-nums text-slate-300"
      >
        {c.initiative ?? "—"}
      </span>
      {c.hp <= 0 && <span className="text-[10px] font-bold text-rose-400">▼</span>}
    </button>
  );
}
