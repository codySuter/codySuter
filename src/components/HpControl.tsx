import { useState } from "react";
import { Heart, Shield, Swords } from "lucide-react";
import { HpBar } from "./HpBar";
import { cn } from "../lib/cn";

interface HpControlProps {
  hp: number;
  maxHp: number;
  tempHp: number;
  onDamage: (n: number) => void;
  onHeal: (n: number) => void;
  onSetTemp: (n: number) => void;
  compact?: boolean;
}

export function HpControl({
  hp,
  maxHp,
  tempHp,
  onDamage,
  onHeal,
  onSetTemp,
  compact,
}: HpControlProps) {
  const [value, setValue] = useState("");
  const [showTemp, setShowTemp] = useState(false);

  const amount = Math.abs(parseInt(value, 10)) || 0;

  function apply(kind: "dmg" | "heal") {
    if (amount <= 0) return;
    if (kind === "dmg") onDamage(amount);
    else onHeal(amount);
    setValue("");
  }

  return (
    <div className="space-y-1.5">
      <HpBar hp={hp} maxHp={maxHp} tempHp={tempHp} />
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => apply("dmg")}
          disabled={amount <= 0}
          className={cn(
            "flex items-center gap-1 rounded-lg bg-rose-500/15 px-2 py-1 text-xs font-semibold text-rose-300 transition enabled:hover:bg-rose-500/25 disabled:opacity-40",
          )}
          title="Apply damage"
        >
          <Swords size={13} />
          {!compact && "Dmg"}
        </button>
        <input
          type="number"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply("dmg");
          }}
          placeholder="0"
          className="w-12 rounded-lg border border-slate-700 bg-slate-950/60 px-1.5 py-1 text-center text-sm tabular-nums text-slate-100 outline-none focus:border-slate-500"
        />
        <button
          type="button"
          onClick={() => apply("heal")}
          disabled={amount <= 0}
          className="flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-300 transition enabled:hover:bg-emerald-500/25 disabled:opacity-40"
          title="Heal"
        >
          <Heart size={13} />
          {!compact && "Heal"}
        </button>
        <button
          type="button"
          onClick={() => setShowTemp((s) => !s)}
          className={cn(
            "ml-auto flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-medium transition",
            showTemp || tempHp > 0
              ? "bg-sky-500/15 text-sky-300"
              : "text-slate-400 hover:bg-slate-800",
          )}
          title="Temporary HP"
        >
          <Shield size={13} />
          {tempHp > 0 ? tempHp : !compact && "Temp"}
        </button>
      </div>
      {showTemp && (
        <div className="flex items-center gap-2 rounded-lg bg-slate-950/40 px-2 py-1">
          <span className="text-xs text-slate-400">Temp HP</span>
          <input
            type="number"
            inputMode="numeric"
            value={tempHp || ""}
            onChange={(e) => onSetTemp(parseInt(e.target.value, 10) || 0)}
            placeholder="0"
            className="w-14 rounded border border-slate-700 bg-slate-950/60 px-1.5 py-0.5 text-center text-sm tabular-nums text-slate-100 outline-none focus:border-slate-500"
          />
        </div>
      )}
    </div>
  );
}
