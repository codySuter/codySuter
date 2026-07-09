import { useEffect, useMemo } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { useQ, useM, useLoreClient } from "./lib/data";
import { useUI, useToasts } from "./lib/store";
import type { WorkspaceDoc } from "./lib/types";
import { Sidebar } from "./components/layout/Sidebar";
import { TopBar } from "./components/layout/TopBar";
import { PageView } from "./components/pages/PageView";
import { HomeView } from "./components/pages/HomeView";
import { QuickSwitcher } from "./components/search/QuickSwitcher";
import { DiceTray } from "./components/dice/DiceTray";
import { EntryPeek } from "./components/database/EntryPeek";
import { TrashModal } from "./components/layout/TrashModal";
import { Toasts } from "./components/layout/Toasts";
import { useRoller } from "./lib/roller";

export default function App() {
  const client = useLoreClient();
  const workspaces = useQ(api.workspaces.list, {});
  const seedStatus = useQ(api.seed.status, {});
  const seedInit = useM(api.seed.init);

  const ui = useUI();
  const roller = useRoller();
  const pushToast = useToasts((s) => s.push);

  // First run against an empty deployment: create the starter worlds.
  useEffect(() => {
    if (seedStatus && !seedStatus.seeded && seedStatus.workspaceCount === 0) {
      void seedInit({}).then((result) => {
        if (result?.seeded) {
          pushToast({ title: "Welcome to Loreforge", body: "Two starter worlds were created for you." });
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedStatus?.seeded, seedStatus?.workspaceCount]);

  // Resolve the active workspace (persisted id if it still exists, else first).
  const workspace: WorkspaceDoc | null = useMemo(() => {
    if (!workspaces || workspaces.length === 0) return null;
    return (workspaces.find((w) => w._id === ui.workspaceId) ?? workspaces[0]) as WorkspaceDoc;
  }, [workspaces, ui.workspaceId]);

  useEffect(() => {
    if (workspace && workspace._id !== ui.workspaceId) {
      useUI.setState({ workspaceId: workspace._id });
    }
  }, [workspace, ui.workspaceId]);

  // Theme + mode attributes drive the whole design system.
  useEffect(() => {
    document.documentElement.dataset.theme = ui.theme;
  }, [ui.theme]);
  useEffect(() => {
    document.documentElement.dataset.mode = workspace?.mode ?? "dnd5e";
  }, [workspace?.mode]);

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        useUI.setState((s) => ({ quickSwitcherOpen: !s.quickSwitcherOpen }));
      } else if (key === "j") {
        e.preventDefault();
        useUI.setState((s) => ({ diceTrayOpen: !s.diceTrayOpen }));
      } else if (key === "\\") {
        e.preventDefault();
        ui.toggleSidebar();
      } else if (key === "[" && !e.shiftKey) {
        e.preventDefault();
        ui.goBack();
      } else if (key === "]" && !e.shiftKey) {
        e.preventDefault();
        ui.goForward();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Electron application menu events.
  const createPage = useM(api.pages.create);
  useEffect(() => {
    if (!window.loreforge) return;
    return window.loreforge.onMenu(({ action, payload }) => {
      const state = useUI.getState();
      if (action === "quick-switcher") state.setQuickSwitcher(true);
      if (action === "toggle-sidebar") state.toggleSidebar();
      if (action === "toggle-dice") state.setDiceTray(!state.diceTrayOpen);
      if (action === "theme" && (payload === "dark" || payload === "light")) state.setTheme(payload);
      if (action === "roll" && payload === "1d20") roller.rollExpr("1d20", "d20");
      if (action === "roll" && payload === "adv") roller.rollCheck(0, "advantage", "d20");
      if (action === "roll" && payload === "duality") roller.rollDualityDice(0, "normal", "Duality");
      if ((action === "new-page" || action === "new-database") && state.workspaceId) {
        void createPage({
          workspaceId: state.workspaceId as Id<"workspaces">,
          type: action === "new-database" ? "db" : "doc",
          ...(action === "new-database"
            ? {
                props: [
                  {
                    id: "status",
                    name: "Status",
                    type: "select",
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
        }).then((id) => state.navigate(id as string));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (workspaces === undefined) {
    return (
      <div className="empty-state">
        <div className="big-icon">🎲</div>
        <div style={{ fontFamily: "var(--font-display)", letterSpacing: "0.08em" }}>LOREFORGE</div>
        <div style={{ fontSize: 13 }}>
          {client.kind === "demo" ? "Conjuring the demo worlds…" : "Reaching your deployment…"}
        </div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="empty-state">
        <div className="big-icon">✨</div>
        <div>Creating your starter worlds…</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100%" }}>
      {ui.sidebarOpen && (
        <div style={{ width: ui.sidebarWidth, flexShrink: 0 }}>
          <Sidebar workspace={workspace} workspaces={(workspaces ?? []) as WorkspaceDoc[]} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", height: "100%" }}>
        <TopBar workspace={workspace} />
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          {ui.pageId ? (
            <PageView key={ui.pageId} pageId={ui.pageId as Id<"pages">} workspace={workspace} />
          ) : (
            <HomeView workspace={workspace} />
          )}
        </div>
      </div>

      {ui.quickSwitcherOpen && <QuickSwitcher workspace={workspace} />}
      {ui.trashOpen && <TrashModal workspace={workspace} />}
      {ui.peek && <EntryPeek workspace={workspace} peek={ui.peek} />}
      <DiceTray workspace={workspace} />
      <Toasts />
    </div>
  );
}
