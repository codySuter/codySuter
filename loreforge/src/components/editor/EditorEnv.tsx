import { createContext, useContext } from "react";
import type { Roller } from "../../lib/roller";
import type { Mode } from "../../lib/types";

/** Everything custom blocks need from the app, injected above the editor. */
export interface EditorEnv {
  mode: Mode;
  workspaceId: string;
  roller: Roller;
  navigate: (pageId: string) => void;
  openEntry: (entryId: string, databaseId: string) => void;
  uploadFile: (file: File) => Promise<string>;
  searchTargets: (
    q: string,
  ) => Promise<{ targetType: "page" | "entry"; targetId: string; label: string; icon: string; kind: string; databaseId?: string }[]>;
}

const Ctx = createContext<EditorEnv | null>(null);

export const EditorEnvProvider = Ctx.Provider;

export function useEditorEnv(): EditorEnv {
  const env = useContext(Ctx);
  if (!env) throw new Error("useEditorEnv outside provider");
  return env;
}
