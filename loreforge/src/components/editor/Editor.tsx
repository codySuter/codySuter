import { useEffect, useMemo } from "react";
import {
  useCreateBlockNote,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { filterSuggestionItems } from "@blocknote/core";
import { loreSchema, type LorePartialBlock } from "./schema";
import { ttrpgSlashItems } from "./slashItems";
import { useEditorEnv } from "./EditorEnv";
import { useUI } from "../../lib/store";
import { debounce, reviveDoc, sanitizeDoc } from "../../lib/utils";

export function LoreEditor({
  initialContent,
  onSave,
  autoFocus,
}: {
  initialContent: unknown;
  onSave: (doc: unknown) => void;
  autoFocus?: boolean;
}) {
  const env = useEditorEnv();
  const theme = useUI((s) => s.theme);

  const editor = useCreateBlockNote(
    {
      schema: loreSchema,
      initialContent:
        Array.isArray(initialContent) && initialContent.length > 0
          ? (reviveDoc(initialContent) as LorePartialBlock[])
          : undefined,
      uploadFile: env.uploadFile,
    },
    [],
  );

  const save = useMemo(
    () => debounce((doc: unknown) => onSave(sanitizeDoc(doc)), 700),
    [onSave],
  );

  useEffect(() => {
    return () => {
      // Flush any pending edits when the page unmounts.
      save.flush(editor.document);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (autoFocus) {
      setTimeout(() => editor.focus(), 30);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getMentionItems = async (query: string): Promise<DefaultReactSuggestionItem[]> => {
    const targets = await env.searchTargets(query);
    return targets.slice(0, 8).map((target) => ({
      title: target.label || "Untitled",
      subtext: target.kind,
      icon: (
        <span style={{ fontSize: 15 }}>{target.icon || (target.targetType === "entry" ? "•" : "📄")}</span>
      ),
      onItemClick: () => {
        editor.insertInlineContent([
          {
            type: "mention",
            props: {
              targetType: target.targetType,
              targetId: target.targetId,
              label: target.label,
              icon: target.icon,
            },
          },
          " ",
        ]);
      },
    }));
  };

  return (
    <div className="lf-editor">
      <BlockNoteView
        editor={editor}
        theme={theme}
        slashMenu={false}
        onChange={() => save(editor.document)}
      >
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) =>
            filterSuggestionItems(
              [...ttrpgSlashItems(editor, env.mode), ...getDefaultReactSlashMenuItems(editor)],
              query,
            )
          }
        />
        <SuggestionMenuController triggerCharacter="@" getItems={getMentionItems} />
      </BlockNoteView>
    </div>
  );
}
