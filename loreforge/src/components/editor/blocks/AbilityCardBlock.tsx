import { useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { PencilLine } from "lucide-react";
import { parseData, defaultAbilityCard, statLines, parseStatLines, type AbilityCardData } from "../blockData";
import { EditDialog, Field, Grid, TextArea, useDraft } from "../EditDialog";
import { RollableText } from "./RollableText";
import { useEditorEnv } from "../EditorEnv";

export const AbilityCardBlock = createReactBlockSpec(
  {
    type: "abilityCard" as const,
    propSchema: { data: { default: "" } },
    content: "none" as const,
  },
  {
    render: ({ block, editor }) => {
      const env = useEditorEnv();
      const data = parseData<AbilityCardData>(block.props.data, defaultAbilityCard(env.mode));
      const [editing, setEditing] = useState(block.props.data === "");
      return (
        <div className="lf-abilitycard" contentEditable={false}>
          <div className="lf-block-edit">
            <button className="lf-icon-btn" title="Edit card" onClick={() => setEditing(true)}>
              <PencilLine size={13} />
            </button>
          </div>
          <div className="ac-kind">{data.kind}</div>
          <div className="ac-name">{data.name}</div>
          {data.subtitle && <div className="ac-subtitle">{data.subtitle}</div>}
          {data.stats.length > 0 && (
            <div className="ac-stats">
              {data.stats.map((stat, i) => (
                <span key={i}>
                  <b>{stat.label}</b>
                  <RollableText text={stat.value} label={`${data.name} — ${stat.label}`} />
                </span>
              ))}
            </div>
          )}
          <div className="ac-text">
            <RollableText text={data.text} label={data.name} />
          </div>
          {data.flavor && <div className="ac-flavor">{data.flavor}</div>}
          {editing && (
            <AbilityCardEditor
              initial={data}
              onCancel={() => setEditing(false)}
              onSave={(next) => {
                editor.updateBlock(block, { props: { data: JSON.stringify(next) } });
                setEditing(false);
              }}
            />
          )}
        </div>
      );
    },
  },
);

function AbilityCardEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: AbilityCardData;
  onSave: (data: AbilityCardData) => void;
  onCancel: () => void;
}) {
  const [draft, patch] = useDraft(initial);
  const [stats, setStats] = useState(statLines(initial.stats));
  return (
    <EditDialog
      title="Edit Ability Card"
      onClose={onCancel}
      onSave={() => onSave({ ...draft, stats: parseStatLines(stats) })}
    >
      <Grid cols={2}>
        <Field label="Name">
          <input className="lf-input" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
        </Field>
        <Field label="Kind (shown above the name)">
          <input className="lf-input" value={draft.kind} onChange={(e) => patch({ kind: e.target.value })} />
        </Field>
        <Field label="Subtitle" span={2}>
          <input className="lf-input" value={draft.subtitle} onChange={(e) => patch({ subtitle: e.target.value })} />
        </Field>
      </Grid>
      <Grid cols={1}>
        <Field label="Quick stats" hint='one per line: "Label: Value"'>
          <TextArea value={stats} onChange={setStats} rows={4} mono />
        </Field>
        <Field label="Rules text" hint="dice expressions become rollable">
          <TextArea value={draft.text} onChange={(text) => patch({ text })} rows={5} />
        </Field>
        <Field label="Flavor">
          <TextArea value={draft.flavor} onChange={(flavor) => patch({ flavor })} rows={2} />
        </Field>
      </Grid>
    </EditDialog>
  );
}
