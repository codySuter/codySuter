import { useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { PencilLine } from "lucide-react";
import { parseData, defaultStatblock, entryLines, parseEntryLines, type StatblockData, type SBEntry } from "../blockData";
import { EditDialog, Field, Grid, TextArea, useDraft } from "../EditDialog";
import { RollableText } from "./RollableText";
import { useEditorEnv } from "../EditorEnv";
import { abilityMod, formatMod } from "../../../lib/dice";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
const ABILITY_LABELS: Record<string, string> = {
  str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA",
};

export const StatblockBlock = createReactBlockSpec(
  {
    type: "statblock" as const,
    propSchema: { data: { default: "" } },
    content: "none" as const,
  },
  {
    render: ({ block, editor }) => {
      const data = parseData<StatblockData>(block.props.data, defaultStatblock);
      const [editing, setEditing] = useState(block.props.data === "");
      const env = useEditorEnv();

      const save = (next: StatblockData) => {
        editor.updateBlock(block, { props: { data: JSON.stringify(next) } });
        setEditing(false);
      };

      const section = (title: string, entries: SBEntry[]) =>
        entries.length > 0 && (
          <>
            <div className="sb-section">{title}</div>
            {entries.map((entry, i) => (
              <p className="sb-entry" key={i}>
                <b>{entry.name}.</b> <RollableText text={entry.text} label={`${data.name} — ${entry.name}`} />
              </p>
            ))}
          </>
        );

      const line = (label: string, value: string) =>
        value ? (
          <p className="sb-line">
            <b>{label}</b> <RollableText text={value} label={`${data.name} — ${label}`} />
          </p>
        ) : null;

      return (
        <div className="lf-statblock" contentEditable={false}>
          <div className="lf-block-edit">
            <button className="lf-icon-btn" title="Edit stat block" onClick={() => setEditing(true)}>
              <PencilLine size={13} />
            </button>
          </div>
          <div className="sb-name">{data.name}</div>
          <div className="sb-meta">{data.meta}</div>
          <hr className="sb-rule" />
          {line("AC", data.ac)}
          {line("HP", data.hpFormula ? `${data.hp} (${data.hpFormula})` : data.hp)}
          {line("Speed", data.speed)}
          <div className="sb-abilities">
            {ABILITIES.map((key) => {
              const score = data[key];
              const mod = abilityMod(score);
              return (
                <div
                  key={key}
                  className="sb-ability"
                  title={`Roll ${ABILITY_LABELS[key]} check (⌥ = disadvantage, ⇧ = advantage)`}
                  onClick={(e) => {
                    const mode = e.shiftKey ? "advantage" : e.altKey ? "disadvantage" : "normal";
                    env.roller.rollCheck(mod, mode, `${data.name} — ${ABILITY_LABELS[key]}`);
                  }}
                >
                  <div className="ab-name">{ABILITY_LABELS[key]}</div>
                  <div className="ab-score">{score}</div>
                  <div className="ab-mod">{formatMod(mod)}</div>
                </div>
              );
            })}
          </div>
          {line("Saves", data.saves)}
          {line("Skills", data.skills)}
          {line("Resistances", data.resistances)}
          {line("Immunities", data.immunities)}
          {line("Vulnerabilities", data.vulnerabilities)}
          {line("Senses", data.senses)}
          {line("Languages", data.languages)}
          {line("CR", data.cr)}
          {section("Traits", data.traits)}
          {section("Actions", data.actions)}
          {section("Bonus Actions", data.bonusActions)}
          {section("Reactions", data.reactions)}
          {section("Legendary Actions", data.legendary)}
          {editing && <StatblockEditor initial={data} onCancel={() => setEditing(false)} onSave={save} />}
        </div>
      );
    },
  },
);

function StatblockEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: StatblockData;
  onSave: (data: StatblockData) => void;
  onCancel: () => void;
}) {
  const [draft, patch] = useDraft(initial);
  const [traits, setTraits] = useState(entryLines(initial.traits));
  const [actions, setActions] = useState(entryLines(initial.actions));
  const [bonusActions, setBonusActions] = useState(entryLines(initial.bonusActions));
  const [reactions, setReactions] = useState(entryLines(initial.reactions));
  const [legendary, setLegendary] = useState(entryLines(initial.legendary));

  const commit = () =>
    onSave({
      ...draft,
      traits: parseEntryLines(traits),
      actions: parseEntryLines(actions),
      bonusActions: parseEntryLines(bonusActions),
      reactions: parseEntryLines(reactions),
      legendary: parseEntryLines(legendary),
    });

  const text = (key: keyof StatblockData, label: string, span = 1) => (
    <Field label={label} span={span}>
      <input className="lf-input" value={String(draft[key] ?? "")} onChange={(e) => patch({ [key]: e.target.value } as Partial<StatblockData>)} />
    </Field>
  );

  return (
    <EditDialog title="Edit Stat Block" onClose={onCancel} onSave={commit} width={680}>
      <Grid cols={4}>
        {text("name", "Name", 2)}
        {text("meta", "Size, Type, Alignment", 2)}
        {text("ac", "AC")}
        {text("hp", "HP")}
        {text("hpFormula", "HP Formula")}
        {text("speed", "Speed")}
      </Grid>
      <Grid cols={6}>
        {ABILITIES.map((key) => (
          <Field key={key} label={ABILITY_LABELS[key]}>
            <input
              className="lf-input"
              type="number"
              value={draft[key]}
              onChange={(e) => patch({ [key]: parseInt(e.target.value || "10", 10) } as Partial<StatblockData>)}
            />
          </Field>
        ))}
      </Grid>
      <Grid cols={2}>
        {text("saves", "Saving Throws")}
        {text("skills", "Skills")}
        {text("resistances", "Resistances")}
        {text("immunities", "Immunities")}
        {text("vulnerabilities", "Vulnerabilities")}
        {text("senses", "Senses")}
        {text("languages", "Languages")}
        {text("cr", "CR")}
      </Grid>
      <Grid cols={1}>
        <Field label="Traits" hint='one per line: "Name. Description"'>
          <TextArea value={traits} onChange={setTraits} rows={3} />
        </Field>
        <Field label="Actions" hint='one per line: "Name. Description" — dice like 2d6+3 become rollable'>
          <TextArea value={actions} onChange={setActions} rows={4} />
        </Field>
        <Field label="Bonus Actions">
          <TextArea value={bonusActions} onChange={setBonusActions} rows={2} />
        </Field>
        <Field label="Reactions">
          <TextArea value={reactions} onChange={setReactions} rows={2} />
        </Field>
        <Field label="Legendary Actions">
          <TextArea value={legendary} onChange={setLegendary} rows={2} />
        </Field>
      </Grid>
    </EditDialog>
  );
}
