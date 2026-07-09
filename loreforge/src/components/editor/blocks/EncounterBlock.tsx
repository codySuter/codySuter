import { useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { ArrowDownWideNarrow, ChevronsRight, Dices, Plus, RotateCcw, X } from "lucide-react";
import { parseData, defaultEncounter, normalizeCombatant, type EncounterData } from "../blockData";
import { useEditorEnv } from "../EditorEnv";
import { Popover } from "../../ui/Popover";
import { roll } from "../../../lib/dice";
import { localId } from "../../../lib/utils";

const DND_CONDITIONS = ["Blinded", "Charmed", "Frightened", "Grappled", "Incapacitated", "Invisible", "Paralyzed", "Poisoned", "Prone", "Restrained", "Stunned", "Unconscious", "Concentrating"];
const DH_CONDITIONS = ["Hidden", "Restrained", "Vulnerable"];

export const EncounterBlock = createReactBlockSpec(
  {
    type: "encounter" as const,
    propSchema: { data: { default: "" } },
    content: "none" as const,
  },
  {
    render: ({ block, editor }) => {
      const env = useEditorEnv();
      const data = parseData<EncounterData>(block.props.data, defaultEncounter(env.mode));
      const combatants = data.combatants.map(normalizeCombatant);
      const [adding, setAdding] = useState(false);
      const [draft, setDraft] = useState({ name: "", init: "", hp: "10", ac: "", isPC: false });
      const [condMenu, setCondMenu] = useState<{ id: string; anchor: DOMRect } | null>(null);

      const persist = (next: Partial<EncounterData>) =>
        editor.updateBlock(block, { props: { data: JSON.stringify({ ...data, combatants, ...next }) } });

      const nextTurn = () => {
        if (combatants.length === 0) return;
        const nextIndex = (data.activeIndex + 1) % combatants.length;
        persist({ activeIndex: nextIndex, round: nextIndex === 0 ? data.round + 1 : data.round });
      };
      const sortByInit = () => {
        const sorted = [...combatants].sort((a, b) => b.init - a.init);
        persist({ combatants: sorted, activeIndex: 0 });
      };
      const conditions = env.mode === "daggerheart" ? DH_CONDITIONS : DND_CONDITIONS;

      return (
        <div className="lf-encounter" contentEditable={false}>
          <div className="en-head">
            <span className="en-title">{data.title}</span>
            <span className="en-round">Round {data.round}</span>
            {data.useInitiative && (
              <button className="lf-icon-btn" title="Sort by initiative" onClick={sortByInit}>
                <ArrowDownWideNarrow size={14} />
              </button>
            )}
            <button className="lf-icon-btn" title="Reset rounds" onClick={() => persist({ round: 1, activeIndex: 0 })}>
              <RotateCcw size={13} />
            </button>
            <button className="lf-btn primary" style={{ padding: "3px 10px", fontSize: 12 }} onClick={nextTurn}>
              <ChevronsRight size={13} /> Next turn
            </button>
          </div>
          {combatants.map((combatant, index) => (
            <div
              key={combatant.id}
              className="en-row"
              data-active={index === data.activeIndex}
              data-down={combatant.hp <= 0}
              onClick={() => persist({ activeIndex: index })}
            >
              {data.useInitiative && (
                <span
                  className="en-init"
                  title={combatant.isPC ? "Initiative" : "Click to roll initiative (1d20)"}
                  style={{ cursor: combatant.isPC ? "default" : "pointer" }}
                  onClick={(e) => {
                    if (combatant.isPC) return;
                    e.stopPropagation();
                    const value = roll("1d20").total;
                    persist({
                      combatants: combatants.map((c) => (c.id === combatant.id ? { ...c, init: value } : c)),
                    });
                  }}
                >
                  {combatant.init}
                </span>
              )}
              <span className="en-name">
                {combatant.isPC && <span className="pc-dot" title="Player character" />}
                {combatant.name}
                {combatant.ac && (
                  <span style={{ color: "var(--text-3)", fontSize: 12, marginLeft: 7 }}>AC {combatant.ac}</span>
                )}
              </span>
              <span className="en-conditions">
                {combatant.conditions.map((condition) => (
                  <span
                    key={condition}
                    className="lf-chip chip-violet"
                    style={{ cursor: "pointer" }}
                    title="Remove condition"
                    onClick={(e) => {
                      e.stopPropagation();
                      persist({
                        combatants: combatants.map((c) =>
                          c.id === combatant.id
                            ? { ...c, conditions: c.conditions.filter((x) => x !== condition) }
                            : c,
                        ),
                      });
                    }}
                  >
                    {condition}
                  </span>
                ))}
                <button
                  className="lf-icon-btn"
                  style={{ width: 18, height: 18 }}
                  title="Add condition"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCondMenu({ id: combatant.id, anchor: e.currentTarget.getBoundingClientRect() });
                  }}
                >
                  <Plus size={11} />
                </button>
              </span>
              <span className="en-hp" onClick={(e) => e.stopPropagation()}>
                <input
                  type="number"
                  value={combatant.hp}
                  onChange={(e) => {
                    const hp = parseInt(e.target.value || "0", 10);
                    persist({
                      combatants: combatants.map((c) => (c.id === combatant.id ? { ...c, hp } : c)),
                    });
                  }}
                />
                / {combatant.maxHp}
              </span>
              <button
                className="lf-icon-btn"
                style={{ width: 20, height: 20 }}
                title="Remove"
                onClick={(e) => {
                  e.stopPropagation();
                  const remaining = combatants.filter((c) => c.id !== combatant.id);
                  persist({
                    combatants: remaining,
                    activeIndex: Math.min(data.activeIndex, Math.max(0, remaining.length - 1)),
                  });
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {combatants.length === 0 && (
            <div style={{ padding: "16px 12px", color: "var(--text-3)", fontSize: 13, textAlign: "center" }}>
              No combatants yet — add the party and their problems below.
            </div>
          )}
          <div className="en-foot">
            {adding ? (
              <>
                <input
                  autoFocus
                  className="lf-input"
                  style={{ flex: 2 }}
                  placeholder="Name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && addCombatant()}
                />
                {data.useInitiative && (
                  <input
                    className="lf-input"
                    style={{ width: 64 }}
                    placeholder="Init"
                    title="Initiative (blank = roll d20)"
                    value={draft.init}
                    onChange={(e) => setDraft({ ...draft, init: e.target.value })}
                  />
                )}
                <input
                  className="lf-input"
                  style={{ width: 64 }}
                  placeholder="HP"
                  value={draft.hp}
                  onChange={(e) => setDraft({ ...draft, hp: e.target.value })}
                />
                <input
                  className="lf-input"
                  style={{ width: 58 }}
                  placeholder="AC"
                  value={draft.ac}
                  onChange={(e) => setDraft({ ...draft, ac: e.target.value })}
                />
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-2)" }}>
                  <input
                    type="checkbox"
                    checked={draft.isPC}
                    onChange={(e) => setDraft({ ...draft, isPC: e.target.checked })}
                  />
                  PC
                </label>
                <button className="lf-btn primary" style={{ fontSize: 12 }} onClick={addCombatant}>
                  Add
                </button>
                <button className="lf-btn" style={{ fontSize: 12 }} onClick={() => setAdding(false)}>
                  Done
                </button>
              </>
            ) : (
              <button className="lf-btn" style={{ fontSize: 12.5 }} onClick={() => setAdding(true)}>
                <Plus size={13} /> Add combatant
              </button>
            )}
          </div>
          {condMenu && (
            <Popover anchor={condMenu.anchor} onClose={() => setCondMenu(null)} width={190}>
              {conditions.map((condition) => (
                <button
                  key={condition}
                  className="lf-menu-item"
                  onClick={() => {
                    persist({
                      combatants: combatants.map((c) =>
                        c.id === condMenu.id && !c.conditions.includes(condition)
                          ? { ...c, conditions: [...c.conditions, condition] }
                          : c,
                      ),
                    });
                    setCondMenu(null);
                  }}
                >
                  {condition}
                </button>
              ))}
            </Popover>
          )}
        </div>
      );

      function addCombatant() {
        if (!draft.name.trim()) return;
        const hp = parseInt(draft.hp || "10", 10);
        const init = draft.init.trim() === "" ? (data.useInitiative ? roll("1d20").total : 0) : parseInt(draft.init, 10);
        persist({
          combatants: [
            ...combatants,
            normalizeCombatant({ id: localId(), name: draft.name.trim(), init, hp, maxHp: hp, ac: draft.ac, isPC: draft.isPC }),
          ],
        });
        setDraft({ name: "", init: "", hp: "10", ac: "", isPC: false });
      }
    },
  },
);
