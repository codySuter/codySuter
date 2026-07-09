import { Trash2, RotateCcw, X } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { useQ, useM } from "../../lib/data";
import { useUI } from "../../lib/store";
import type { WorkspaceDoc } from "../../lib/types";

export function TrashModal({ workspace }: { workspace: WorkspaceDoc }) {
  const ui = useUI();
  const trash = useQ(api.pages.trashList, { workspaceId: workspace._id });
  const restore = useM(api.pages.restore);
  const deleteForever = useM(api.pages.deleteForever);

  return (
    <>
      <div className="lf-overlay" onClick={() => ui.setTrashOpen(false)} />
      <div
        className="lf-modal"
        style={{
          top: "18vh",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(520px, 90vw)",
          maxHeight: "60vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <Trash2 size={16} style={{ color: "var(--text-3)" }} />
          <b style={{ flex: 1 }}>Trash</b>
          <button className="lf-icon-btn" onClick={() => ui.setTrashOpen(false)}>
            <X size={15} />
          </button>
        </div>
        <div style={{ overflowY: "auto", padding: 8 }}>
          {(trash ?? []).length === 0 && (
            <div style={{ padding: 30, textAlign: "center", color: "var(--text-3)", fontSize: 13.5 }}>
              Nothing in the trash. Your world is tidy.
            </div>
          )}
          {(trash ?? []).map((item) => (
            <div key={item._id} className="lf-menu-item" style={{ cursor: "default" }}>
              <span style={{ width: 20, textAlign: "center" }}>{item.icon ?? (item.type === "db" ? "🗃️" : "📄")}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.title || "Untitled"}
              </span>
              <button
                className="lf-btn"
                style={{ fontSize: 12 }}
                onClick={() => void restore({ pageId: item._id })}
              >
                <RotateCcw size={12} /> Restore
              </button>
              <button
                className="lf-btn"
                style={{ fontSize: 12, color: "#e5484d" }}
                onClick={() => {
                  if (confirm(`Permanently delete “${item.title || "Untitled"}” and everything inside it? This can't be undone.`)) {
                    void deleteForever({ pageId: item._id });
                  }
                }}
              >
                Delete forever
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
