import { useCallback, useState } from "react";
import { Maximize2, Trash2, X } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useQ, useM } from "../../lib/data";
import { useUI, type PeekTarget } from "../../lib/store";
import type { PropDef, WorkspaceDoc } from "../../lib/types";
import { EmojiPicker } from "../ui/EmojiPicker";
import { LoreEditor } from "../editor/Editor";
import { EditorEnvProvider } from "../editor/EditorEnv";
import { useWorkspaceEnv } from "../editor/useWorkspaceEnv";
import { BacklinksPanel } from "../editor/BacklinksPanel";
import { CellEditor, CommitInput } from "./cells";
import { localId } from "../../lib/utils";
import type { SelectOption } from "../../lib/types";

/** Row-as-page: the Notion-style side peek for a database entry. */
export function EntryPeek({ workspace, peek }: { workspace: WorkspaceDoc; peek: PeekTarget }) {
  const ui = useUI();
  const env = useWorkspaceEnv(workspace);
  const entry = useQ(api.entries.get, { entryId: peek.entryId as Id<"entries"> });
  const database = useQ(
    api.pages.get,
    entry ? { pageId: entry.databaseId } : "skip",
  );
  const updateEntry = useM(api.entries.update);
  const updateContent = useM(api.entries.updateContent);
  const removeEntry = useM(api.entries.remove);
  const updateDbSchema = useM(api.pages.updateDbSchema);
  const setCell = useM(api.entries.setCell);
  const [iconPicker, setIconPicker] = useState<DOMRect | null>(null);

  const onSaveContent = useCallback(
    (doc: unknown) => void updateContent({ entryId: peek.entryId as Id<"entries">, content: doc }),
    [peek.entryId, updateContent],
  );

  const close = () => ui.closePeek();

  if (entry === null) {
    return (
      <>
        <div className="lf-overlay" onClick={close} />
        <div className="lf-peek" style={{ alignItems: "center", justifyContent: "center", color: "var(--text-3)" }}>
          This entry no longer exists.
          <button className="lf-btn outline" style={{ marginTop: 10 }} onClick={close}>Close</button>
        </div>
      </>
    );
  }

  const props: PropDef[] = Array.isArray(database?.props) ? (database!.props as PropDef[]) : [];

  const addOption = (propId: string, option: SelectOption) => {
    if (!database) return;
    void updateDbSchema({
      pageId: database._id,
      props: props.map((p) => (p.id === propId ? { ...p, options: [...(p.options ?? []), option] } : p)),
    });
  };

  return (
    <EditorEnvProvider value={env}>
      <div className="lf-overlay" style={{ background: "rgba(0,0,0,.25)" }} onClick={close} />
      <div className="lf-peek">
        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
          {database && (
            <button
              className="lf-btn"
              style={{ fontSize: 12.5 }}
              title="Open the database"
              onClick={() => {
                close();
                ui.navigate(database._id);
              }}
            >
              <Maximize2 size={12} />
              {database.icon} {database.title}
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button
            className="lf-icon-btn"
            title="Delete entry"
            onClick={() => {
              if (entry && confirm(`Delete “${entry.title || "Untitled"}”?`)) {
                void removeEntry({ entryId: entry._id });
                close();
              }
            }}
          >
            <Trash2 size={14} />
          </button>
          <button className="lf-icon-btn" onClick={close}>
            <X size={15} />
          </button>
        </div>

        {entry === undefined ? (
          <div style={{ padding: 24 }}>
            <div className="lf-skeleton" style={{ height: 30, width: "60%", marginBottom: 16 }} />
            <div className="lf-skeleton" style={{ height: 14, width: "90%", marginBottom: 8 }} />
            <div className="lf-skeleton" style={{ height: 14, width: "75%" }} />
          </div>
        ) : (
          <div style={{ overflowY: "auto", flex: 1, padding: "18px 26px 60px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                style={{ fontSize: 34, borderRadius: 8, padding: 2 }}
                title="Change icon"
                onClick={(e) => setIconPicker(e.currentTarget.getBoundingClientRect())}
              >
                {entry.icon ?? <span style={{ opacity: 0.3 }}>•</span>}
              </button>
              <span style={{ flex: 1, display: "flex" }}>
                <CommitInput
                  initial={entry.title}
                  placeholder="Untitled"
                  className="page-title-input peek-title"
                  onCommit={(title) => void updateEntry({ entryId: entry._id, title })}
                />
              </span>
            </div>

            <div style={{ margin: "14px 0 4px", borderTop: "1px solid var(--border)" }}>
              {props.map((prop) => (
                <div
                  key={prop.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "7px 0",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <span style={{ width: 120, flexShrink: 0, fontSize: 12.5, color: "var(--text-3)" }}>
                    {prop.name}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <CellEditor
                      prop={prop}
                      value={entry.cells?.[prop.id]}
                      onChange={(value) =>
                        void setCell({ entryId: entry._id, propId: prop.id, value })
                      }
                      onAddOption={addOption}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 16 }}>
              <LoreEditor key={entry._id} initialContent={entry.content} onSave={onSaveContent} />
            </div>

            <BacklinksPanel targetType="entry" targetId={entry._id} />
          </div>
        )}

        {iconPicker && entry && (
          <EmojiPicker
            anchor={iconPicker}
            onClose={() => setIconPicker(null)}
            onPick={(emoji) => void updateEntry({ entryId: entry._id, icon: emoji })}
            onClear={() => void updateEntry({ entryId: entry._id, icon: undefined })}
          />
        )}
      </div>
    </EditorEnvProvider>
  );
}
