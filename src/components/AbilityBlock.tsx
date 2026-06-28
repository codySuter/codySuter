import type { AbilityScores } from "../types";
import { ABILITY_KEYS, ABILITY_LABEL, abilityMod, formatMod } from "../lib/dnd";
import { cn } from "../lib/cn";

interface AbilityBlockProps {
  abilities: AbilityScores;
  className?: string;
  compact?: boolean;
}

export function AbilityBlock({ abilities, className, compact }: AbilityBlockProps) {
  return (
    <div className={cn("grid grid-cols-6 gap-1", className)}>
      {ABILITY_KEYS.map((k) => {
        const score = abilities[k];
        const mod = abilityMod(score);
        return (
          <div
            key={k}
            className="flex flex-col items-center rounded-lg bg-slate-950/40 py-1"
            title={`${ABILITY_LABEL[k]} ${score} (${formatMod(mod)})`}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {ABILITY_LABEL[k]}
            </span>
            <span className="text-sm font-semibold tabular-nums text-slate-200">
              {formatMod(mod)}
            </span>
            {!compact && (
              <span className="text-[10px] tabular-nums text-slate-500">{score}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
