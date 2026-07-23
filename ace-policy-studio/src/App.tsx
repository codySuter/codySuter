import { useEffect } from 'react';
import { api } from './api';
import { plainText } from './model/sanitize';
import { useStore } from './store';
import { Editor } from './components/Editor';
import { Library } from './components/Library';
import { PrintView } from './components/PrintView';
import { Support } from './components/Support';

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
      else if (cmd === 'support') st.toSupport();
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

  // Renderer errors flow into the app log, so Support tickets carry them.
  useEffect(() => {
    const onError = (e: ErrorEvent) =>
      api.logError?.(`error: ${e.message} @ ${e.filename}:${e.lineno}`);
    const onRejection = (e: PromiseRejectionEvent) =>
      api.logError?.(`unhandledrejection: ${String(e.reason)}`);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  // Shared-folder sync: refresh when the window regains focus or the
  // library folder changes on disk (the other computer saved something).
  useEffect(() => {
    let t: number | undefined;
    const kick = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => void useStore.getState().refreshFromDisk(), 300);
    };
    const unsubscribe = api.onDocsChanged?.(kick);
    window.addEventListener('focus', kick);
    return () => {
      unsubscribe?.();
      window.removeEventListener('focus', kick);
      window.clearTimeout(t);
    };
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
    case 'support':
      return <Support />;
    case 'print':
      return <PrintView />;
  }
}
