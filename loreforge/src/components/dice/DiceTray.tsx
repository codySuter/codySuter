import { useState } from "react";
import { Dices, Eraser, X } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { useQ, useM } from "../../lib/data";
import { useUI } from "../../lib/store";
import { useRoller } from "../../lib/roller";
import type { WorkspaceDoc } from "../../lib/types";
import { timeAgo } from "../../lib/utils";

const DICE = [4, 6, 8, 10, 12, 20, 100];

export function DiceTray({ workspace }: { workspace: WorkspaceDoc }) {
  const ui = useUI();
  const roller = useRoller();
  const rolls = useQ(api.rolls.list, ui.diceTrayOpen ? { workspaceId: workspace._id } : "skip");
  const clearRolls = useM(api.rolls.clear);

  const [modifier, setModifier] = useState(0);
  const [mode, setMode] = useState<"normal" | "advantage" | "disadvantage">("normal");
  const [count, setCount] = useState(1);
  const [custom, setCustom] = useState("");

  const isDaggerheart = workspace.mode === "daggerheart";
  const modSuffix = modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : "";

  const rollDie = (sides: number) => {
    if (sides === 20 && mode !== "normal") {
      roller.rollCheck(modifier, mode, "d20");
      return;
    }
    roller.rollExpr(`${count}d${sides}${modSuffix}`, count > 1 ? `${count}d${sides}` : `d${sides}`);
  };

  if (!ui.diceTrayOpen) {
    return (
      <button className="dice-fab" title="Dice tray (⌘J)" onClick={() => ui.setDiceTray(true)}>
        <Dices size={21} />
      </button>
    );
  }

  return (
    <>
      <button className="dice-fab" title="Close dice tray (⌘J)" onClick={() => ui.setDiceTray(false)}>
        <X size={20} />
      </button>
      <div className="dice-tray">
        <div className="dt-head">
          <span className="dt-title">Dice Tray</span>
          {rolls && rolls.length > 0 && (
            <button
              className="lf-icon-btn"
              title="Clear history"
              onClick={() => void clearRolls({ workspaceId: workspace._id })}
            >
              <Eraser size={13} />
            </button>
          )}
        </div>

        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
          {isDaggerheart && (
            <button
              className="duality-btn"
              style={{ marginBottom: 10 }}
              onClick={() => roller.rollDualityDice(modifier, mode === "normal" ? "normal" : mode, "Duality")}
            >
              ✦ Duality Roll — Hope &amp; Fear
            </button>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
            {DICE.map((sides) => (
              <button key={sides} className="die-btn" onClick={() => rollDie(sides)}>
                d{sides}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <span className="seg" title="Number of dice">
              {[1, 2, 3, 4].map((n) => (
                <button key={n} data-on={count === n} onClick={() => setCount(n)}>
                  {n}×
                </button>
              ))}
            </span>
            <span className="seg" title="Modifier">
              <button onClick={() => setModifier((m) => m - 1)}>−</button>
              <button style={{ minWidth: 38, fontFamily: "var(--font-mono)" }} onClick={() => setModifier(0)}>
                {modifier >= 0 ? `+${modifier}` : modifier}
              </button>
              <button onClick={() => setModifier((m) => m + 1)}>+</button>
            </span>
            <span className="seg" title={isDaggerheart ? "Advantage adds +1d6, disadvantage −1d6" : "Applies to d20 rolls"}>
              <button data-on={mode === "disadvantage"} onClick={() => setMode(mode === "disadvantage" ? "normal" : "disadvantage")}>
                DIS
              </button>
              <button data-on={mode === "advantage"} onClick={() => setMode(mode === "advantage" ? "normal" : "advantage")}>
                ADV
              </button>
            </span>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <input
              className="lf-input"
              style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
              placeholder="Custom: 4d6kh3+2, 2d20kl1…"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && custom.trim()) {
                  roller.rollExpr(custom.trim());
                }
              }}
            />
            <button
              className="lf-btn primary"
              disabled={!custom.trim()}
              onClick={() => roller.rollExpr(custom.trim())}
            >
              Roll
            </button>
          </div>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {(rolls ?? []).length === 0 && (
            <div style={{ padding: "26px 16px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
              No rolls yet. The dice are listening.
            </div>
          )}
          {(rolls ?? []).map((roll) => {
            const detail = (roll.detail ?? {}) as { breakdown?: string; hope?: number; fear?: number };
            return (
              <div key={roll._id} className="roll-log-item" data-outcome={roll.outcome ?? "none"}>
                <span className="rl-total">{roll.total}</span>
                <span className="rl-detail">
                  <div className="rl-label">
                    {roll.label ?? roll.expression}
                    {roll.kind === "duality" && roll.outcome && (
                      <span style={{ fontWeight: 500, color: "var(--text-3)" }}>
                        {" "}
                        — {roll.outcome === "critical" ? "critical!" : `with ${roll.outcome}`}
                      </span>
                    )}
                    {roll.outcome === "crit" && <span style={{ color: "#55b884" }}> — nat 20!</span>}
                    {roll.outcome === "fumble" && <span style={{ color: "#ef7a7e" }}> — nat 1</span>}
                  </div>
                  <div className="rl-breakdown">
                    {roll.expression}
                    {detail.breakdown ? `  ${detail.breakdown}` : ""}
                  </div>
                </span>
                <span style={{ fontSize: 10.5, color: "var(--text-3)", flexShrink: 0 }}>
                  {timeAgo(roll._creationTime)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
