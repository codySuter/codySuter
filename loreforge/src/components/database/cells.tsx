import { useState } from "react";
import { Check, Dices, ExternalLink, Plus, X } from "lucide-react";
import { Popover } from "../ui/Popover";
import { PagePicker } from "../editor/PagePicker";
import { useEditorEnv } from "../editor/EditorEnv";
import type { CellValue, PropDef, RelationValue, SelectOption } from "../../lib/types";
import { SELECT_COLORS } from "../../lib/types";
import { formatDate, localId } from "../../lib/utils";

export interface CellProps {
  prop: PropDef;
  value: CellValue;
  onChange: (value: CellValue) => void;
  /** Called when a select/multiSelect needs a new option added to the schema. */
  onAddOption?: (propId: string, option: SelectOption) => void;
  compact?: boolean;
}

/** Uncontrolled input that commits on blur/Enter — one mutation per edit, not per keystroke. */
export function CommitInput({
  initial,
  onCommit,
  type = "text",
  placeholder,
  mono,
  className = "db-cell-input",
  autoFocus,
}: {
  initial: string;
  onCommit: (value: string) => void;
  type?: string;
  placeholder?: string;
  mono?: boolean;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      key={initial}
      className={className}
      type={type}
      defaultValue={initial}
      placeholder={placeholder}
      autoFocus={autoFocus}
      style={mono ? { fontFamily: "var(--font-mono)", fontSize: 13 } : undefined}
      onBlur={(e) => {
        if (e.target.value !== initial) onCommit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          (e.target as HTMLInputElement).value = initial;
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function CellEditor({ prop, value, onChange, onAddOption, compact }: CellProps) {
  switch (prop.type) {
    case "text":
      return (
        <CommitInput
          initial={(value as string) ?? ""}
          placeholder={compact ? "" : "Empty"}
          onCommit={(v) => onChange(v)}
        />
      );
    case "number":
      return (
        <CommitInput
          initial={value === undefined || value === null ? "" : String(value)}
          type="number"
          placeholder={compact ? "" : "0"}
          onCommit={(v) => onChange(v === "" ? null : Number(v))}
        />
      );
    case "checkbox":
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          style={{ accentColor: "var(--accent)", width: 15, height: 15 }}
        />
      );
    case "date":
      return (
        <input
          className="db-cell-input"
          type="date"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          style={{ colorScheme: "inherit" }}
        />
      );
    case "url":
      return <UrlCell value={(value as string) ?? ""} onChange={onChange} />;
    case "dice":
      return <DiceCell value={(value as string) ?? ""} onChange={onChange} propName={prop.name} />;
    case "select":
      return (
        <SelectCell
          prop={prop}
          selected={typeof value === "string" ? [value] : []}
          multi={false}
          onChange={(ids) => onChange(ids[0] ?? null)}
          onAddOption={onAddOption}
        />
      );
    case "multiSelect":
      return (
        <SelectCell
          prop={prop}
          selected={Array.isArray(value) ? (value as string[]) : []}
          multi
          onChange={(ids) => onChange(ids)}
          onAddOption={onAddOption}
        />
      );
    case "relation":
      return <RelationCell value={(value as RelationValue[]) ?? []} onChange={onChange} />;
    default:
      return null;
  }
}

/** Read-only compact renderer for gallery/board cards. */
export function CellDisplay({ prop, value }: { prop: PropDef; value: CellValue }) {
  if (value === undefined || value === null || value === "") return null;
  switch (prop.type) {
    case "select": {
      const option = prop.options?.find((o) => o.id === value);
      return option ? <span className={`lf-chip chip-${option.color}`}>{option.label}</span> : null;
    }
    case "multiSelect":
      return (
        <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
          {(value as string[]).map((id) => {
            const option = prop.options?.find((o) => o.id === id);
            return option ? (
              <span key={id} className={`lf-chip chip-${option.color}`}>{option.label}</span>
            ) : null;
          })}
        </span>
      );
    case "checkbox":
      return value ? <Check size={14} style={{ color: "var(--accent-text)" }} /> : null;
    case "date":
      return <span style={{ fontSize: 12.5, color: "var(--text-2)" }}>{formatDate(value as string)}</span>;
    case "relation":
      return (
        <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
          {(value as RelationValue[]).map((rel) => (
            <span key={rel.id} className="lf-chip" style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}>
              {rel.icon} {rel.title}
            </span>
          ))}
        </span>
      );
    case "dice":
      return <span className="lf-chip chip-amber" style={{ fontFamily: "var(--font-mono)" }}>{String(value)}</span>;
    default:
      return <span style={{ fontSize: 13, color: "var(--text-2)" }}>{String(value)}</span>;
  }
}

function UrlCell({ value, onChange }: { value: string; onChange: (v: CellValue) => void }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <CommitInput initial={value} placeholder="https://" onCommit={(v) => onChange(v)} />
      {value && (
        <a href={value.startsWith("http") ? value : `https://${value}`} target="_blank" rel="noreferrer" className="lf-icon-btn" style={{ width: 20, height: 20 }}>
          <ExternalLink size={12} />
        </a>
      )}
    </span>
  );
}

function DiceCell({ value, onChange, propName }: { value: string; onChange: (v: CellValue) => void; propName: string }) {
  const env = useEditorEnv();
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <CommitInput initial={value} placeholder="2d6+3" mono onCommit={(v) => onChange(v)} />
      {value && (
        <button
          className="lf-icon-btn"
          style={{ width: 20, height: 20, color: "var(--accent2)" }}
          title={`Roll ${value}`}
          onClick={() => env.roller.rollExpr(value, propName)}
        >
          <Dices size={13} />
        </button>
      )}
    </span>
  );
}

function SelectCell({
  prop,
  selected,
  multi,
  onChange,
  onAddOption,
}: {
  prop: PropDef;
  selected: string[];
  multi: boolean;
  onChange: (ids: string[]) => void;
  onAddOption?: (propId: string, option: SelectOption) => void;
}) {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [filter, setFilter] = useState("");
  const options = prop.options ?? [];
  const chosen = selected
    .map((id) => options.find((o) => o.id === id))
    .filter(Boolean) as SelectOption[];

  const visible = options.filter((o) => o.label.toLowerCase().includes(filter.toLowerCase()));
  const canCreate = filter.trim() && !options.some((o) => o.label.toLowerCase() === filter.trim().toLowerCase());

  return (
    <>
      <span
        style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", cursor: "pointer", minHeight: 20, minWidth: 40, alignItems: "center" }}
        onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}
      >
        {chosen.length === 0 && <span style={{ color: "var(--text-3)", fontSize: 13 }}>—</span>}
        {chosen.map((option) => (
          <span key={option.id} className={`lf-chip chip-${option.color}`}>{option.label}</span>
        ))}
      </span>
      {menu && (
        <Popover anchor={menu} onClose={() => { setMenu(null); setFilter(""); }} width={230}>
          <input
            autoFocus
            className="lf-input"
            placeholder={multi ? "Toggle options…" : "Pick an option…"}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ marginBottom: 5, fontSize: 13 }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canCreate && onAddOption) {
                createOption();
              }
            }}
          />
          {!multi && selected.length > 0 && (
            <button className="lf-menu-item" onClick={() => { onChange([]); setMenu(null); }}>
              <X size={13} /> Clear
            </button>
          )}
          {visible.map((option) => {
            const isOn = selected.includes(option.id);
            return (
              <button
                key={option.id}
                className="lf-menu-item"
                onClick={() => {
                  if (multi) {
                    onChange(isOn ? selected.filter((id) => id !== option.id) : [...selected, option.id]);
                  } else {
                    onChange([option.id]);
                    setMenu(null);
                  }
                }}
              >
                <span className={`lf-chip chip-${option.color}`}>{option.label}</span>
                {isOn && <Check size={13} style={{ marginLeft: "auto", color: "var(--accent-text)" }} />}
              </button>
            );
          })}
          {canCreate && onAddOption && (
            <button className="lf-menu-item" onClick={createOption}>
              <Plus size={13} /> Create “{filter.trim()}”
            </button>
          )}
        </Popover>
      )}
    </>
  );

  function createOption() {
    const option: SelectOption = {
      id: localId(),
      label: filter.trim(),
      color: SELECT_COLORS[(prop.options?.length ?? 0) % SELECT_COLORS.length],
    };
    onAddOption?.(prop.id, option);
    onChange(multi ? [...selected, option.id] : [option.id]);
    setFilter("");
    if (!multi) setMenu(null);
  }
}

function RelationCell({ value, onChange }: { value: RelationValue[]; onChange: (v: CellValue) => void }) {
  const env = useEditorEnv();
  const [picker, setPicker] = useState<DOMRect | null>(null);
  return (
    <>
      <span
        style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", cursor: "pointer", minHeight: 20, minWidth: 40, alignItems: "center" }}
        onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}
      >
        {value.length === 0 && <span style={{ color: "var(--text-3)", fontSize: 13 }}>—</span>}
        {value.map((rel) => (
          <span
            key={rel.id}
            className="lf-chip"
            style={{ background: "var(--accent-soft)", color: "var(--accent-text)", cursor: "pointer" }}
            title="Open"
            onClick={(e) => {
              e.stopPropagation();
              if (rel.type === "page") env.navigate(rel.id);
              else env.openEntry(rel.id, "");
            }}
          >
            {rel.icon} {rel.title}
            <span
              style={{ marginLeft: 2, opacity: 0.7 }}
              title="Remove"
              onClick={(e) => {
                e.stopPropagation();
                onChange(value.filter((x) => x.id !== rel.id));
              }}
            >
              <X size={10} style={{ verticalAlign: -1 }} />
            </span>
          </span>
        ))}
      </span>
      {picker && (
        <PagePicker
          anchor={picker}
          onClose={() => setPicker(null)}
          onPick={(target) => {
            if (!target) return;
            if (value.some((x) => x.id === target.targetId)) return;
            onChange([
              ...value,
              { type: target.targetType, id: target.targetId, title: target.label, icon: target.icon },
            ]);
          }}
        />
      )}
    </>
  );
}
