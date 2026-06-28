import { Plus, Minus, X } from "lucide-react";
import type { ActiveCondition } from "../types";
import { CONDITIONS, CONDITION_BY_NAME } from "../data/conditions";
import { Popover } from "./Popover";
import { cn } from "../lib/cn";

interface ConditionControlProps {
  conditions: ActiveCondition[];
  onToggle: (name: string) => void;
  onSetRounds: (name: string, rounds: number | null) => void;
  /** compact = chips only show icons (tiles); full shows the manage button too */
  size?: "compact" | "full";
}

export function ConditionChips({
  conditions,
  onToggle,
  interactive,
}: {
  conditions: ActiveCondition[];
  onToggle?: (name: string) => void;
  interactive?: boolean;
}) {
  if (conditions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {conditions.map((c) => {
        const meta = CONDITION_BY_NAME[c.name];
        const Icon = meta?.icon;
        return (
          <span
            key={c.name}
            title={`${c.name}${c.rounds != null ? ` — ${c.rounds} round(s) left` : ""}${meta?.desc ? `\n\n${meta.desc}` : ""}`}
            className="inline-flex items-center gap-1 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-200 ring-1 ring-amber-400/30"
          >
            {Icon ? <Icon size={12} /> : <span>{meta?.abbr ?? c.name.slice(0, 2)}</span>}
            <span className="max-w-[7rem] truncate">{c.name}</span>
            {c.rounds != null && (
              <span className="rounded bg-amber-400/20 px-1 tabular-nums">{c.rounds}</span>
            )}
            {interactive && onToggle && (
              <button
                type="button"
                onClick={() => onToggle(c.name)}
                className="ml-0.5 text-amber-300/70 hover:text-amber-100"
                aria-label={`Remove ${c.name}`}
              >
                <X size={11} />
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

export function ConditionControl({
  conditions,
  onToggle,
  onSetRounds,
  size = "full",
}: ConditionControlProps) {
  const active = new Set(conditions.map((c) => c.name));

  return (
    <div className="flex items-center gap-1.5">
      <ConditionChips conditions={conditions} onToggle={onToggle} interactive />
      <Popover
        align="left"
        trigger={({ toggle, open }) => (
          <button
            type="button"
            onClick={toggle}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-dashed border-slate-600 px-1.5 py-0.5 text-[11px] text-slate-400 transition hover:border-slate-500 hover:text-slate-200",
              open && "border-slate-500 text-slate-200",
            )}
          >
            <Plus size={12} />
            {size === "full" && conditions.length === 0 && "Condition"}
          </button>
        )}
        panelClassName="w-64 max-h-80 overflow-y-auto"
      >
        {() => (
          <div className="p-1">
            <div className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Conditions
            </div>
            <div className="space-y-0.5">
              {CONDITIONS.map((meta) => {
                const on = active.has(meta.name);
                const current = conditions.find((c) => c.name === meta.name);
                const Icon = meta.icon;
                return (
                  <div
                    key={meta.name}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-2 py-1 text-sm",
                      on ? "bg-amber-400/10 text-amber-100" : "text-slate-300 hover:bg-slate-800",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onToggle(meta.name)}
                      className="flex flex-1 items-center gap-2 text-left"
                      title={meta.desc}
                    >
                      <Icon size={14} className={on ? "text-amber-300" : "text-slate-500"} />
                      <span className="truncate">{meta.name}</span>
                    </button>
                    {on && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="rounded p-0.5 text-slate-400 hover:bg-slate-700 hover:text-slate-100"
                          onClick={() =>
                            onSetRounds(
                              meta.name,
                              current?.rounds == null ? 1 : Math.max(1, current.rounds - 1),
                            )
                          }
                          aria-label="Decrease rounds"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="w-9 text-center text-xs tabular-nums text-slate-300">
                          {current?.rounds == null ? "∞" : `${current.rounds}r`}
                        </span>
                        <button
                          type="button"
                          className="rounded p-0.5 text-slate-400 hover:bg-slate-700 hover:text-slate-100"
                          onClick={() =>
                            onSetRounds(meta.name, current?.rounds == null ? 1 : current.rounds + 1)
                          }
                          aria-label="Increase rounds"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Popover>
    </div>
  );
}
