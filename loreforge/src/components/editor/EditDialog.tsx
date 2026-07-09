import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** Shared modal chrome for custom-block editors. */
export function EditDialog({
  title,
  onClose,
  onSave,
  children,
  width = 620,
}: {
  title: string;
  onClose: () => void;
  onSave: () => void;
  children: ReactNode;
  width?: number;
}) {
  return createPortal(
    <>
      {/* zIndex above the entry peek drawer so blocks stay editable inside it */}
      <div className="lf-overlay" style={{ zIndex: 250 }} onMouseDown={onClose} />
      <div
        className="lf-modal"
        style={{
          top: "9vh",
          left: "50%",
          transform: "translateX(-50%)",
          width: `min(${width}px, 94vw)`,
          maxHeight: "82vh",
          display: "flex",
          flexDirection: "column",
          zIndex: 260,
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSave();
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "13px 18px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <b style={{ flex: 1, fontFamily: "var(--font-display)", letterSpacing: "0.04em", fontSize: 14 }}>
            {title}
          </b>
          <button className="lf-icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div style={{ overflowY: "auto", padding: "16px 18px", flex: 1 }}>{children}</div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "12px 18px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <button className="lf-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="lf-btn primary" onClick={onSave}>
            Save (⌘↵)
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

export function Field({
  label,
  children,
  span,
  hint,
}: {
  label: string;
  children: ReactNode;
  span?: number;
  hint?: string;
}) {
  return (
    <label style={{ display: "block", gridColumn: span ? `span ${span}` : undefined }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
        {label}
        {hint && <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, marginLeft: 6 }}>{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export function Grid({ cols = 4, children }: { cols?: number; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: "12px 10px", marginBottom: 14 }}>
      {children}
    </div>
  );
}

export function useDraft<T>(initial: T) {
  const [draft, setDraft] = useState<T>(initial);
  const patch = (partial: Partial<T>) => setDraft((d) => ({ ...d, ...partial }));
  return [draft, patch, setDraft] as const;
}

export function TextArea({
  value,
  onChange,
  rows = 5,
  mono,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  mono?: boolean;
  placeholder?: string;
}) {
  return (
    <textarea
      className="lf-input"
      style={{ fontFamily: mono ? "var(--font-mono)" : undefined, fontSize: mono ? 12.5 : 13.5, resize: "vertical", lineHeight: 1.5 }}
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
