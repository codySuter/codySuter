import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface PeekTarget {
  entryId: string;
  databaseId: string;
}

interface NavEntry {
  pageId: string | null;
  peek: PeekTarget | null;
}

interface UIState {
  workspaceId: string | null;
  pageId: string | null;
  peek: PeekTarget | null;
  back: NavEntry[];
  forward: NavEntry[];
  sidebarOpen: boolean;
  sidebarWidth: number;
  diceTrayOpen: boolean;
  quickSwitcherOpen: boolean;
  trashOpen: boolean;
  theme: "dark" | "light";
  expanded: Record<string, boolean>;

  setWorkspace: (id: string | null) => void;
  navigate: (pageId: string | null) => void;
  openPeek: (peek: PeekTarget) => void;
  closePeek: () => void;
  goBack: () => void;
  goForward: () => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setDiceTray: (open: boolean) => void;
  setQuickSwitcher: (open: boolean) => void;
  setTrashOpen: (open: boolean) => void;
  setTheme: (theme: "dark" | "light") => void;
  setExpanded: (pageId: string, open: boolean) => void;
}

export const useUI = create<UIState>()(
  persist(
    (set, get) => ({
      workspaceId: null,
      pageId: null,
      peek: null,
      back: [],
      forward: [],
      sidebarOpen: true,
      sidebarWidth: 264,
      diceTrayOpen: false,
      quickSwitcherOpen: false,
      trashOpen: false,
      theme: "dark",
      expanded: {},

      setWorkspace: (id) =>
        set({ workspaceId: id, pageId: null, peek: null, back: [], forward: [] }),
      navigate: (pageId) => {
        const { pageId: current, peek } = get();
        if (pageId === current && !peek) return;
        set((s) => ({
          back: [...s.back.slice(-49), { pageId: current, peek }],
          forward: [],
          pageId,
          peek: null,
          trashOpen: false,
        }));
      },
      openPeek: (peek) => {
        const { pageId: current, peek: currentPeek } = get();
        set((s) => ({
          back: [...s.back.slice(-49), { pageId: current, peek: currentPeek }],
          forward: [],
          peek,
        }));
      },
      closePeek: () => set({ peek: null }),
      goBack: () => {
        const { back, forward, pageId, peek } = get();
        const previous = back[back.length - 1];
        if (!previous) return;
        set({
          back: back.slice(0, -1),
          forward: [...forward, { pageId, peek }],
          pageId: previous.pageId,
          peek: previous.peek,
        });
      },
      goForward: () => {
        const { back, forward, pageId, peek } = get();
        const next = forward[forward.length - 1];
        if (!next) return;
        set({
          forward: forward.slice(0, -1),
          back: [...back, { pageId, peek }],
          pageId: next.pageId,
          peek: next.peek,
        });
      },
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarWidth: (width) => set({ sidebarWidth: Math.min(420, Math.max(200, width)) }),
      setDiceTray: (open) => set({ diceTrayOpen: open }),
      setQuickSwitcher: (open) => set({ quickSwitcherOpen: open }),
      setTrashOpen: (open) => set({ trashOpen: open }),
      setTheme: (theme) => set({ theme }),
      setExpanded: (pageId, open) =>
        set((s) => ({ expanded: { ...s.expanded, [pageId]: open } })),
    }),
    {
      name: "loreforge-ui",
      partialize: (s) => ({
        workspaceId: s.workspaceId,
        pageId: s.pageId,
        theme: s.theme,
        sidebarOpen: s.sidebarOpen,
        sidebarWidth: s.sidebarWidth,
        expanded: s.expanded,
      }),
    },
  ),
);

/** Ephemeral toast bus for roll results and notices. */
export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone?: "default" | "hope" | "fear" | "crit" | "fumble";
}
interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
}
let toastId = 1;
export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...toast, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 5200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
