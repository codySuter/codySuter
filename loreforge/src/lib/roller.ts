import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useM } from "./data";
import { useUI, useToasts } from "./store";
import { roll, rollD20, rollDuality, type RollResult, type DualityResult } from "./dice";

export interface Roller {
  rollExpr: (expr: string, label?: string) => RollResult | null;
  rollCheck: (
    modifier: number,
    mode: "normal" | "advantage" | "disadvantage",
    label?: string,
  ) => RollResult;
  rollDualityDice: (
    modifier: number,
    mode: "normal" | "advantage" | "disadvantage",
    label?: string,
  ) => DualityResult;
}

/** Rolls dice, shows a toast, and persists to the workspace roll log. */
export function useRoller(): Roller {
  const workspaceId = useUI((s) => s.workspaceId);
  const log = useM(api.rolls.log);
  const push = useToasts((s) => s.push);

  const persist = (args: {
    label?: string;
    expression: string;
    kind: string;
    total: number;
    detail: unknown;
    outcome?: string;
  }) => {
    if (!workspaceId) return;
    void log({ workspaceId: workspaceId as Id<"workspaces">, ...args }).catch((error) =>
      console.error("roll log failed", error),
    );
  };

  return {
    rollExpr: (expr, label) => {
      let result: RollResult;
      try {
        result = roll(expr);
      } catch (error) {
        push({ title: "Can't roll that", body: String((error as Error).message) });
        return null;
      }
      const outcome = result.nat20 ? "crit" : result.nat1 ? "fumble" : undefined;
      push({
        title: `${label ? `${label} — ` : ""}${result.total}`,
        body: `${result.expression}  ${result.breakdown}`,
        tone: outcome === "crit" ? "crit" : outcome === "fumble" ? "fumble" : "default",
      });
      persist({
        label,
        expression: result.expression,
        kind: "standard",
        total: result.total,
        detail: { breakdown: result.breakdown },
        outcome,
      });
      return result;
    },

    rollCheck: (modifier, mode, label) => {
      const result = rollD20(modifier, mode, Math.random);
      const outcome = result.nat20 ? "crit" : result.nat1 ? "fumble" : undefined;
      const modeTag = mode === "advantage" ? " (adv)" : mode === "disadvantage" ? " (dis)" : "";
      push({
        title: `${label ? `${label} — ` : ""}${result.total}`,
        body: `${result.expression}${modeTag}  ${result.breakdown}`,
        tone: outcome === "crit" ? "crit" : outcome === "fumble" ? "fumble" : "default",
      });
      persist({
        label: label ? `${label}${modeTag}` : undefined,
        expression: result.expression,
        kind: mode,
        total: result.total,
        detail: { breakdown: result.breakdown },
        outcome,
      });
      return result;
    },

    rollDualityDice: (modifier, mode, label) => {
      const result = rollDuality(modifier, mode, Math.random);
      const flavor =
        result.outcome === "critical"
          ? "Critical success!"
          : result.outcome === "hope"
            ? "with Hope"
            : "with Fear";
      push({
        title: `${label ? `${label} — ` : ""}${result.total} ${flavor}`,
        body: result.breakdown,
        tone: result.outcome === "critical" ? "crit" : result.outcome,
      });
      persist({
        label,
        expression: modifier ? `2d12${modifier > 0 ? `+${modifier}` : modifier}` : "2d12",
        kind: "duality",
        total: result.total,
        detail: {
          hope: result.hope,
          fear: result.fear,
          bonusDie: result.bonusDie ?? null,
          breakdown: result.breakdown,
        },
        outcome: result.outcome,
      });
      return result;
    },
  };
}
