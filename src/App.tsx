import { useEffect, useMemo, useState } from "react";
import type { Character } from "./types";
import { useStore, boardOrder } from "./store/useStore";
import { TEMPLATES, characterFromTemplate } from "./lib/templates";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { Board } from "./components/Board";
import { CharacterEditor } from "./components/CharacterEditor";
import { SrdImportDialog } from "./components/SrdImportDialog";

type EditorState = { draft: Character; isNew: boolean } | null;

export default function App() {
  const loaded = useStore((s) => s.loaded);
  const init = useStore((s) => s.init);
  const characters = useStore((s) => s.characters);
  const encounter = useStore((s) => s.encounter);

  const [editor, setEditor] = useState<EditorState>(null);
  const [srdOpen, setSrdOpen] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  const ordered = useMemo(
    () => boardOrder(characters, encounter),
    [characters, encounter],
  );

  function openEdit(id: string) {
    const c = characters.find((x) => x.id === id);
    if (c) setEditor({ draft: c, isNew: false });
  }

  function openNewFromTemplate(templateKey: string) {
    const t = TEMPLATES.find((x) => x.key === templateKey) ?? TEMPLATES[0];
    setEditor({ draft: characterFromTemplate(t), isNew: true });
  }

  if (!loaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-200">
      <Sidebar
        onEdit={openEdit}
        onImport={() => setSrdOpen(true)}
        onNewFromTemplate={openNewFromTemplate}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Board
            characters={ordered}
            encounter={encounter}
            onEdit={openEdit}
            onNew={() => openNewFromTemplate("monster")}
            onImport={() => setSrdOpen(true)}
          />
        </div>
      </main>

      {editor && (
        <CharacterEditor
          key={editor.draft.id}
          initial={editor.draft}
          isNew={editor.isNew}
          onClose={() => setEditor(null)}
        />
      )}

      {srdOpen && <SrdImportDialog onClose={() => setSrdOpen(false)} />}
    </div>
  );
}
