import { useEffect } from 'react';
import { api } from './api';
import { plainText } from './model/sanitize';
import { useStore } from './store';
import { Editor } from './components/Editor';
import { Library } from './components/Library';
import { PrintView } from './components/PrintView';

export default function App() {
  const route = useStore((s) => s.route);

  useEffect(() => {
    void useStore.getState().init();
  }, []);

  // Native menu (Electron): File → New / Export PDF / Print / Library.
  useEffect(() => {
    return api.onMenu((cmd) => {
      const st = useStore.getState();
      if (cmd === 'new-doc') void st.createNewDoc();
      else if (cmd === 'library') void st.toLibrary();
      else if (cmd === 'undo') st.undo();
      else if (cmd === 'redo') st.redo();
      else if ((cmd === 'export-pdf' || cmd === 'print') && st.route.name === 'editor' && st.current) {
        const doc = st.current;
        void (async () => {
          st.setStatus(cmd === 'export-pdf' ? 'Exporting PDF…' : 'Opening print dialog…');
          await st.saveNow();
          if (cmd === 'export-pdf') {
            const r = await api.exportPdf(doc.id, plainText(doc.title) || 'Policy document');
            if (r.ok && r.path) st.setStatus(`Saved PDF → ${r.path}`);
            else if (r.canceled) st.setStatus('PDF export canceled.');
          } else {
            await api.printDoc(doc.id);
          }
        })();
      }
    });
  }, []);

  // Auto-updater progress lands in the status bar.
  useEffect(() => {
    return api.onUpdateStatus?.((text) => {
      if (text) useStore.getState().setStatus(text);
    });
  }, []);

  // Deep links (#/print/<id>) — how the hidden print window finds its doc.
  useEffect(() => {
    const onHash = () => {
      const m = window.location.hash.match(/^#\/print\/(.+)$/);
      if (m) void useStore.getState().loadPrint(decodeURIComponent(m[1]));
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
