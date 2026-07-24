import { useEffect, useRef } from 'react';
import { plainText } from '../model/sanitize';
import { PRINTABLE_H_PX } from '../model/types';
import { useStore } from '../store';
import { PageView } from './PageView';

// Standalone print/PDF surface. In Electron this renders inside a hidden
// window; when fonts and layout are ready it signals the main process —
// including whether the document spans multiple pages, so PDFs get
// "Page x of y" footers only when they help — and main runs
// printToPDF / print. In a plain browser it opens the print dialog
// itself, then navigates back to wherever the user was.
export function PrintView() {
  const doc = useStore((s) => s.current);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.body.classList.add('print-mode');
    return () => document.body.classList.remove('print-mode');
  }, []);

  useEffect(() => {
    if (!doc) return;
    document.title = plainText(doc.title) || 'Document';
    let dead = false;
    void (async () => {
      await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (dead) return;
      const contentH = wrapRef.current?.offsetHeight ?? 0;
      const multiPage =
        contentH > PRINTABLE_H_PX || doc.blocks.some((b) => b.type === 'pageBreak');
      if (window.aps?.isElectron) {
        window.aps.printReady({ multiPage });
      } else {
        const s = document.createElement('style');
        s.textContent = '@page { size: letter; margin: 0.4in }';
        document.head.appendChild(s);
        // window.print() blocks until the dialog closes; afterwards go
        // back to the editor or library the user printed from.
        window.print();
        window.history.back();
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
      <div ref={wrapRef}>
        <PageView doc={doc} mode="print" />
      </div>
    </div>
  );
}
