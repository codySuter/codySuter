import { PanelLeft, ChevronLeft, ChevronRight, Star, MoreHorizontal, Link2, Copy, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useQ, useM } from "../../lib/data";
import { useUI, useToasts } from "../../lib/store";
import type { WorkspaceDoc } from "../../lib/types";
import { Popover } from "../ui/Popover";
import { timeAgo } from "../../lib/utils";

export function TopBar({ workspace }: { workspace: WorkspaceDoc }) {
  const ui = useUI();
  const pageId = ui.pageId as Id<"pages"> | null;
  const crumbs = useQ(api.pages.breadcrumbs, pageId ? { pageId } : "skip");
  const page = useQ(api.pages.get, pageId ? { pageId } : "skip");
  const toggleFavorite = useM(api.pages.toggleFavorite);
  const moveToTrash = useM(api.pages.moveToTrash);
  const duplicate = useM(api.pages.duplicate);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const push = useToasts((s) => s.push);

  return (
    <div className="lf-topbar app-drag">
      {!ui.sidebarOpen && <div style={{ width: 68 }} />}
      <div className="app-no-drag" style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <button className="lf-icon-btn" title="Toggle sidebar (⌘\)" onClick={ui.toggleSidebar}>
          <PanelLeft size={15} />
        </button>
        <button className="lf-icon-btn" title="Back (⌘[)" onClick={ui.goBack} disabled={ui.back.length === 0} style={{ opacity: ui.back.length ? 1 : 0.35 }}>
          <ChevronLeft size={15} />
        </button>
        <button className="lf-icon-btn" title="Forward (⌘])" onClick={ui.goForward} disabled={ui.forward.length === 0} style={{ opacity: ui.forward.length ? 1 : 0.35 }}>
          <ChevronRight size={15} />
        </button>
      </div>

      <div className="app-no-drag" style={{ display: "flex", alignItems: "center", minWidth: 0, flex: 1 }}>
        {pageId && crumbs ? (
          crumbs.map((crumb, i) => (
            <span key={crumb._id} style={{ display: "inline-flex", alignItems: "center", minWidth: 0 }}>
              {i > 0 && <span className="crumb-sep">/</span>}
              <button className="crumb" onClick={() => ui.navigate(crumb._id)}>
                {crumb.icon ? `${crumb.icon} ` : ""}
                {crumb.title || "Untitled"}
              </button>
            </span>
          ))
        ) : (
          <button className="crumb" onClick={() => ui.navigate(null)}>
            {workspace.icon} {workspace.name}
          </button>
        )}
      </div>

      {pageId && page && (
        <div className="app-no-drag" style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <span style={{ fontSize: 12, color: "var(--text-3)", marginRight: 6 }}>
            Edited {timeAgo(page.updatedAt)}
          </span>
          <button className="lf-icon-btn" title="Favorite" onClick={() => void toggleFavorite({ pageId })}>
            <Star size={15} fill={page.isFavorite ? "var(--accent2)" : "none"} style={{ color: page.isFavorite ? "var(--accent2)" : undefined }} />
          </button>
          <button className="lf-icon-btn" onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}>
            <MoreHorizontal size={15} />
          </button>
          {menu && (
            <Popover anchor={menu} onClose={() => setMenu(null)} align="right" width={230}>
              <button
                className="lf-menu-item"
                onClick={() => {
                  void navigator.clipboard.writeText(`loreforge://page/${pageId}`);
                  push({ title: "Link copied", body: "Paste it anywhere in Loreforge" });
                  setMenu(null);
                }}
              >
                <Link2 size={14} /> Copy page link
              </button>
              <button
                className="lf-menu-item"
                onClick={() => {
                  void duplicate({ pageId }).then((id) => id && ui.navigate(id as string));
                  setMenu(null);
                }}
              >
                <Copy size={14} /> Duplicate
              </button>
              <div className="lf-menu-sep" />
              <button
                className="lf-menu-item danger"
                onClick={() => {
                  void moveToTrash({ pageId });
                  ui.navigate(null);
                  setMenu(null);
                }}
              >
                <Trash2 size={14} /> Move to trash
              </button>
            </Popover>
          )}
        </div>
      )}
    </div>
  );
}
