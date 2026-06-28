import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Plus, Search } from "lucide-react";
import type { Faction } from "../types";
import { useStore } from "../store/useStore";
import {
  loadBestiary,
  searchBestiary,
  srdToCharacter,
  type SrdMonster,
} from "../lib/srd";
import { cn } from "../lib/cn";
import { Modal } from "./Modal";

const FACTIONS: Faction[] = ["enemy", "ally", "neutral"];
const RESULT_CAP = 120;

export function SrdImportDialog({ onClose }: { onClose: () => void }) {
  const folders = useStore((s) => s.folders);
  const addCharacter = useStore((s) => s.addCharacter);

  const [bestiary, setBestiary] = useState<SrdMonster[] | null>(null);
  const [query, setQuery] = useState("");
  const [faction, setFaction] = useState<Faction>("enemy");
  const [folderId, setFolderId] = useState<string>("");
  const [qty, setQty] = useState(1);
  const [useArt, setUseArt] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadBestiary().then((b) => {
      if (live) setBestiary(b);
    });
    return () => {
      live = false;
    };
  }, []);

  const results = useMemo(() => {
    if (!bestiary) return [];
    return searchBestiary(bestiary, query).slice(0, RESULT_CAP);
  }, [bestiary, query]);

  function add(m: SrdMonster) {
    const n = Math.max(1, Math.min(20, qty));
    for (let i = 0; i < n; i++) {
      const c = srdToCharacter(m, {
        faction,
        folderId: folderId || null,
        onBoard: true,
        useArt,
      });
      if (n > 1) c.name = `${m.name} ${i + 1}`;
      addCharacter(c);
    }
    setJustAdded(m.id);
    window.setTimeout(() => setJustAdded((cur) => (cur === m.id ? null : cur)), 900);
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Import from the 5e SRD bestiary"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg bg-slate-100 px-4 py-1.5 text-sm font-semibold text-slate-900 transition hover:bg-white"
        >
          Done
        </button>
      }
    >
      {/* controls */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2">
          <Search size={16} className="text-slate-500" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search 334 monsters — goblin, dragon, undead…"
            className="w-full bg-transparent text-sm text-slate-100 placeholder-slate-600 outline-none"
          />
        </div>

        <div className="flex flex-wrap items-end gap-3 text-xs">
          <div>
            <div className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Import as</div>
            <div className="flex overflow-hidden rounded-lg border border-slate-700">
              {FACTIONS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFaction(f)}
                  className={cn(
                    "px-2.5 py-1.5 capitalize transition",
                    faction === f ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:bg-slate-800",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Folder</div>
            <select
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-slate-200 outline-none focus:border-slate-500"
            >
              <option value="">Unfiled</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Quantity</div>
            <input
              type="number"
              min={1}
              max={20}
              value={qty}
              onChange={(e) => setQty(Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)))}
              className="w-16 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-center tabular-nums text-slate-200 outline-none focus:border-slate-500"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 pb-1.5 text-slate-400">
            <input
              type="checkbox"
              checked={useArt}
              onChange={(e) => setUseArt(e.target.checked)}
              className="accent-sky-500"
            />
            Use official art when available
          </label>
        </div>

        {/* results */}
        <div className="max-h-[50vh] min-h-[16rem] overflow-y-auto rounded-xl border border-slate-800">
          {!bestiary ? (
            <div className="flex h-40 items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" /> Loading bestiary…
            </div>
          ) : results.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-500">
              No monsters match “{query}”.
            </div>
          ) : (
            <ul className="divide-y divide-slate-800/70">
              {results.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-3 px-3 py-2 transition hover:bg-slate-800/40"
                >
                  <span className="text-xl leading-none">{m.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-slate-100">{m.name}</span>
                      {m.isBoss && (
                        <span className="rounded bg-amber-400/15 px-1 text-[10px] font-semibold text-amber-300">
                          legendary
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[11px] text-slate-500">
                      CR {m.cr} · {m.dndSize} {m.creatureType} · AC {m.ac} · {m.maxHp} HP ·{" "}
                      {m.actions.length} actions
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => add(m)}
                    className={cn(
                      "flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition",
                      justAdded === m.id
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-slate-700/70 text-slate-200 hover:bg-slate-600",
                    )}
                  >
                    {justAdded === m.id ? (
                      <>
                        <Check size={13} /> Added
                      </>
                    ) : (
                      <>
                        <Plus size={13} /> Add{qty > 1 ? ` ×${qty}` : ""}
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {bestiary && results.length === RESULT_CAP && (
          <p className="text-center text-[11px] text-slate-600">
            Showing the first {RESULT_CAP} matches — refine your search to narrow it down.
          </p>
        )}
      </div>
    </Modal>
  );
}
