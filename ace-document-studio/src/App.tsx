import { useEffect } from 'react';
import { api } from './api';
import { plainText } from './model/sanitize';
import { useStore } from './store';
import { BackupRestore } from './components/BackupRestore';
import { CompileView } from './components/CompileView';
import { Editor } from './components/Editor';
import { Library } from './components/Library';
import { PrintView } from './components/PrintView';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { SyncSettings } from './components/SyncSettings';
import { TemplatePicker } from './components/TemplatePicker';

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
  const modal = useStore((s) => s.modal);
  const setModal = useStore((s) => s.setModal);

  useEffect(() => {
    void useStore.getState().init();
  }, []);

  // Native menu (Electron): File → New / Export / Print / Library /
  // Import / Back up / Restore, Help → Shortcuts…
  useEffect(() => {
    return api.onMenu((cmd) => {
      const st = useStore.getState();
      if (cmd === 'new-doc') st.setModal('templates');
      else if (cmd === 'library') void st.toLibrary();
      else if (cmd === 'undo') st.undo();
      else if (cmd === 'redo') st.redo();
      else if (cmd === 'import') void runImport();
      else if (cmd === 'backup') void runBackup();
      else if (cmd === 'restore-backup') st.setModal('backups');
      else if (cmd === 'sync-settings') st.setModal('sync');
      else if (cmd === 'shortcuts') st.setModal('shortcuts');
      else if (cmd === 'refresh-library') void st.toLibrary();
      else if (cmd === 'history' && st.route.name === 'editor') st.setModal('history');
      else if (cmd === 'save-template' && st.route.name === 'editor') st.setModal('saveTemplate');
      else if (
        (cmd === 'export-pdf' || cmd === 'export-png' || cmd === 'print') &&
        st.route.name === 'editor' &&
        st.current
      ) {
        const doc = st.current;
        void (async () => {
          st.setStatus(
            cmd === 'export-pdf'
              ? 'Exporting PDF…'
              : cmd === 'export-png'
                ? 'Exporting PNG…'
                : 'Opening print dialog…',
          );
          await st.saveNow();
          if (cmd === 'export-pdf') {
            const r = await api.exportPdf(doc.id, plainText(doc.title) || 'Document');
            if (r.ok && r.path) st.setStatus(`Saved PDF → ${r.path}`);
            else if (r.canceled) st.setStatus('PDF export canceled.');
          } else if (cmd === 'export-png') {
            const r = await api.exportPng(doc.id, plainText(doc.title) || 'Document');
            if (r.ok && r.paths?.length) st.setStatus(`Saved PNG → ${r.paths[0]}`);
            else if (r.canceled) st.setStatus('PNG export canceled.');
            else if (!r.ok) st.setStatus(`PNG export failed: ${r.error ?? 'unknown error'}`);
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

  // Another computer's changes just landed on disk — refresh what's on
  // screen (the library re-lists; an open editor keeps its document and
  // newest-edit-wins settles it on the next save).
  useEffect(() => {
    return api.onSync((e) => {
      if (e.kind !== 'remote-update') return;
      const st = useStore.getState();
      if (st.route.name === 'library') {
        void st.toLibrary().then(() => {
          useStore.getState().setStatus('Synced updates from another computer.');
        });
      } else if (st.route.name === 'editor') {
        st.setStatus('Synced updates from another computer — the library reflects them.');
      }
    });
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

  // Hash routing: the hidden print/compile windows deep-link to
  // #/print/<id> and #/compile/<ids>, and browser back/forward (e.g.
  // returning from the print view) restores the editor or library.
  useEffect(() => {
    const onHash = () => {
      const st = useStore.getState();
      const hash = window.location.hash;
      const compileMatch = hash.match(/^#\/compile\/([^?]+)(?:\?(.*))?$/);
      if (compileMatch) {
        const params = new URLSearchParams(compileMatch[2] ?? '');
        void st.loadCompile(
          decodeURIComponent(compileMatch[1]).split(',').filter(Boolean),
          params.get('title') ?? 'Store Documents',
          params.get('toc') !== '0',
        );
        return;
      }
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

  const overlays = (
    <>
      {modal === 'templates' && <TemplatePicker onClose={() => setModal(null)} />}
      {modal === 'shortcuts' && <ShortcutsHelp onClose={() => setModal(null)} />}
      {modal === 'backups' && <BackupRestore onClose={() => setModal(null)} />}
      {modal === 'sync' && <SyncSettings onClose={() => setModal(null)} />}
    </>
  );

  switch (route.name) {
    case 'boot':
      return (
        <div className="flex h-full items-center justify-center text-[13px] text-[#6D6E71]">
          Loading your library…
        </div>
      );
    case 'library':
      return (
        <>
          <Library />
          {overlays}
        </>
      );
    case 'editor':
      return (
        <>
          <Editor />
          {overlays}
        </>
      );
    case 'print':
      return <PrintView />;
    case 'compile':
      return <CompileView />;
  }
}
