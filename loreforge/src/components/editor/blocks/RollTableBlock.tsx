import { useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { Dices, PencilLine } from "lucide-react";
import { parseData, defaultRollTable, tableLines, parseTableLines, type RollTableData } from "../blockData";
import { EditDialog, Field, Grid, TextArea, useDraft } from "../EditDialog";
import { useEditorEnv } from "../EditorEnv";

export const RollTableBlock = createReactBlockSpec(
  {
    type: "rollTable" as const,
    propSchema: { data: { default: "" } },
    content: "none" as const,
  },
  {
    render: ({ block, editor }) => {
      const data = parseData<RollTableData>(block.props.data, defaultRollTable);
      const [editing, setEditing] = useState(block.props.data === "");
      const [hit, setHit] = useState<number | null>(null);
      const env = useEditorEnv();

      const rollIt = () => {
        const result = env.roller.rollExpr(`1${data.die}`, data.title);
        if (result) setHit(result.total);
      };

      return (
        <div className="lf-rolltable" contentEditable={false}>
          <div className="lf-block-edit">
            <button className="lf-icon-btn" title="Edit table" onClick={() => setEditing(true)}>
              <PencilLine size={13} />
            </button>
          </div>
          <div className="rt-head">
            <span className="rt-title">{data.title}</span>
            <span className="rt-die">{data.die}</span>
            <button className="lf-btn primary" style={{ padding: "3px 10px", fontSize: 12 }} onClick={rollIt}>
              <Dices size={13} /> Roll
            </button>
          </div>
          <table>
            <tbody>
              {data.rows.map((row, i) => (
                <tr key={i} data-hit={hit !== null && hit >= row.min && hit <= row.max}>
                  <td className="rt-range">{row.min === row.max ? row.min : `${row.min}–${row.max}`}</td>
                  <td>{row.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {editing && (
            <RollTableEditor
              initial={data}
              onCancel={() => setEditing(false)}
              onSave={(next) => {
                editor.updateBlock(block, { props: { data: JSON.stringify(next) } });
                setEditing(false);
                setHit(null);
              }}
            />
          )}
        </div>
      );
    },
  },
);

function RollTableEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: RollTableData;
  onSave: (data: RollTableData) => void;
  onCancel: () => void;
}) {
  const [draft, patch] = useDraft(initial);
  const [rows, setRows] = useState(tableLines(initial.rows));
  return (
    <EditDialog
      title="Edit Roll Table"
      onClose={onCancel}
      onSave={() => onSave({ ...draft, rows: parseTableLines(rows) })}
    >
      <Grid cols={3}>
        <Field label="Title" span={2}>
          <input className="lf-input" value={draft.title} onChange={(e) => patch({ title: e.target.value })} />
        </Field>
        <Field label="Die">
          <select className="lf-input" value={draft.die} onChange={(e) => patch({ die: e.target.value })}>
            {["d4", "d6", "d8", "d10", "d12", "d20", "d100"].map((die) => (
              <option key={die} value={die}>{die}</option>
            ))}
          </select>
        </Field>
      </Grid>
      <Grid cols={1}>
        <Field label="Rows" hint='one per line: "1-3. Result text"'>
          <TextArea value={rows} onChange={setRows} rows={9} mono />
        </Field>
      </Grid>
    </EditDialog>
  );
}
