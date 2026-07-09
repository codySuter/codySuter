import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Database, CornerDownLeft, Clock } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { useQ } from "../../lib/data";
import { useUI } from "../../lib/store";
import type { WorkspaceDoc } from "../../lib/types";

interface Item {
  key: string;
  icon: string | null;
  title: string;
  kind: "page" | "db" | "entry";
  onOpen: () => void;
}

export function QuickSwitcher({ workspace }: { workspace: WorkspaceDoc }) {
  const ui = useUI();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useQ(api.search.all, query.trim() ? { workspaceId: workspace._id, q: query } : "skip");
  const recent = useQ(api.pages.recent, { workspaceId: workspace._id });

  const close = () => ui.setQuickSwitcher(false);

  const items: Item[] = useMemo(() => {
    if (!query.trim()) {
      return (recent ?? []).map((p) => ({
        key: p._id,
        icon: p.icon,
        title: p.title,
        kind: p.type === "db" ? "db" as const : "page" as const,
        onOpen: () => {
          ui.navigate(p._id);
          close();
        },
      }));
    }
    const pages: Item[] = (results?.pages ?? []).map((p) => ({
      key: p._id,
      icon: p.icon,
      title: p.title,
      kind: p.type === "db" ? "db" as const : "page" as const,
      onOpen: () => {
        ui.navigate(p._id);
        close();
      },
    }));
    const entries: Item[] = (results?.entries ?? []).map((e) => ({
      key: e._id,
      icon: e.icon,
      title: e.title,
      kind: "entry" as const,
      onOpen: () => {
        ui.openPeek({ entryId: e._id, databaseId: e.databaseId });
        close();
      },
    }));
    return [...pages, ...entries];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, results, recent]);

  useEffect(() => setActive(0), [query, items.length]);
  useEffect(() => inputRef.current?.focus(), []);

  return (
    <>
      <div className="lf-overlay" onClick={close} />
      <div className="lf-modal qs-modal">
        <input
          ref={inputRef}
          className="qs-input"
          placeholder={`Search ${workspace.name}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            }
            if (e.key === "Enter" && items[active]) items[active].onOpen();
          }}
        />
        <div style={{ maxHeight: "46vh", overflowY: "auto", padding: "6px 0" }}>
          {!query.trim() && (recent ?? []).length > 0 && (
            <div className="lf-menu-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Clock size={11} /> Recent
            </div>
          )}
          {items.map((item, i) => (
            <div
              key={item.key}
              className="qs-item"
              data-active={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={item.onOpen}
            >
              <span style={{ width: 20, textAlign: "center", fontSize: 15 }}>
                {item.icon ?? (item.kind === "db" ? "🗃️" : item.kind === "entry" ? "•" : "📄")}
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.title || "Untitled"}
              </span>
              <span className="qs-kind">
                {item.kind === "db" ? "Database" : item.kind === "entry" ? "Entry" : "Page"}
              </span>
              {i === active && <CornerDownLeft size={13} style={{ color: "var(--text-3)", flexShrink: 0 }} />}
            </div>
          ))}
          {query.trim() && items.length === 0 && results !== undefined && (
            <div style={{ padding: "22px 16px", textAlign: "center", color: "var(--text-3)", fontSize: 13.5 }}>
              Nothing found for “{query}”.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
