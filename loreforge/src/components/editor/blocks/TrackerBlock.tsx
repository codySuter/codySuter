import { useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { Minus, PencilLine, Plus, Trash2 } from "lucide-react";
import { parseData, defaultTracker, type TrackerData, type TrackerItem, type TrackerKind } from "../blockData";
import { EditDialog, Field, Grid } from "../EditDialog";
import { useEditorEnv } from "../EditorEnv";
import { localId } from "../../../lib/utils";

const KINDS: { id: TrackerKind; label: string }[] = [
  { id: "hp", label: "HP" },
  { id: "stress", label: "Stress" },
  { id: "hope", label: "Hope" },
  { id: "fear", label: "Fear" },
  { id: "armor", label: "Armor" },
  { id: "custom", label: "Custom" },
];

export const TrackerBlock = createReactBlockSpec(
  {
    type: "tracker" as const,
    propSchema: { data: { default: "" } },
    content: "none" as const,
  },
  {
    render: ({ block, editor }) => {
      const env = useEditorEnv();
      const data = parseData<TrackerData>(block.props.data, defaultTracker(env.mode));
      const [editing, setEditing] = useState(block.props.data === "");

      const persist = (next: TrackerData) =>
        editor.updateBlock(block, { props: { data: JSON.stringify(next) } });

      const bump = (id: string, delta: number) => {
        persist({
          ...data,
          items: data.items.map((item) =>
            item.id === id
              ? { ...item, current: Math.max(0, Math.min(item.max, item.current + delta)) }
              : item,
          ),
        });
      };
      const setTo = (id: string, value: number) => {
        persist({
          ...data,
          items: data.items.map((item) =>
            item.id === id ? { ...item, current: Math.max(0, Math.min(item.max, value)) } : item,
          ),
        });
      };

      return (
        <div className="lf-tracker" contentEditable={false}>
          <div className="lf-block-edit">
            <button className="lf-icon-btn" title="Edit tracker" onClick={() => setEditing(true)}>
              <PencilLine size={13} />
            </button>
          </div>
          <div className="tk-title">{data.title}</div>
          {data.items.map((item) => (
            <div className="tk-row" key={item.id}>
              <span className="tk-name">{item.name}</span>
              {item.max <= 12 ? (
                <span className={`tk-pips tk-${item.kind}`}>
                  {Array.from({ length: item.max }, (_, i) => (
                    <span
                      key={i}
                      className="tk-pip"
                      data-filled={i < item.current}
                      title={`Set to ${i + 1 === item.current ? i : i + 1}`}
                      onClick={() => setTo(item.id, i + 1 === item.current ? i : i + 1)}
                    />
                  ))}
                </span>
              ) : (
                <span className={`tk-bar tk-${item.kind}`}>
                  <span className="fill" style={{ width: `${Math.round((item.current / Math.max(1, item.max)) * 100)}%` }} />
                </span>
              )}
              <span className="tk-count">
                {item.current}/{item.max}
              </span>
              <span className="tk-btns">
                <button className="tk-btn" onClick={() => bump(item.id, -1)}><Minus size={11} /></button>
                <button className="tk-btn" onClick={() => bump(item.id, +1)}><Plus size={11} /></button>
              </span>
            </div>
          ))}
          {editing && (
            <TrackerEditor
              initial={data}
              onCancel={() => setEditing(false)}
              onSave={(next) => {
                persist(next);
                setEditing(false);
              }}
            />
          )}
        </div>
      );
    },
  },
);

function TrackerEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: TrackerData;
  onSave: (data: TrackerData) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [items, setItems] = useState<TrackerItem[]>(initial.items);

  const patchItem = (id: string, partial: Partial<TrackerItem>) =>
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...partial } : item)));

  return (
    <EditDialog title="Edit Tracker" onClose={onCancel} onSave={() => onSave({ title, items })}>
      <Grid cols={1}>
        <Field label="Title">
          <input className="lf-input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
      </Grid>
      {items.map((item) => (
        <div key={item.id} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
          <input
            className="lf-input"
            style={{ flex: 2 }}
            value={item.name}
            placeholder="Name"
            onChange={(e) => patchItem(item.id, { name: e.target.value })}
          />
          <select
            className="lf-input"
            style={{ flex: 1 }}
            value={item.kind}
            onChange={(e) => patchItem(item.id, { kind: e.target.value as TrackerKind })}
          >
            {KINDS.map((kind) => (
              <option key={kind.id} value={kind.id}>{kind.label}</option>
            ))}
          </select>
          <input
            className="lf-input"
            type="number"
            style={{ width: 74 }}
            value={item.current}
            title="Current"
            onChange={(e) => patchItem(item.id, { current: parseInt(e.target.value || "0", 10) })}
          />
          <span style={{ color: "var(--text-3)" }}>/</span>
          <input
            className="lf-input"
            type="number"
            style={{ width: 74 }}
            value={item.max}
            title="Max"
            onChange={(e) => patchItem(item.id, { max: parseInt(e.target.value || "1", 10) })}
          />
          <button className="lf-icon-btn" onClick={() => setItems((list) => list.filter((x) => x.id !== item.id))}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button
        className="lf-btn outline"
        onClick={() =>
          setItems((list) => [
            ...list,
            { id: localId(), name: "New counter", kind: "custom", current: 0, max: 10 },
          ])
        }
      >
        <Plus size={13} /> Add counter
      </button>
    </EditDialog>
  );
}
