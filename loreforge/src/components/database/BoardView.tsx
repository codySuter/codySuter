import { useState } from "react";
import { Plus } from "lucide-react";
import type { DbApi } from "./DatabaseView";
import { CellDisplay } from "./cells";
import type { EntryDoc } from "../../lib/types";

export function BoardView({ db }: { db: DbApi }) {
  const groupProp = db.props.find((p) => p.id === db.view.groupBy && p.type === "select")
    ?? db.props.find((p) => p.type === "select");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  if (!groupProp) {
    return (
      <div style={{ padding: 30, color: "var(--text-3)", fontSize: 13.5 }}>
        Board views group rows by a <b>Select</b> property — add one to this database first.
      </div>
    );
  }

  const columns: { id: string | null; label: string; color: string }[] = [
    ...(groupProp.options ?? []).map((option) => ({ id: option.id as string | null, label: option.label, color: option.color })),
    { id: null, label: `No ${groupProp.name}`, color: "gray" },
  ];
  const cardProps = db.props.filter((p) => p.id !== groupProp.id).slice(0, 3);

  const rowsFor = (columnId: string | null): EntryDoc[] =>
    db.rows.filter((row) => {
      const value = row.cells?.[groupProp.id];
      return columnId === null ? !value : value === columnId;
    });

  return (
    <div style={{ display: "flex", gap: 12, overflowX: "auto", padding: "14px 0", alignItems: "flex-start", minHeight: 300 }}>
      {columns.map((column) => {
        const rows = rowsFor(column.id);
        if (column.id === null && rows.length === 0) return null;
        return (
          <div
            key={column.id ?? "__none"}
            className="board-col"
            style={overCol === (column.id ?? "__none") && dragId ? { borderColor: "var(--accent)" } : undefined}
            onDragOver={(e) => {
              e.preventDefault();
              setOverCol(column.id ?? "__none");
            }}
            onDragLeave={() => setOverCol(null)}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId) db.setCell(dragId, groupProp.id, column.id);
              setDragId(null);
              setOverCol(null);
            }}
          >
            <div className="col-head">
              <span className={`lf-chip chip-${column.color}`}>{column.label}</span>
              <span className="col-count">{rows.length}</span>
              <span style={{ flex: 1 }} />
              {column.id !== null && (
                <button
                  className="lf-icon-btn"
                  style={{ width: 20, height: 20 }}
                  title="Add here"
                  onClick={() => db.createEntry({ [groupProp.id]: column.id })}
                >
                  <Plus size={12} />
                </button>
              )}
            </div>
            <div style={{ overflowY: "auto" }}>
              {rows.map((row) => (
                <div
                  key={row._id}
                  className="board-card"
                  draggable
                  onDragStart={() => setDragId(row._id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverCol(null);
                  }}
                  onClick={() => db.openEntry(row._id)}
                >
                  <div style={{ fontWeight: 600 }}>
                    {row.icon ? `${row.icon} ` : ""}
                    {row.title || "Untitled"}
                  </div>
                  {cardProps.map((prop) => {
                    const value = row.cells?.[prop.id];
                    if (value === undefined || value === null || value === "") return null;
                    return <CellDisplay key={prop.id} prop={prop} value={value} />;
                  })}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
