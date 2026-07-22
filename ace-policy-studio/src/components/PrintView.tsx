import { useEffect } from 'react';
import { plainText } from '../model/sanitize';
import { useStore } from '../store';
import { PageView } from './PageView';

// Standalone print/PDF surface. In Electron this renders inside a hidden
// window; when fonts and layout are ready it signals the main process,
// which runs printToPDF / print. In a plain browser it opens the print
// dialog itself.
export function PrintView() {
  const doc = useStore((s) => s.current);

  useEffect(() => {
    document.body.classList.add('print-mode');
    return () => document.body.classList.remove('print-mode');
  }, []);

  useEffect(() => {
    if (!doc) return;
    document.title = plainText(doc.title) || 'Policy document';
    let dead = false;
    void (async () => {
      await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (dead) return;
      if (window.aps?.isElectron) {
        window.aps.printReady();
      } else {
        const s = document.createElement('style');
        s.textContent = '@page { size: letter; margin: 0.4in }';
        document.head.appendChild(s);
        window.print();
      }
    })();
    return () => {
      dead = true;
    };
  }, [doc]);

  if (!doc) {
    return <div style={{ padding: 40, fontFamily: "'IBM Plex Sans', sans-serif" }}>Loading document…</div>;
  }
  return (
    <div style={{ background: '#fff', minHeight: '100vh' }}>
      <PageView doc={doc} mode="print" />
    </div>
  );
}
