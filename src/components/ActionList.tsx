import type { Action, ActionKind } from "../types";
import { formatMod } from "../lib/dnd";
import { cn } from "../lib/cn";

const KIND_LABEL: Record<ActionKind, string> = {
  special: "Traits",
  action: "Actions",
  reaction: "Reactions",
  legendary: "Legendary Actions",
};

// Grouping order (large tiles / editor). For flat/compact lists we surface
// attacks first since that's what a DM reaches for mid-turn.
const GROUP_ORDER: ActionKind[] = ["special", "action", "reaction", "legendary"];
const FLAT_ORDER: ActionKind[] = ["action", "special", "reaction", "legendary"];

interface ActionListProps {
  actions: Action[];
  /** compact hides descriptions, showing just the attack line */
  compact?: boolean;
  /** flat drops the group headers and shows one ordered list (small tiles) */
  flat?: boolean;
  className?: string;
  maxItems?: number;
}

function ActionRow({ a, compact }: { a: Action; compact?: boolean }) {
  return (
    <li className="text-xs leading-snug">
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="font-semibold text-slate-200">{a.name}</span>
        {a.attackBonus != null && (
          <span className="rounded bg-slate-700/60 px-1 text-[10px] font-semibold tabular-nums text-slate-200">
            {formatMod(a.attackBonus)}
          </span>
        )}
        {a.damage && (
          <span className="text-[11px] font-medium text-rose-300/90">{a.damage}</span>
        )}
      </div>
      {!compact && a.desc && (
        <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{a.desc}</p>
      )}
    </li>
  );
}

export function ActionList({ actions, compact, flat, className, maxItems }: ActionListProps) {
  if (actions.length === 0) {
    return <p className={cn("text-xs italic text-slate-500", className)}>No actions yet.</p>;
  }

  const limit = maxItems ?? Infinity;

  if (flat) {
    const ordered = [...actions].sort(
      (a, b) => FLAT_ORDER.indexOf(a.kind) - FLAT_ORDER.indexOf(b.kind),
    );
    const items = ordered.slice(0, limit);
    return (
      <div className={className}>
        <ul className="space-y-1">
          {items.map((a) => (
            <ActionRow key={a.id} a={a} compact={compact} />
          ))}
        </ul>
        {actions.length > items.length && (
          <p className="mt-1 text-[11px] italic text-slate-500">
            +{actions.length - items.length} more
          </p>
        )}
      </div>
    );
  }

  const grouped = GROUP_ORDER.map((kind) => ({
    kind,
    items: actions.filter((a) => a.kind === kind),
  })).filter((g) => g.items.length > 0);

  let shown = 0;
  return (
    <div className={cn("space-y-2", className)}>
      {grouped.map((group) => {
        const remaining = limit - shown;
        if (remaining <= 0) return null;
        const items = group.items.slice(0, remaining);
        shown += items.length;
        return (
          <div key={group.kind}>
            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {KIND_LABEL[group.kind]}
            </div>
            <ul className="space-y-1">
              {items.map((a) => (
                <ActionRow key={a.id} a={a} compact={compact} />
              ))}
            </ul>
          </div>
        );
      })}
      {maxItems != null && actions.length > maxItems && (
        <p className="text-[11px] italic text-slate-500">
          +{actions.length - maxItems} more — open details
        </p>
      )}
    </div>
  );
}
