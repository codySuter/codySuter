import { useRef, useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { ImagePlus, ImageOff, MapPin as MapPinIcon, PencilLine, Trash2, ExternalLink } from "lucide-react";
import { parseData, defaultMap, PIN_COLORS, type MapData, type MapPin } from "../blockData";
import { useEditorEnv } from "../EditorEnv";
import { Popover } from "../../ui/Popover";
import { PagePicker } from "../PagePicker";
import { localId } from "../../../lib/utils";

export const MapBlock = createReactBlockSpec(
  {
    type: "map" as const,
    propSchema: {
      data: { default: "" },
      url: { default: "" },
    },
    content: "none" as const,
  },
  {
    render: ({ block, editor }) => {
      const env = useEditorEnv();
      const data = parseData<MapData>(block.props.data, defaultMap);
      const [placing, setPlacing] = useState(false);
      const [pinEditor, setPinEditor] = useState<{ pinId: string; anchor: { x: number; y: number } } | null>(null);
      const [linkPicker, setLinkPicker] = useState<{ pinId: string; anchor: { x: number; y: number } } | null>(null);
      const [editingTitle, setEditingTitle] = useState(false);
      const [titleDraft, setTitleDraft] = useState(data.title);
      const canvasRef = useRef<HTMLDivElement>(null);
      const fileRef = useRef<HTMLInputElement>(null);
      const dragState = useRef<{ pinId: string; moved: boolean } | null>(null);

      const persist = (next: Partial<MapData>, url?: string) =>
        editor.updateBlock(block, {
          props: {
            data: JSON.stringify({ ...data, ...next }),
            ...(url !== undefined ? { url } : {}),
          },
        });

      const patchPin = (pinId: string, partial: Partial<MapPin>) =>
        persist({ pins: data.pins.map((pin) => (pin.id === pinId ? { ...pin, ...partial } : pin)) });

      const canvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!placing || !canvasRef.current) return;
        const rect = canvasRef.current.getBoundingClientRect();
        const x = Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 10;
        const y = Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 10;
        const pin: MapPin = { id: localId(), x, y, label: "New pin", color: "gold" };
        persist({ pins: [...data.pins, pin] });
        setPlacing(false);
        setPinEditor({ pinId: pin.id, anchor: { x: e.clientX, y: e.clientY } });
      };

      const startDrag = (pinId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        dragState.current = { pinId, moved: false };
        const onMove = (ev: MouseEvent) => {
          if (!canvasRef.current || !dragState.current) return;
          dragState.current.moved = true;
          const rect = canvasRef.current.getBoundingClientRect();
          const x = Math.min(99, Math.max(1, ((ev.clientX - rect.left) / rect.width) * 100));
          const y = Math.min(99, Math.max(1, ((ev.clientY - rect.top) / rect.height) * 100));
          patchPin(pinId, { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
        };
        const onUp = (ev: MouseEvent) => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          const wasDrag = dragState.current?.moved;
          dragState.current = null;
          if (!wasDrag) {
            const pin = data.pins.find((p) => p.id === pinId);
            if (pin?.targetId) {
              if (pin.targetType === "entry") env.openEntry(pin.targetId, "");
              else env.navigate(pin.targetId!);
            } else {
              setPinEditor({ pinId, anchor: { x: ev.clientX, y: ev.clientY } });
            }
          }
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      };

      const activePin = pinEditor ? data.pins.find((p) => p.id === pinEditor.pinId) : null;

      return (
        <div className="lf-map" contentEditable={false}>
          <div className="map-head">
            {editingTitle ? (
              <input
                autoFocus
                className="lf-input"
                style={{ fontSize: 13, padding: "2px 8px", maxWidth: 260 }}
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => {
                  persist({ title: titleDraft });
                  setEditingTitle(false);
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
            ) : (
              <span className="map-title" onDoubleClick={() => { setTitleDraft(data.title); setEditingTitle(true); }}>
                {data.title}
              </span>
            )}
            <button className="lf-icon-btn" title="Rename map" onClick={() => { setTitleDraft(data.title); setEditingTitle(true); }}>
              <PencilLine size={13} />
            </button>
            <button
              className="lf-btn"
              style={{ fontSize: 12, color: placing ? "var(--accent-text)" : undefined, background: placing ? "var(--accent-soft)" : undefined }}
              onClick={() => setPlacing(!placing)}
            >
              <MapPinIcon size={13} /> {placing ? "Click map to place…" : "Add pin"}
            </button>
            <button className="lf-btn" style={{ fontSize: 12 }} onClick={() => fileRef.current?.click()}>
              <ImagePlus size={13} /> {block.props.url ? "Replace image" : "Upload image"}
            </button>
            {block.props.url && (
              <button className="lf-icon-btn" title="Remove image (back to parchment)" onClick={() => persist({}, "")}>
                <ImageOff size={13} />
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const url = await env.uploadFile(file);
                persist({}, url);
                e.target.value = "";
              }}
            />
          </div>
          <div
            ref={canvasRef}
            className={`map-canvas${block.props.url ? "" : " sketch"}${placing ? " placing" : ""}`}
            style={block.props.url ? { backgroundImage: `url("${block.props.url}")` } : undefined}
            onClick={canvasClick}
          >
            {data.pins.map((pin) => (
              <div
                key={pin.id}
                className={`map-pin pin-${pin.color}`}
                style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                onMouseDown={(e) => startDrag(pin.id, e)}
                title={pin.targetId ? `${pin.label} — click to open, drag to move` : `${pin.label} — click to edit, drag to move`}
              >
                <span className="pin-dot" />
                <span className="pin-label">{pin.label}</span>
              </div>
            ))}
          </div>
          <div className="map-foot">
            <MapPinIcon size={11} />
            {data.pins.length} pin{data.pins.length === 1 ? "" : "s"}
            <span style={{ marginLeft: "auto" }}>
              {block.props.url ? "" : "Parchment sketch — upload an image any time"}
            </span>
          </div>

          {pinEditor && activePin && (
            <Popover anchor={pinEditor.anchor} onClose={() => setPinEditor(null)} width={250}>
              <input
                autoFocus
                className="lf-input"
                value={activePin.label}
                onChange={(e) => patchPin(activePin.id, { label: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && setPinEditor(null)}
                style={{ marginBottom: 8 }}
              />
              <div style={{ display: "flex", gap: 5, padding: "0 2px 8px" }}>
                {PIN_COLORS.map((color) => (
                  <button
                    key={color}
                    className={`tk-pip pin-${color}`}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 6,
                      background: `var(--pin-color)`,
                      border: activePin.color === color ? "2px solid var(--text)" : "2px solid transparent",
                    }}
                    onClick={() => patchPin(activePin.id, { color })}
                  />
                ))}
              </div>
              <button
                className="lf-menu-item"
                onClick={() => {
                  setLinkPicker({ pinId: activePin.id, anchor: pinEditor.anchor });
                  setPinEditor(null);
                }}
              >
                <ExternalLink size={13} />
                {activePin.targetId ? "Change link…" : "Link to page/entry…"}
              </button>
              {activePin.targetId && (
                <button
                  className="lf-menu-item"
                  onClick={() => {
                    if (activePin.targetType === "entry") env.openEntry(activePin.targetId!, "");
                    else env.navigate(activePin.targetId!);
                  }}
                >
                  <ExternalLink size={13} /> Open link
                </button>
              )}
              <div className="lf-menu-sep" />
              <button
                className="lf-menu-item danger"
                onClick={() => {
                  persist({ pins: data.pins.filter((p) => p.id !== activePin.id) });
                  setPinEditor(null);
                }}
              >
                <Trash2 size={13} /> Delete pin
              </button>
            </Popover>
          )}
          {linkPicker && (
            <PagePicker
              anchor={linkPicker.anchor}
              allowClear
              onClose={() => setLinkPicker(null)}
              onPick={(target) => {
                const pin = data.pins.find((p) => p.id === linkPicker.pinId);
                const partial: Partial<MapPin> = {
                  targetType: target?.targetType,
                  targetId: target?.targetId,
                };
                if (target && pin?.label === "New pin") partial.label = target.label;
                patchPin(linkPicker.pinId, partial);
              }}
            />
          )}
        </div>
      );
    },
  },
);
