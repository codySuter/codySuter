import { cn } from "../lib/cn";

interface HpBarProps {
  hp: number;
  maxHp: number;
  tempHp: number;
  className?: string;
  /** show the numeric "hp / max (+temp)" label */
  showLabel?: boolean;
}

/** Color the fill by remaining fraction: green → amber → red. */
function fillColor(frac: number): string {
  if (frac > 0.5) return "bg-emerald-500";
  if (frac > 0.25) return "bg-amber-500";
  return "bg-rose-500";
}

export function HpBar({ hp, maxHp, tempHp, className, showLabel = true }: HpBarProps) {
  const frac = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
  const pct = Math.round(frac * 100);
  const down = hp <= 0;

  return (
    <div className={cn("w-full", className)}>
      {showLabel && (
        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
          <span className="font-medium text-slate-400">HP</span>
          <span className="tabular-nums">
            <span className={cn("font-semibold", down ? "text-rose-400" : "text-slate-100")}>
              {hp}
            </span>
            <span className="text-slate-500"> / {maxHp}</span>
            {tempHp > 0 && <span className="ml-1 font-medium text-sky-300">+{tempHp}</span>}
          </span>
        </div>
      )}
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-700/70">
        <div
          className={cn("h-full rounded-full transition-all duration-300", fillColor(frac))}
          style={{ width: `${pct}%` }}
        />
        {tempHp > 0 && (
          <div
            className="absolute inset-y-0 right-0 border-l border-slate-900/60 bg-sky-400/40"
            style={{ width: `${Math.min(100, Math.round((tempHp / Math.max(maxHp, 1)) * 100))}%` }}
          />
        )}
      </div>
    </div>
  );
}
