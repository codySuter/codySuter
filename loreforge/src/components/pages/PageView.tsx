import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import { ImagePlus, SmilePlus } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useQ, useM, useLoreClient } from "../../lib/data";
import { useUI } from "../../lib/store";
import type { WorkspaceDoc } from "../../lib/types";
import { coverCss } from "../../lib/covers";
import { debounce } from "../../lib/utils";
import { EmojiPicker } from "../ui/EmojiPicker";
import { CoverPicker } from "./CoverPicker";
import { LoreEditor } from "../editor/Editor";
import { EditorEnvProvider } from "../editor/EditorEnv";
import { useWorkspaceEnv } from "../editor/useWorkspaceEnv";
import { BacklinksPanel } from "../editor/BacklinksPanel";
import { DatabaseView } from "../database/DatabaseView";

export function PageView({ pageId, workspace }: { pageId: Id<"pages">; workspace: WorkspaceDoc }) {
  const ui = useUI();
  const client = useLoreClient();
  const page = useQ(api.pages.get, { pageId });
  const rename = useM(api.pages.rename);
  const setIcon = useM(api.pages.setIcon);
  const setCover = useM(api.pages.setCover);
  const updateContent = useM(api.pages.updateContent);

  const [iconPicker, setIconPicker] = useState<DOMRect | null>(null);
  const [coverPicker, setCoverPicker] = useState<DOMRect | null>(null);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  const saveTitle = useMemo(
    () => debounce((title: string) => void rename({ pageId, title }), 400),
    [pageId, rename],
  );

  // Keep the textarea height in sync with its content.
  useEffect(() => {
    const el = titleRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [titleDraft, page?.title]);

  const env = useWorkspaceEnv(workspace);

  const onSaveContent = useCallback(
    (doc: unknown) => void updateContent({ pageId, content: doc }),
    [pageId, updateContent],
  );

  if (page === undefined) {
    return (
      <div className="page-scroller">
        <div className="page-body" style={{ paddingTop: 80 }}>
          <div className="lf-skeleton" style={{ height: 46, width: "55%", marginBottom: 20 }} />
          <div className="lf-skeleton" style={{ height: 15, width: "90%", marginBottom: 10 }} />
          <div className="lf-skeleton" style={{ height: 15, width: "82%", marginBottom: 10 }} />
          <div className="lf-skeleton" style={{ height: 15, width: "70%" }} />
        </div>
      </div>
    );
  }
  if (page === null) {
    return (
      <div className="empty-state">
        <div className="big-icon">🕳️</div>
        <div>This page has vanished into the void.</div>
        <button className="lf-btn outline" onClick={() => ui.navigate(null)}>Go home</button>
      </div>
    );
  }

  const cover = coverCss(page.coverKey);
  const title = titleDraft ?? page.title;

  return (
    <EditorEnvProvider value={env}>
      <div className="page-scroller">
        {cover && (
          <div className="page-cover" style={{ background: cover }}>
            <div className="cover-actions">
              <button className="lf-btn" onClick={(e) => setCoverPicker(e.currentTarget.getBoundingClientRect())}>
                Change cover
              </button>
            </div>
          </div>
        )}
        <div className="page-body">
          <div className="page-head">
            <button
              className={`page-icon-btn${cover ? "" : " no-cover"}`}
              title="Change icon"
              onClick={(e) => setIconPicker(e.currentTarget.getBoundingClientRect())}
            >
              {page.icon ?? <span style={{ opacity: 0.25, fontSize: 40 }}>{page.type === "db" ? "🗃️" : "📄"}</span>}
            </button>
            <div className="page-hover-actions">
              {!page.icon && (
                <button className="lf-btn" onClick={(e) => setIconPicker(e.currentTarget.getBoundingClientRect())}>
                  <SmilePlus size={13} /> Add icon
                </button>
              )}
              {!cover && (
                <button className="lf-btn" onClick={(e) => setCoverPicker(e.currentTarget.getBoundingClientRect())}>
                  <ImagePlus size={13} /> Add cover
                </button>
              )}
            </div>
            <textarea
              ref={titleRef}
              className="page-title-input"
              rows={1}
              placeholder={page.type === "db" ? "Untitled database" : "Untitled"}
              value={title}
              onChange={(e) => {
                setTitleDraft(e.target.value);
                saveTitle(e.target.value);
              }}
              onBlur={() => {
                if (titleDraft !== null) saveTitle.flush(titleDraft);
                setTitleDraft(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.target as HTMLTextAreaElement).blur();
                }
              }}
            />
          </div>

          {page.type === "db" ? (
            <DatabaseView page={page} workspace={workspace} />
          ) : (
            <LoreEditor initialContent={page.content} onSave={onSaveContent} />
          )}

          <BacklinksPanel targetType="page" targetId={pageId} />
        </div>
      </div>

      {iconPicker && (
        <EmojiPicker
          anchor={iconPicker}
          onClose={() => setIconPicker(null)}
          onPick={(emoji) => void setIcon({ pageId, icon: emoji })}
          onClear={() => void setIcon({ pageId, icon: undefined })}
        />
      )}
      {coverPicker && (
        <CoverPicker
          anchor={coverPicker}
          onClose={() => setCoverPicker(null)}
          onPick={(coverKey) => void setCover({ pageId, coverKey })}
          onUpload={(file) =>
            void client.uploadFile(file).then((url) => setCover({ pageId, coverKey: `url:${url}` }))
          }
          onRemove={() => void setCover({ pageId, coverKey: undefined })}
        />
      )}
    </EditorEnvProvider>
  );
}
