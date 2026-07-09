import { Plus } from "lucide-react";
import type { DbApi } from "./DatabaseView";
import { CellDisplay } from "./cells";

export function GalleryView({ db }: { db: DbApi }) {
  const visibleProps = db.props.filter((p) => !(db.view.hidden ?? []).includes(p.id)).slice(0, 4);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
        gap: 12,
        padding: "14px 0",
      }}
    >
      {db.rows.map((row) => (
        <div key={row._id} className="db-card" onClick={() => db.openEntry(row._id)}>
          <div className="card-banner">{row.icon ?? "•"}</div>
          <div className="card-body">
            <div className="card-title">{row.title || "Untitled"}</div>
            {visibleProps.map((prop) => {
              const value = row.cells?.[prop.id];
              if (value === undefined || value === null || value === "") return null;
              return (
                <div key={prop.id} style={{ display: "flex", gap: 6, alignItems: "baseline", minWidth: 0 }}>
                  <span style={{ fontSize: 11, color: "var(--text-3)", flexShrink: 0 }}>{prop.name}</span>
                  <CellDisplay prop={prop} value={value} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <button
        className="db-card"
        style={{ alignItems: "center", justifyContent: "center", minHeight: 120, color: "var(--text-3)", fontSize: 13.5 }}
        onClick={() => db.createEntry()}
      >
        <Plus size={16} style={{ marginBottom: 4 }} />
        New entry
      </button>
    </div>
  );
}
