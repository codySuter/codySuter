import { useEffect, useState } from "react";
import { Popover } from "../ui/Popover";
import { useEditorEnv } from "./EditorEnv";

export interface PickedTarget {
  targetType: "page" | "entry";
  targetId: string;
  label: string;
  icon: string;
  kind: string;
  databaseId?: string;
}

/** Search-driven page/entry picker (map pins, timeline links, relation cells). */
export function PagePicker({
  anchor,
  onClose,
  onPick,
  allowClear,
}: {
  anchor: DOMRect | { x: number; y: number };
  onClose: () => void;
  onPick: (target: PickedTarget | null) => void;
  allowClear?: boolean;
}) {
  const env = useEditorEnv();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedTarget[]>([]);

  useEffect(() => {
    let alive = true;
    void env.searchTargets(query).then((items) => {
      if (alive) setResults(items.map((r) => ({ ...r })));
    });
    return () => {
      alive = false;
    };
  }, [query, env]);

  return (
    <Popover anchor={anchor} onClose={onClose} width={300}>
      <input
        autoFocus
        className="lf-input"
        placeholder="Link to page or entry…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ marginBottom: 5 }}
      />
      {allowClear && (
        <button
          className="lf-menu-item"
          onClick={() => {
            onPick(null);
            onClose();
          }}
        >
          <span style={{ color: "var(--text-3)" }}>No link</span>
        </button>
      )}
      {results.map((r) => (
        <button
          key={`${r.targetType}-${r.targetId}`}
          className="lf-menu-item"
          onClick={() => {
            onPick(r);
            onClose();
          }}
        >
          <span style={{ width: 18, textAlign: "center" }}>{r.icon || (r.targetType === "entry" ? "•" : "📄")}</span>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
          <span style={{ fontSize: 10.5, color: "var(--text-3)" }}>{r.kind}</span>
        </button>
      ))}
      {results.length === 0 && (
        <div style={{ padding: "10px 9px", fontSize: 12.5, color: "var(--text-3)" }}>
          {query ? "No matches." : "Type to search this world…"}
        </div>
      )}
    </Popover>
  );
}
