import { useMemo, useRef } from "react";
import { api } from "../../../convex/_generated/api";
import { useLoreClient } from "../../lib/data";
import { useRoller } from "../../lib/roller";
import { useUI } from "../../lib/store";
import type { WorkspaceDoc } from "../../lib/types";
import type { EditorEnv } from "./EditorEnv";

/** Builds the EditorEnv custom blocks rely on (roll, navigate, upload, search). */
export function useWorkspaceEnv(workspace: WorkspaceDoc): EditorEnv {
  const client = useLoreClient();
  const roller = useRoller();
  const rollerRef = useRef(roller);
  rollerRef.current = roller;

  return useMemo(
    () => ({
      mode: workspace.mode,
      workspaceId: workspace._id,
      roller: {
        rollExpr: (...args) => rollerRef.current.rollExpr(...args),
        rollCheck: (...args) => rollerRef.current.rollCheck(...args),
        rollDualityDice: (...args) => rollerRef.current.rollDualityDice(...args),
      },
      navigate: (id) => useUI.getState().navigate(id),
      openEntry: (entryId, databaseId) => useUI.getState().openPeek({ entryId, databaseId }),
      uploadFile: (file) => client.uploadFile(file),
      searchTargets: async (q) => {
        if (!q.trim()) {
          const recent = await client.queryOnce(api.pages.recent, { workspaceId: workspace._id });
          return recent.map((p) => ({
            targetType: "page" as const,
            targetId: p._id as string,
            label: p.title || "Untitled",
            icon: p.icon ?? "",
            kind: p.type === "db" ? "Database" : "Page",
          }));
        }
        const results = await client.queryOnce(api.search.all, { workspaceId: workspace._id, q });
        return [
          ...results.pages.map((p) => ({
            targetType: "page" as const,
            targetId: p._id as string,
            label: p.title,
            icon: p.icon ?? "",
            kind: p.type === "db" ? "Database" : "Page",
          })),
          ...results.entries.map((e) => ({
            targetType: "entry" as const,
            targetId: e._id as string,
            label: e.title,
            icon: e.icon ?? "",
            kind: "Entry",
            databaseId: e.databaseId as string,
          })),
        ];
      },
    }),
    [workspace._id, workspace.mode, client],
  );
}
