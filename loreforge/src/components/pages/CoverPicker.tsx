import { useRef } from "react";
import { ImagePlus, X } from "lucide-react";
import { Popover } from "../ui/Popover";
import { COVER_PRESETS } from "../../lib/covers";

export function CoverPicker({
  anchor,
  onClose,
  onPick,
  onUpload,
  onRemove,
}: {
  anchor: DOMRect;
  onClose: () => void;
  onPick: (coverKey: string) => void;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <Popover anchor={anchor} onClose={onClose} width={332} align="right">
      <div className="lf-menu-label">Covers</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 7, padding: "2px 4px 8px" }}>
        {COVER_PRESETS.map((preset) => (
          <button
            key={preset.id}
            title={preset.name}
            style={{
              height: 56,
              borderRadius: 8,
              background: preset.css,
              border: "1px solid var(--border-strong)",
              position: "relative",
              overflow: "hidden",
            }}
            onClick={() => {
              onPick(`grad:${preset.id}`);
              onClose();
            }}
          >
            <span
              style={{
                position: "absolute",
                left: 7,
                bottom: 5,
                fontSize: 10.5,
                fontWeight: 700,
                color: "rgba(255,255,255,.92)",
                textShadow: "0 1px 3px rgba(0,0,0,.7)",
              }}
            >
              {preset.name}
            </span>
          </button>
        ))}
      </div>
      <div className="lf-menu-sep" />
      <button className="lf-menu-item" onClick={() => fileRef.current?.click()}>
        <ImagePlus size={14} /> Upload image…
      </button>
      <button className="lf-menu-item danger" onClick={() => { onRemove(); onClose(); }}>
        <X size={14} /> Remove cover
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          onClose();
        }}
      />
    </Popover>
  );
}
