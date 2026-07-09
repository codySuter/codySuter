import { useMemo, useRef, useState } from "react";
import {
  ChevronRight, Plus, Search, Home, Trash2, MoreHorizontal, Star, StarOff,
  FileText, Database, Copy, PencilLine, ChevronsUpDown, Check, Sun, Moon, Dices,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useQ, useM, useLoreClient } from "../../lib/data";
import { useUI } from "../../lib/store";
import type { PageLite, WorkspaceDoc } from "../../lib/types";
import { Popover } from "../ui/Popover";
import { orderBetween, modKey } from "../../lib/utils";

interface TreeNode {
  page: PageLite;
  children: TreeNode[];
}

function buildTree(pages: PageLite[]): TreeNode[] {
  const byParent = new Map<string | null, PageLite[]>();
  const ids = new Set(pages.map((p) => p._id as string));
  for (const page of pages) {
    // Orphans (parent trashed separately) surface at root.
    const key = page.parentId && ids.has(page.parentId) ? page.parentId : null;
    const list = byParent.get(key) ?? [];
    list.push(page);
    byParent.set(key, list);
  }
  const build = (parentId: string | null): TreeNode[] =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((page) => ({ page, children: build(page._id) }));
  return build(null);
}

type DropZone = "above" | "below" | "inside";

export function Sidebar({
  workspace,
  workspaces,
}: {
  workspace: WorkspaceDoc;
  workspaces: WorkspaceDoc[];
}) {
  const ui = useUI();
  const client = useLoreClient();
  const pages = useQ(api.pages.tree, { workspaceId: workspace._id });
  const createPage = useM(api.pages.create);
  const movePage = useM(api.pages.move);

  const [wsMenu, setWsMenu] = useState<DOMRect | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; zone: DropZone } | null>(null);
  const resizing = useRef(false);

  const tree = useMemo(() => buildTree((pages ?? []) as PageLite[]), [pages]);
  const favorites = useMemo(
    () => ((pages ?? []) as PageLite[]).filter((p) => p.isFavorite),
    [pages],
  );
  const byId = useMemo(() => {
    const map = new Map<string, PageLite>();
    for (const p of (pages ?? []) as PageLite[]) map.set(p._id, p);
    return map;
  }, [pages]);

  const isDescendant = (candidateId: string, ancestorId: string): boolean => {
    let current = byId.get(candidateId);
    let guard = 0;
    while (current?.parentId && guard++ < 64) {
      if (current.parentId === ancestorId) return true;
      current = byId.get(current.parentId);
    }
    return false;
  };

  const handleDrop = (targetId: string, zone: DropZone) => {
    if (!dragId || dragId === targetId || !pages) return;
    if (isDescendant(targetId, dragId)) return;
    const all = (pages as PageLite[]);
    const target = byId.get(targetId);
    if (!target) return;
    if (zone === "inside") {
      const siblings = all
        .filter((p) => p.parentId === targetId)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const last = siblings[siblings.length - 1];
      void movePage({
        pageId: dragId as Id<"pages">,
        parentId: targetId as Id<"pages">,
        sortOrder: (last?.sortOrder ?? 0) + 1000,
      });
      ui.setExpanded(targetId, true);
    } else {
      const siblings = all
        .filter((p) => p.parentId === target.parentId && p._id !== dragId)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const index = siblings.findIndex((p) => p._id === targetId);
      const before = zone === "above" ? siblings[index - 1] : siblings[index];
      const after = zone === "above" ? siblings[index] : siblings[index + 1];
      void movePage({
        pageId: dragId as Id<"pages">,
        parentId: (target.parentId ?? undefined) as Id<"pages"> | undefined,
        sortOrder: orderBetween(before?.sortOrder, after?.sortOrder),
      });
    }
  };

  const addPage = (parentId?: string, type: "doc" | "db" = "doc") => {
    void createPage({
      workspaceId: workspace._id,
      parentId: parentId as Id<"pages"> | undefined,
      type,
      ...(type === "db"
        ? {
            props: [
              {
                id: "status", name: "Status", type: "select",
                options: [
                  { id: "todo", label: "To Do", color: "gray" },
                  { id: "doing", label: "In Progress", color: "amber" },
                  { id: "done", label: "Done", color: "green" },
                ],
              },
              { id: "notes", name: "Notes", type: "text" },
            ],
            views: [{ id: "v1", name: "Table", kind: "table" }],
          }
        : {}),
    }).then((id) => {
      if (parentId) ui.setExpanded(parentId, true);
      ui.navigate(id as string);
    });
  };

  return (
    <aside className="lf-sidebar" style={{ width: "100%" }}>
      <div
        className="resize-handle"
        onMouseDown={(e) => {
          e.preventDefault();
          resizing.current = true;
          const onMove = (ev: MouseEvent) => {
            if (resizing.current) ui.setSidebarWidth(ev.clientX);
          };
          const onUp = () => {
            resizing.current = false;
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        }}
      />
      <div className="lf-titlebar-pad app-drag" />

      <div className="ws-switch app-no-drag" onClick={(e) => setWsMenu(e.currentTarget.getBoundingClientRect())}>
        <div className="ws-badge">{workspace.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ws-name">{workspace.name}</div>
          <div className="ws-mode">
            {workspace.mode === "dnd5e" ? "D&D 5E · 2024" : "Daggerheart"}
          </div>
        </div>
        <ChevronsUpDown size={14} style={{ color: "var(--text-3)" }} />
      </div>
      {wsMenu && (
        <Popover anchor={wsMenu} onClose={() => setWsMenu(null)} width={264}>
          <div className="lf-menu-label">Worlds</div>
          {workspaces.map((ws) => (
            <button
              key={ws._id}
              className="lf-menu-item"
              onClick={() => {
                ui.setWorkspace(ws._id);
                setWsMenu(null);
              }}
            >
              <span style={{ fontSize: 15 }}>{ws.icon}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{ws.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                  {ws.mode === "dnd5e" ? "D&D 5E (2024)" : "Daggerheart"}
                  {ws.tagline ? ` — ${ws.tagline}` : ""}
                </div>
              </span>
              {ws._id === workspace._id && <Check size={14} style={{ color: "var(--accent-text)" }} />}
            </button>
          ))}
          <div className="lf-menu-sep" />
          <button
            className="lf-menu-item"
            onClick={() => {
              ui.setTheme(ui.theme === "dark" ? "light" : "dark");
            }}
          >
            {ui.theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            {ui.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          </button>
          {client.kind === "demo" && (
            <div style={{ padding: "7px 9px", fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.45 }}>
              <b style={{ color: "var(--accent2)" }}>Demo mode</b> — data lives in memory and resets on
              reload. Connect a Convex deployment to keep your worlds.
            </div>
          )}
        </Popover>
      )}

      <div style={{ padding: "6px 6px 0" }} className="app-no-drag">
        <div className="tree-row" onClick={() => ui.setQuickSwitcher(true)}>
          <span className="twirl"><Search size={13} /></span>
          <span className="title">Search</span>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>{modKey}K</span>
        </div>
        <div className="tree-row" data-current={ui.pageId === null && !ui.trashOpen} onClick={() => ui.navigate(null)}>
          <span className="twirl"><Home size={13} /></span>
          <span className="title">Home</span>
        </div>
        <div className="tree-row" onClick={() => ui.setDiceTray(!ui.diceTrayOpen)}>
          <span className="twirl"><Dices size={13} /></span>
          <span className="title">Dice Tray</span>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>{modKey}J</span>
        </div>
        <div className="tree-row" onClick={() => ui.setTrashOpen(true)}>
          <span className="twirl"><Trash2 size={13} /></span>
          <span className="title">Trash</span>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 20 }} className="app-no-drag">
        {favorites.length > 0 && (
          <>
            <div className="sidebar-section"><span>Favorites</span></div>
            {favorites.map((page) => (
              <div
                key={`fav-${page._id}`}
                className="tree-row"
                data-current={ui.pageId === page._id}
                onClick={() => ui.navigate(page._id)}
              >
                <span className="page-emoji" style={{ marginLeft: 4 }}>
                  {page.icon ?? (page.type === "db" ? "🗃️" : "📄")}
                </span>
                <span className="title">{page.title || "Untitled"}</span>
              </div>
            ))}
          </>
        )}

        <div className="sidebar-section">
          <span>Pages</span>
          <button className="lf-icon-btn" title="New page" onClick={() => addPage()}>
            <Plus size={13} />
          </button>
        </div>
        {pages === undefined ? (
          <div style={{ padding: "4px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="lf-skeleton" style={{ height: 20, width: `${88 - i * 9}%` }} />
            ))}
          </div>
        ) : (
          <TreeLevel
            nodes={tree}
            depth={0}
            dragId={dragId}
            setDragId={setDragId}
            dropTarget={dropTarget}
            setDropTarget={setDropTarget}
            onDrop={handleDrop}
            onAddChild={(id, type) => addPage(id, type)}
          />
        )}
        <div className="tree-row" style={{ color: "var(--text-3)" }} onClick={() => addPage()}>
          <span className="twirl"><Plus size={13} /></span>
          <span className="title">New page</span>
        </div>
      </div>
    </aside>
  );
}

function TreeLevel(props: {
  nodes: TreeNode[];
  depth: number;
  dragId: string | null;
  setDragId: (id: string | null) => void;
  dropTarget: { id: string; zone: DropZone } | null;
  setDropTarget: (t: { id: string; zone: DropZone } | null) => void;
  onDrop: (targetId: string, zone: DropZone) => void;
  onAddChild: (parentId: string, type: "doc" | "db") => void;
}) {
  return (
    <>
      {props.nodes.map((node) => (
        <TreeRow key={node.page._id} node={node} {...props} />
      ))}
    </>
  );
}

function TreeRow({
  node,
  depth,
  dragId,
  setDragId,
  dropTarget,
  setDropTarget,
  onDrop,
  onAddChild,
}: {
  node: TreeNode;
  depth: number;
  dragId: string | null;
  setDragId: (id: string | null) => void;
  dropTarget: { id: string; zone: DropZone } | null;
  setDropTarget: (t: { id: string; zone: DropZone } | null) => void;
  onDrop: (targetId: string, zone: DropZone) => void;
  onAddChild: (parentId: string, type: "doc" | "db") => void;
}) {
  const ui = useUI();
  const page = node.page;
  const open = ui.expanded[page._id] ?? false;
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(page.title);
  const rename = useM(api.pages.rename);
  const toggleFavorite = useM(api.pages.toggleFavorite);
  const moveToTrash = useM(api.pages.moveToTrash);
  const duplicate = useM(api.pages.duplicate);

  const zoneFor = (e: React.DragEvent<HTMLDivElement>): DropZone => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    if (y < rect.height * 0.28) return "above";
    if (y > rect.height * 0.72) return "below";
    return "inside";
  };

  return (
    <>
      <div
        className="tree-row"
        style={{ paddingLeft: 4 + depth * 14 }}
        data-current={ui.pageId === page._id}
        data-drop={dropTarget?.id === page._id ? dropTarget.zone : undefined}
        draggable={!renaming}
        onClick={() => ui.navigate(page._id)}
        onDragStart={(e) => {
          setDragId(page._id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => {
          setDragId(null);
          setDropTarget(null);
        }}
        onDragOver={(e) => {
          if (!dragId || dragId === page._id) return;
          e.preventDefault();
          setDropTarget({ id: page._id, zone: zoneFor(e) });
        }}
        onDragLeave={() => {
          if (dropTarget?.id === page._id) setDropTarget(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          onDrop(page._id, zoneFor(e));
          setDragId(null);
          setDropTarget(null);
        }}
      >
        <span
          className="twirl"
          data-open={open}
          onClick={(e) => {
            e.stopPropagation();
            ui.setExpanded(page._id, !open);
          }}
        >
          <ChevronRight size={13} />
        </span>
        <span className="page-emoji">{page.icon ?? (page.type === "db" ? "🗃️" : "📄")}</span>
        {renaming ? (
          <input
            autoFocus
            className="db-cell-input"
            style={{ fontSize: 13.5 }}
            value={draft}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              setRenaming(false);
              if (draft !== page.title) void rename({ pageId: page._id, title: draft });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setDraft(page.title);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <span className="title">{page.title || "Untitled"}</span>
        )}
        <span className="row-actions">
          <button
            className="lf-icon-btn"
            title="More"
            onClick={(e) => {
              e.stopPropagation();
              setMenu(e.currentTarget.getBoundingClientRect());
            }}
          >
            <MoreHorizontal size={13} />
          </button>
          <button
            className="lf-icon-btn"
            title="Add page inside"
            onClick={(e) => {
              e.stopPropagation();
              onAddChild(page._id, "doc");
            }}
          >
            <Plus size={13} />
          </button>
        </span>
      </div>
      {menu && (
        <Popover anchor={menu} onClose={() => setMenu(null)} width={230}>
          <button className="lf-menu-item" onClick={() => { setMenu(null); setRenaming(true); setDraft(page.title); }}>
            <PencilLine size={14} /> Rename
          </button>
          <button className="lf-menu-item" onClick={() => { void toggleFavorite({ pageId: page._id }); setMenu(null); }}>
            {page.isFavorite ? <StarOff size={14} /> : <Star size={14} />}
            {page.isFavorite ? "Remove from favorites" : "Add to favorites"}
          </button>
          <button
            className="lf-menu-item"
            onClick={() => {
              void duplicate({ pageId: page._id }).then((id) => id && ui.navigate(id as string));
              setMenu(null);
            }}
          >
            <Copy size={14} /> Duplicate
          </button>
          <div className="lf-menu-sep" />
          <button className="lf-menu-item" onClick={() => { onAddChild(page._id, "doc"); setMenu(null); }}>
            <FileText size={14} /> New page inside
          </button>
          <button className="lf-menu-item" onClick={() => { onAddChild(page._id, "db"); setMenu(null); }}>
            <Database size={14} /> New database inside
          </button>
          <div className="lf-menu-sep" />
          <button
            className="lf-menu-item danger"
            onClick={() => {
              void moveToTrash({ pageId: page._id });
              if (ui.pageId === page._id) ui.navigate(null);
              setMenu(null);
            }}
          >
            <Trash2 size={14} /> Move to trash
          </button>
        </Popover>
      )}
      {open && node.children.length > 0 && (
        <TreeLevel
          nodes={node.children}
          depth={depth + 1}
          dragId={dragId}
          setDragId={setDragId}
          dropTarget={dropTarget}
          setDropTarget={setDropTarget}
          onDrop={onDrop}
          onAddChild={onAddChild}
        />
      )}
      {open && node.children.length === 0 && (
        <div
          className="tree-row"
          style={{ paddingLeft: 4 + (depth + 1) * 14, color: "var(--text-3)", fontSize: 12.5, cursor: "default" }}
        >
          <span style={{ paddingLeft: 22 }}>No pages inside</span>
        </div>
      )}
    </>
  );
}
