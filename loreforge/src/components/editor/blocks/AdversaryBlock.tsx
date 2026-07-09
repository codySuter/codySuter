import { useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { PencilLine, Swords } from "lucide-react";
import {
  parseData, defaultAdversary, featureLines, parseFeatureLines, type AdversaryData,
} from "../blockData";
import { EditDialog, Field, Grid, TextArea, useDraft } from "../EditDialog";
import { RollableText } from "./RollableText";
import { useEditorEnv } from "../EditorEnv";

export const AdversaryBlock = createReactBlockSpec(
  {
    type: "adversary" as const,
    propSchema: { data: { default: "" } },
    content: "none" as const,
  },
  {
    render: ({ block, editor }) => {
      const data = parseData<AdversaryData>(block.props.data, defaultAdversary);
      const [editing, setEditing] = useState(block.props.data === "");
      const env = useEditorEnv();
      const isEnvironment = data.role.toLowerCase() === "environment";

      const save = (next: AdversaryData) => {
        editor.updateBlock(block, { props: { data: JSON.stringify(next) } });
        setEditing(false);
      };

      const stat = (label: string, value: string | number) =>
        value !== "" && value !== undefined && (
          <div className="adv-stat">
            <span className="s-label">{label}</span>
            <span className="s-value">{value}</span>
          </div>
        );

      return (
        <div className="lf-adversary" contentEditable={false}>
          <div className="lf-block-edit">
            <button className="lf-icon-btn" title="Edit adversary" onClick={() => setEditing(true)}>
              <PencilLine size={13} />
            </button>
          </div>
          <div className="adv-head">
            <span className="adv-name">{data.name}</span>
            <span className="adv-tier">Tier {data.tier} {data.role}</span>
          </div>
          <div className="adv-desc">{data.description}</div>
          {data.motives && (
            <div className="adv-motives">
              <b>Motives &amp; tactics:</b> {data.motives}
            </div>
          )}
          <div className="adv-stats">
            {stat("Difficulty", data.difficulty)}
            {!isEnvironment && stat("Thresholds", data.thresholds)}
            {!isEnvironment && stat("HP", data.hp)}
            {!isEnvironment && stat("Stress", data.stress)}
            {data.experience ? stat("Experience", data.experience) : null}
          </div>
          {!isEnvironment && data.weapon && (
            <div className="adv-attack">
              <Swords size={13} style={{ verticalAlign: -2, marginRight: 6, color: "var(--accent-text)" }} />
              <b
                className="lf-dice-chip"
                style={{ marginRight: 6 }}
                title={`Roll attack: 1d20${data.atk}`}
                onClick={() => env.roller.rollExpr(`1d20${data.atk.startsWith("+") || data.atk.startsWith("-") ? data.atk : `+${data.atk}`}`, `${data.name} — ${data.weapon}`)}
              >
                {data.atk} {data.weapon}
              </b>
              <span style={{ color: "var(--text-2)", fontSize: 13 }}>
                {data.range} · <RollableText text={data.damage} label={`${data.name} — damage`} />
              </span>
            </div>
          )}
          {data.features.length > 0 && (
            <>
              <div className="adv-section">Features</div>
              {data.features.map((feature, i) => (
                <p className="adv-feature" key={i}>
                  <span className="f-name">{feature.name}</span>
                  <span className="f-type">{feature.type}</span>
                  <br />
                  <RollableText text={feature.text} label={`${data.name} — ${feature.name}`} />
                </p>
              ))}
            </>
          )}
          {editing && <AdversaryEditor initial={data} onCancel={() => setEditing(false)} onSave={save} />}
        </div>
      );
    },
  },
);

function AdversaryEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: AdversaryData;
  onSave: (data: AdversaryData) => void;
  onCancel: () => void;
}) {
  const [draft, patch] = useDraft(initial);
  const [features, setFeatures] = useState(featureLines(initial.features));

  const commit = () => onSave({ ...draft, features: parseFeatureLines(features) });

  const text = (key: keyof AdversaryData, label: string, span = 1) => (
    <Field label={label} span={span}>
      <input
        className="lf-input"
        value={String(draft[key] ?? "")}
        onChange={(e) => patch({ [key]: e.target.value } as Partial<AdversaryData>)}
      />
    </Field>
  );
  const number = (key: keyof AdversaryData, label: string) => (
    <Field label={label}>
      <input
        className="lf-input"
        type="number"
        value={Number(draft[key] ?? 0)}
        onChange={(e) => patch({ [key]: parseInt(e.target.value || "0", 10) } as Partial<AdversaryData>)}
      />
    </Field>
  );

  return (
    <EditDialog title="Edit Adversary" onClose={onCancel} onSave={commit} width={680}>
      <Grid cols={4}>
        {text("name", "Name", 2)}
        {number("tier", "Tier")}
        <Field label="Role">
          <select
            className="lf-input"
            value={draft.role}
            onChange={(e) => patch({ role: e.target.value })}
          >
            {["Bruiser", "Horde", "Leader", "Lurker", "Minion", "Ranged", "Skulk", "Social", "Solo", "Standard", "Support", "Environment"].map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
          </select>
        </Field>
      </Grid>
      <Grid cols={1}>
        {text("description", "Description")}
        {text("motives", "Motives & tactics")}
      </Grid>
      <Grid cols={4}>
        {number("difficulty", "Difficulty")}
        {text("thresholds", "Thresholds (Maj/Sev)")}
        {number("hp", "HP")}
        {number("stress", "Stress")}
      </Grid>
      <Grid cols={4}>
        {text("atk", "ATK (+2)")}
        {text("weapon", "Weapon")}
        {text("range", "Range")}
        {text("damage", "Damage (1d8+3 phy)")}
      </Grid>
      <Grid cols={1}>
        {text("experience", "Experience (e.g. Tracker +2)")}
        <Field label="Features" hint='one per line: "Name (Action/Reaction/Passive/Action: Fear). Description"'>
          <TextArea value={features} onChange={setFeatures} rows={5} />
        </Field>
      </Grid>
    </EditDialog>
  );
}
