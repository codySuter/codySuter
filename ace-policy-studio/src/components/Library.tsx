import { Copy, FolderSync, LifeBuoy, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type LibrarySettings } from '../api';
import { plainText } from '../model/sanitize';
import type { PolicyDoc } from '../model/types';
import { useStore } from '../store';
import { AppHeader, Btn } from './ui';
import { PageView } from './PageView';

function SettingsModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<LibrarySettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const refreshFromDisk = useStore((s) => s.refreshFromDisk);

  useEffect(() => {
    void api.getSettings?.().then(setSettings);
  }, []);

  const applyChange = async (fn: (() => Promise<{ changed: boolean; copied?: number; settings?: LibrarySettings }>) | undefined) => {
    if (!fn || busy) return;
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.changed && r.settings) {
      setSettings(r.settings);
      setNote(
        `Done — ${r.copied ?? 0} document${(r.copied ?? 0) === 1 ? '' : 's'} merged into the new folder.`,
      );
      void refreshFromDisk();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#15181D]/50 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div data-testid="settings-modal" className="w-full max-w-[540px] rounded-[10px] bg-white p-6 shadow-2xl">
        <div className="mb-1 flex items-start justify-between">
          <h2
            className="text-[20px] font-extrabold text-[#15181D] uppercase"
            style={{ fontFamily: "'Barlow Semi Condensed', sans-serif" }}
          >
            Two computers, one library
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="cursor-pointer rounded p-1 text-[#6D6E71] hover:bg-[#F0F1F2]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mb-4 h-[3px] w-[52px] rounded bg-[#C8102E]" />
        <p className="mb-4 text-[13px] leading-relaxed text-[#4A4F57]">
          Point both computers at the <b>same shared folder</b> — OneDrive, Google Drive, or a
          network drive — and each app picks up the other's documents whenever it opens or
          comes back to the front. Newest save wins, and deletions carry over too. Set the
          same folder on the other computer and you're done.
        </p>
        {api.isElectron && settings ? (
          <>
            <div className="mb-4 rounded-[7px] border border-[#D8DBDE] bg-[#F7F7F8] px-3 py-2.5">
              <div className="mb-0.5 flex items-center gap-2">
                <span
                  className="text-[10.5px] font-bold tracking-[0.08em] text-[#6D6E71] uppercase"
                  style={{ fontFamily: "'Barlow Semi Condensed', sans-serif" }}
                >
                  Current library folder
                </span>
                <span
                  className={`rounded-[3px] px-1.5 py-0.5 text-[9.5px] font-bold uppercase ${
                    settings.isCustom ? 'bg-[#005238] text-white' : 'bg-[#D8DBDE] text-[#4A4F57]'
                  }`}
                  style={{ fontFamily: "'Barlow Semi Condensed', sans-serif" }}
                >
                  {settings.isCustom ? 'Shared' : 'This computer only'}
                </span>
              </div>
              <div className="break-all font-mono text-[11.5px] text-[#20242B]">{settings.docsDir}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Btn
                variant="primary"
                disabled={busy}
                onClick={() => void applyChange(api.chooseLibraryFolder)}
              >
                <FolderSync size={14} /> Choose shared folder…
              </Btn>
              {settings.isCustom && (
                <Btn disabled={busy} onClick={() => void applyChange(api.useDefaultFolder)}>
                  Back to this computer only
                </Btn>
              )}
            </div>
            {note && <p className="mt-3 text-[12px] font-medium text-[#005238]">{note}</p>}
            <p className="mt-3 text-[11px] leading-relaxed text-[#8A9099]">
              Switching folders copies your documents over (never deletes anything). If the
              other computer just saved, give OneDrive a moment to sync before expecting the
              change here.
            </p>
          </>
        ) : (
          <p className="text-[12px] text-[#8A9099]">
            Folder settings are available in the installed Windows app.
          </p>
        )}
      </div>
    </div>
  );
}

const THUMB_W = 226;
const THUMB_SCALE = THUMB_W / 816;

function Card({ doc }: { doc: PolicyDoc }) {
  const openDoc = useStore((s) => s.openDoc);
  const deleteDoc = useStore((s) => s.deleteDoc);
  const duplicateDoc = useStore((s) => s.duplicateDoc);

  return (
    <div data-testid="library-card" className="group w-[226px]">
      <button
        type="button"
        onClick={() => void openDoc(doc.id)}
        className="relative block w-full cursor-pointer overflow-hidden rounded-[7px] border border-[#D8DBDE] bg-white shadow-[0_1px_4px_rgba(21,24,29,0.08)] transition-shadow hover:shadow-[0_4px_16px_rgba(21,24,29,0.18)]"
        style={{ height: THUMB_W * (11 / 8.5) }}
        aria-label={`Open ${plainText(doc.title)}`}
      >
        <div
          style={{
            transform: `scale(${THUMB_SCALE})`,
            transformOrigin: 'top left',
            width: 816,
            pointerEvents: 'none',
          }}
        >
          <PageView doc={doc} mode="thumb" />
        </div>
        <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <span
            role="button"
            tabIndex={0}
            aria-label="Duplicate document"
            title="Duplicate"
            onClick={(e) => {
              e.stopPropagation();
              void duplicateDoc(doc.id);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation();
                void duplicateDoc(doc.id);
              }
            }}
            className="rounded-[5px] border border-[#D8DBDE] bg-white p-1.5 text-[#4A4F57] shadow hover:text-[#15181D]"
          >
            <Copy size={13} />
          </span>
          <span
            role="button"
            tabIndex={0}
            aria-label="Delete document"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm(`Delete “${plainText(doc.title)}”? This can't be undone.`)) {
                void deleteDoc(doc.id);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.stopPropagation();
            }}
            className="rounded-[5px] border border-[#D8DBDE] bg-white p-1.5 text-[#4A4F57] shadow hover:text-[#C8102E]"
          >
            <Trash2 size={13} />
          </span>
        </div>
      </button>
      <div className="mt-2 flex items-start gap-2 px-0.5">
        <span
          className="mt-[5px] inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
          style={{ background: doc.accent }}
        />
        <div className="min-w-0">
          <div
            className="truncate text-[13.5px] font-bold text-[#15181D]"
            style={{ fontFamily: "'Barlow Semi Condensed', sans-serif" }}
          >
            {plainText(doc.title) || 'Untitled'}
          </div>
          <div className="truncate text-[11px] text-[#6D6E71]">
            {plainText(doc.subtitle)}
          </div>
          <div className="text-[10.5px] text-[#9AA1A8]">
            Updated {new Date(doc.updatedAt).toLocaleDateString()}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Library() {
  const docs = useStore((s) => s.docs);
  const createNewDoc = useStore((s) => s.createNewDoc);
  const toSupport = useStore((s) => s.toSupport);
  const status = useStore((s) => s.status);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <AppHeader
        right={
          <>
            <button
              type="button"
              aria-label="Library folder settings"
              title="Two computers, one library — shared folder settings"
              data-testid="settings-btn"
              onClick={() => setSettingsOpen(true)}
              className="cursor-pointer rounded p-1.5 text-white/85 hover:bg-white/10"
            >
              <FolderSync size={15} />
            </button>
            <Btn variant="topbar" onClick={toSupport} data-testid="support-btn">
              <LifeBuoy size={14} /> Support
            </Btn>
            <Btn variant="topbar-primary" onClick={() => void createNewDoc()} data-testid="new-doc">
              <Plus size={14} /> New Document
            </Btn>
          </>
        }
      />
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1080px] px-8 py-8">
          <h1
            className="text-[26px] font-extrabold tracking-[0.01em] text-[#15181D] uppercase"
            style={{ fontFamily: "'Barlow Semi Condensed', sans-serif" }}
          >
            Policy &amp; Procedure Documents
          </h1>
          <div className="mb-6 mt-1 h-[3px] w-[64px] rounded bg-[#C8102E]" />
          {docs.length === 0 ? (
            <div className="rounded-lg border-2 border-dashed border-[#C9CED4] bg-white/60 p-14 text-center">
              <p className="mb-4 text-[14px] text-[#4A4F57]">
                No documents yet — New Document opens a ready-to-edit outline.
              </p>
              <Btn variant="primary" onClick={() => void createNewDoc()}>
                <Plus size={14} /> New Document
              </Btn>
            </div>
          ) : (
            <div className="flex flex-wrap gap-7">
              {docs.map((d) => (
                <Card key={d.id} doc={d} />
              ))}
            </div>
          )}
        </div>
      </main>
      <footer className="flex h-7 shrink-0 items-center border-t border-[#D8DBDE] bg-white px-3 text-[11.5px] text-[#4A4F57]">
        {status}
      </footer>
    </div>
  );
}
