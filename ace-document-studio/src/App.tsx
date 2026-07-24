import { useEffect } from 'react';
import { api } from './api';
import { plainText } from './model/sanitize';
import { useStore } from './store';
import { Editor } from './components/Editor';
import { Library } from './components/Library';
import { PrintView } from './components/PrintView';

export async function runImport(): Promise<void> {
  const st = useStore.getState();
  const r = await api.importDocs();
  if (r.ok) {
    st.setStatus(`Imported ${r.added ?? 0} document${r.added === 1 ? '' : 's'}.`);
    await useStore.getState().toLibrary();
  } else if (!r.canceled) {
    st.setStatus(`Import failed: ${r.error ?? 'unknown error'}`);
  }
}

export async function runBackup(): Promise<void> {
  const st = useStore.getState();
  const r = await api.backupLibrary();
  if (r.ok) {
    st.setStatus(
      r.path
        ? `Backed up ${r.count ?? 0} documents → ${r.path}`
        : `Backup downloaded (${r.count ?? 0} documents).`,
    );
  } else if (!r.canceled) {
    st.setStatus(`Backup failed: ${r.error ?? 'unknown error'}`);
  }
}

export default function App() {
  const route = useStore((s) => s.route);

  useEffect(() => {
    void useStore.getState().init();
  }, []);

  // Native menu (Electron): File → New / Export PDF / Print / Library /
  // Import / Back up.
  useEffect(() => {
    return api.onMenu((cmd) => {
      const st = useStore.getState();
      if (cmd === 'new-doc') void st.createNewDoc();
      else if (cmd === 'library') void st.toLibrary();
      else if (cmd === 'undo') st.undo();
      else if (cmd === 'redo') st.redo();
      else if (cmd === 'import') void runImport();
      else if (cmd === 'backup') void runBackup();
      else if ((cmd === 'export-pdf' || cmd === 'print') && st.route.name === 'editor' && st.current) {
        const doc = st.current;
        void (async () => {
          st.setStatus(cmd === 'export-pdf' ? 'Exporting PDF…' : 'Opening print dialog…');
          await st.saveNow();
          if (cmd === 'export-pdf') {
            const r = await api.exportPdf(doc.id, plainText(doc.title) || 'Document');
            if (r.ok && r.path) st.setStatus(`Saved PDF → ${r.path}`);
            else if (r.canceled) st.setStatus('PDF export canceled.');
          } else {
            await api.printDoc(doc.id);
          }
        })();
      }
    });
  }, []);

  // A newer build was published — point at Help → Check for Updates.
  useEffect(() => {
    return api.onUpdate((version) =>
      useStore
        .getState()
        .setStatus(`Update available — version ${version}. Help → Check for Updates… to download.`),
    );
  }, []);

  // The autosave debounce waits 700ms; if the window closes inside that
  // window, write the current document straight to disk so nothing is lost.
  useEffect(() => {
    const flush = () => {
      const st = useStore.getState();
      if (st.saveState !== 'saved' && st.current) void api.saveDoc(st.current);
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  // Hash routing: the hidden print window deep-links to #/print/<id>, and
  // browser back/forward (e.g. returning from the print view) restores
  // the editor or library.
  useEffect(() => {
    const onHash = () => {
      const st = useStore.getState();
      const hash = window.location.hash;
      const printMatch = hash.match(/^#\/print\/(.+)$/);
      if (printMatch) {
        void st.loadPrint(decodeURIComponent(printMatch[1]));
        return;
      }
      const editorMatch = hash.match(/^#\/editor\/(.+)$/);
      if (editorMatch) {
        const id = decodeURIComponent(editorMatch[1]);
        if (st.route.name !== 'editor' || st.route.id !== id) void st.openDoc(id);
        return;
      }
      if (hash === '#/library' && st.route.name !== 'library') void st.toLibrary();
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  switch (route.name) {
    case 'boot':
      return (
        <div className="flex h-full items-center justify-center text-[13px] text-[#6D6E71]">
          Loading your library…
        </div>
      );
    case 'library':
      return <Library />;
    case 'editor':
      return <Editor />;
    case 'print':
      return <PrintView />;
  }
}
