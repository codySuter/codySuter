import { useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { Link2, PencilLine, Plus, Trash2 } from "lucide-react";
import { parseData, defaultTimeline, ERA_COLORS, type TimelineData, type TimelineEra, type TimelineEvent } from "../blockData";
import { EditDialog, Field, Grid } from "../EditDialog";
import { useEditorEnv } from "../EditorEnv";
import { PagePicker } from "../PagePicker";
import { localId } from "../../../lib/utils";

export const TimelineBlock = createReactBlockSpec(
  {
    type: "timeline" as const,
    propSchema: { data: { default: "" } },
    content: "none" as const,
  },
  {
    render: ({ block, editor }) => {
      const env = useEditorEnv();
      const data = parseData<TimelineData>(block.props.data, defaultTimeline);
      const [editing, setEditing] = useState(block.props.data === "");
      return (
        <div className="lf-timeline" contentEditable={false}>
          <div className="lf-block-edit">
            <button className="lf-icon-btn" title="Edit timeline" onClick={() => setEditing(true)}>
              <PencilLine size={13} />
            </button>
          </div>
          <div className="tl-title">{data.title}</div>
          {data.eras.map((era) => (
            <div className={`tl-era era-${era.color}`} key={era.id}>
              <div className="tl-era-name">{era.name}</div>
              {era.events.map((event) => (
                <div className="tl-event" key={event.id}>
                  <div className="tl-date">{event.date}</div>
                  <div className="tl-event-title">
                    {event.title}
                    {event.targetId && (
                      <button
                        className="lf-mention"
                        style={{ marginLeft: 8, fontSize: 12 }}
                        onClick={() =>
                          event.targetType === "entry"
                            ? env.openEntry(event.targetId!, "")
                            : env.navigate(event.targetId!)
                        }
                      >
                        <Link2 size={10} style={{ alignSelf: "center" }} />
                        {event.targetLabel ?? "Open"}
                      </button>
                    )}
                  </div>
                  {event.text && <div className="tl-text">{event.text}</div>}
                </div>
              ))}
            </div>
          ))}
          {editing && (
            <TimelineEditor
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

function TimelineEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: TimelineData;
  onSave: (data: TimelineData) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [eras, setEras] = useState<TimelineEra[]>(initial.eras);
  const [linkPicker, setLinkPicker] = useState<{ eraId: string; eventId: string; anchor: DOMRect } | null>(null);

  const patchEra = (id: string, partial: Partial<TimelineEra>) =>
    setEras((list) => list.map((era) => (era.id === id ? { ...era, ...partial } : era)));
  const patchEvent = (eraId: string, eventId: string, partial: Partial<TimelineEvent>) =>
    setEras((list) =>
      list.map((era) =>
        era.id === eraId
          ? { ...era, events: era.events.map((ev) => (ev.id === eventId ? { ...ev, ...partial } : ev)) }
          : era,
      ),
    );

  return (
    <EditDialog title="Edit Timeline" onClose={onCancel} onSave={() => onSave({ title, eras })} width={720}>
      <Grid cols={1}>
        <Field label="Timeline title">
          <input className="lf-input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
      </Grid>
      {eras.map((era) => (
        <div
          key={era.id}
          style={{ border: "1px solid var(--border-strong)", borderRadius: 10, padding: 12, marginBottom: 12 }}
        >
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input
              className="lf-input"
              style={{ flex: 1, fontWeight: 600 }}
              value={era.name}
              placeholder="Era name"
              onChange={(e) => patchEra(era.id, { name: e.target.value })}
            />
            <select
              className="lf-input"
              style={{ width: 110 }}
              value={era.color}
              onChange={(e) => patchEra(era.id, { color: e.target.value })}
            >
              {ERA_COLORS.map((color) => (
                <option key={color} value={color}>{color}</option>
              ))}
            </select>
            <button className="lf-icon-btn" title="Delete era" onClick={() => setEras((list) => list.filter((x) => x.id !== era.id))}>
              <Trash2 size={13} />
            </button>
          </div>
          {era.events.map((event) => (
            <div key={event.id} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "flex-start" }}>
              <input
                className="lf-input"
                style={{ width: 110, fontFamily: "var(--font-mono)", fontSize: 12 }}
                value={event.date}
                placeholder="Date"
                onChange={(e) => patchEvent(era.id, event.id, { date: e.target.value })}
              />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                <input
                  className="lf-input"
                  value={event.title}
                  placeholder="Event title"
                  onChange={(e) => patchEvent(era.id, event.id, { title: e.target.value })}
                />
                <input
                  className="lf-input"
                  style={{ fontSize: 13 }}
                  value={event.text}
                  placeholder="Description (optional)"
                  onChange={(e) => patchEvent(era.id, event.id, { text: e.target.value })}
                />
              </div>
              <button
                className="lf-icon-btn"
                title={event.targetId ? `Linked: ${event.targetLabel}` : "Link to page/entry"}
                style={{ color: event.targetId ? "var(--accent-text)" : undefined }}
                onClick={(e) => setLinkPicker({ eraId: era.id, eventId: event.id, anchor: e.currentTarget.getBoundingClientRect() })}
              >
                <Link2 size={13} />
              </button>
              <button
                className="lf-icon-btn"
                title="Delete event"
                onClick={() => patchEra(era.id, { events: era.events.filter((x) => x.id !== event.id) })}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button
            className="lf-btn"
            style={{ fontSize: 12.5 }}
            onClick={() =>
              patchEra(era.id, {
                events: [...era.events, { id: localId(), date: "", title: "New event", text: "" }],
              })
            }
          >
            <Plus size={12} /> Add event
          </button>
        </div>
      ))}
      <button
        className="lf-btn outline"
        onClick={() =>
          setEras((list) => [
            ...list,
            { id: localId(), name: "New Era", color: ERA_COLORS[list.length % ERA_COLORS.length], events: [] },
          ])
        }
      >
        <Plus size={13} /> Add era
      </button>
      {linkPicker && (
        <PagePicker
          anchor={linkPicker.anchor}
          allowClear
          onClose={() => setLinkPicker(null)}
          onPick={(target) =>
            patchEvent(linkPicker.eraId, linkPicker.eventId, {
              targetType: target?.targetType,
              targetId: target?.targetId,
              targetLabel: target?.label,
            })
          }
        />
      )}
    </EditDialog>
  );
}
