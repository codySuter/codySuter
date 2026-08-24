import { ArrowDown, ArrowUp, BookCopy, Copy, Download, Pencil, Plus, Save, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, type SyncStatus } from '../api';
import { syncStatusText } from './SyncSettings';
import { runBackup, runImport } from '../App';
import { plainText } from '../model/sanitize';
import { docSearchText } from '../model/slots';
import { escapeHtml } from '../model/textImport';
import type { StudioDoc } from '../model/types';
import { useStore } from '../store';
import { AppHeader, Btn, Modal, inputCls } from './ui';
import { PageView } from './PageView';

const THUMB_W = 226;
const THUMB_SCALE = THUMB_W / 816;

function Card({
  doc,
  selecting,
  selected,
  onToggle,
}: {
  doc: StudioDoc;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const openDoc = useStore((s) => s.openDoc);
  const deleteDoc = useStore((s) => s.deleteDoc);
  const duplicateDoc = useStore((s) => s.duplicateDoc);
  const renameDoc = useStore((s) => s.renameDoc);
  const setStatus = useStore((s) => s.setStatus);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');

  const exportJson = async () => {
    const r = await api.exportDocJson(doc);
    if (r.ok) setStatus(r.path ? `Exported → ${r.path}` : 'Document file downloaded.');
    else if (!r.canceled) setStatus(`Export failed: ${r.error ?? 'unknown error'}`);
  };

  const commitRename = () => {
    setRenaming(false);
    const next = draft.trim();
    if (next && next !== plainText(doc.title)) void renameDoc(doc.id, escapeHtml(next));
  };

  const action = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    danger = false,
  ) => (
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.stopPropagation();
          onClick();
        }
      }}
      className={`rounded-[5px] border border-[#D8DBDE] bg-white p-1.5 text-[#4A4F57] shadow ${
        danger ? 'hover:text-[#C8102E]' : 'hover:text-[#15181D]'
      }`}
    >
      {icon}
    </span>
  );

  return (
    <div data-testid="library-card" className="group w-[226px]">
      <button
        type="button"
        onClick={() => {
          if (selecting) onToggle();
          else void openDoc(doc.id);
        }}
        className={`relative block w-full cursor-pointer overflow-hidden rounded-[7px] border bg-white shadow-[0_1px_4px_rgba(21,24,29,0.08)] transition-shadow hover:shadow-[0_4px_16px_rgba(21,24,29,0.18)] ${
          selecting && selected ? 'border-[#C8102E] ring-2 ring-[#C8102E]/30' : 'border-[#D8DBDE]'
        }`}
        style={{ height: THUMB_W * (11 / 8.5) }}
        aria-label={selecting ? `Select ${plainText(doc.title)}` : `Open ${plainText(doc.title)}`}
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
        {selecting && (
          <span
            data-testid="card-check"
            className={`absolute top-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-[4px] border-2 text-[12px] font-bold ${
              selected ? 'border-[#C8102E] bg-[#C8102E] text-white' : 'border-[#9AA1A8] bg-white text-transparent'
            }`}
          >
            ✓
          </span>
        )}
        {!selecting && (
          <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {action('Duplicate document', <Copy size={13} />, () => void duplicateDoc(doc.id))}
            {action('Export document file', <Download size={13} />, () => void exportJson())}
            {action('Delete document', <Trash2 size={13} />, () => void deleteDoc(doc.id), true)}
          </div>
        )}
      </button>
      <div className="mt-2 flex items-start gap-2 px-0.5">
        <span
          className="mt-[5px] inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
          style={{ background: doc.accent }}
        />
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              data-testid="rename-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRenaming(false);
              }}
              className="w-full rounded border border-[#C8102E] px-1 py-0.5 text-[13px] font-bold text-[#15181D] outline-none"
              style={{ fontFamily: "'Barlow Semi Condensed', sans-serif" }}
            />
          ) : (
            <div className="flex items-center gap-1.5">
              <div
                className="min-w-0 truncate text-[13.5px] font-bold text-[#15181D]"
                style={{ fontFamily: "'Barlow Semi Condensed', sans-serif" }}
              >
                {plainText(doc.title) || 'Untitled'}
              </div>
              <button
                type="button"
                aria-label="Rename document"
                title="Rename"
                onClick={() => {
                  setDraft(plainText(doc.title));
                  setRenaming(true);
                }}
                className="shrink-0 cursor-pointer rounded p-0.5 text-[#9AA1A8] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[#15181D]"
              >
                <Pencil size={12} />
              </button>
            </div>
          )}
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

// Order, title and TOC choice for a compiled PDF manual.
function CompileModal({
  docs,
  onClose,
}: {
  docs: StudioDoc[];
  onClose: () => void;
}) {
  const setStatus = useStore((s) => s.setStatus);
  const [order, setOrder] = useState(docs.map((d) => d.id));
  const [title, setTitle] = useState('Store Operations Manual');
  const [toc, setToc] = useState(true);
  const [busy, setBusy] = useState(false);

  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };

  const run = async () => {
    setBusy(true);
    const r = await api.compilePdf(order, title.trim() || 'Store Documents', toc);
    setBusy(false);
    onClose();
    if (r.ok && r.path) setStatus(`Saved manual → ${r.path}`);
    else if (r.canceled) setStatus('Compile canceled.');
    else if (!r.ok) setStatus(`Compile failed: ${r.error ?? 'unknown error'}`);
  };

  return (
    <Modal title="Compile into one PDF" onClose={onClose}>
      <label className="mb-3 block">
        <span className="mb-1 block text-[11.5px] font-medium text-[#4A4F57]">Manual title (cover page)</span>
        <input
          data-testid="compile-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputCls}
        />
      </label>
      <label className="mb-3 flex items-center gap-2 text-[12.5px] text-[#20242B]">
        <input type="checkbox" checked={toc} onChange={(e) => setToc(e.target.checked)} />
        Include a table of contents with page numbers
      </label>
      <div className="mb-1 text-[11.5px] font-medium text-[#4A4F57]">Order</div>
      <ul className="flex flex-col gap-1" data-testid="compile-order">
        {order.map((id, i) => {
          const d = docs.find((x) => x.id === id);
          if (!d) return null;
          return (
            <li
              key={id}
              className="flex items-center gap-2 rounded-[6px] border border-[#E1E3E6] px-2.5 py-1.5"
            >
              <span className="w-5 text-[11px] font-bold text-[#8A9099]">{i + 1}.</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-[#15181D]">
                {plainText(d.title) || 'Untitled'}
              </span>
              <button
                type="button"
                aria-label="Move earlier"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="cursor-pointer rounded p-1 text-[#4A4F57] hover:bg-[#F0F1F2] disabled:cursor-default disabled:opacity-30"
              >
                <ArrowUp size={13} />
              </button>
              <button
                type="button"
                aria-label="Move later"
                onClick={() => move(i, 1)}
                disabled={i === order.length - 1}
                className="cursor-pointer rounded p-1 text-[#4A4F57] hover:bg-[#F0F1F2] disabled:cursor-default disabled:opacity-30"
              >
                <ArrowDown size={13} />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex justify-end gap-2">
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" disabled={busy} data-testid="compile-run" onClick={() => void run()}>
          Export PDF
        </Btn>
      </div>
      <p className="mt-2 text-[11px] text-[#8A9099]">
        Cover page, then each document on a fresh page, with continuous “Page x of y” footers.
      </p>
    </Modal>
  );
}

export function Library() {
  const docs = useStore((s) => s.docs);
  const status = useStore((s) => s.status);
  const statusAction = useStore((s) => s.statusAction);
  const setModal = useStore((s) => s.setModal);
  const [query, setQuery] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [compiling, setCompiling] = useState(false);
  const [syncStat, setSyncStat] = useState<SyncStatus | null>(null);

  // Small sync readout in the footer (desktop app, when sync is on).
  useEffect(() => {
    let dead = false;
    const tick = () => void api.syncStatus().then((s) => !dead && setSyncStat(s));
    tick();
    const timer = setInterval(tick, 30_000);
    const off = api.onSync(() => tick());
    return () => {
      dead = true;
      clearInterval(timer);
      off();
    };
  }, []);

  // Search runs over everything on the page — title, badges, bullets,
  // table cells — not just the header fields.
  const searchIndex = useMemo(
    () => new Map(docs.map((d) => [d.id, docSearchText(d)])),
    [docs],
  );
  const q = query.trim().toLowerCase();
  const visible = q ? docs.filter((d) => (searchIndex.get(d.id) ?? '').includes(q)) : docs;

  const toggle = (id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const compileDocs = docs.filter((d) => selected.has(d.id));

  return (
    <div className="flex h-full flex-col">
      <AppHeader
        right={
          <>
            <Btn variant="topbar" onClick={() => void runImport()} data-testid="import-btn">
              <Upload size={14} /> Import
            </Btn>
            <Btn variant="topbar" onClick={() => void runBackup()} data-testid="backup-btn">
              <Save size={14} /> Back up
            </Btn>
            <Btn
              variant="topbar"
              onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
              data-testid="compile-btn"
              title="Pick documents and export them as one PDF manual"
            >
              <BookCopy size={14} /> {selecting ? 'Cancel' : 'Compile PDF'}
            </Btn>
            <Btn variant="topbar-primary" onClick={() => setModal('templates')} data-testid="new-doc">
              <Plus size={14} /> New Document
            </Btn>
          </>
        }
      />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1080px] px-8 py-8">
          <h1
            className="text-[26px] font-extrabold tracking-[0.01em] text-[#15181D] uppercase"
            style={{ fontFamily: "'Barlow Semi Condensed', sans-serif" }}
          >
            Document Library
          </h1>
          <div className="mb-5 mt-1 h-[3px] w-[64px] rounded bg-[#C8102E]" />
          {selecting && (
            <div
              data-testid="compile-bar"
              className="mb-5 flex items-center gap-3 rounded-[8px] border border-[#C8102E]/40 bg-[#FDECEE] px-4 py-2.5"
            >
              <span className="text-[12.5px] font-semibold text-[#15181D]">
                {selected.size} selected — click cards to choose what goes into the manual.
              </span>
              <Btn
                variant="ghost"
                onClick={() =>
                  setSelected(
                    selected.size === visible.length
                      ? new Set()
                      : new Set(visible.map((d) => d.id)),
                  )
                }
              >
                {selected.size === visible.length ? 'Select none' : 'Select all'}
              </Btn>
              <div className="ml-auto">
                <Btn
                  variant="primary"
                  disabled={selected.size === 0}
                  data-testid="compile-continue"
                  onClick={() => setCompiling(true)}
                >
                  Compile {selected.size || ''} → PDF
                </Btn>
              </div>
            </div>
          )}
          {docs.length > 0 && (
            <div className="mb-5 flex items-center gap-3">
              <input
                data-testid="library-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search everything in your documents…"
                className={`${inputCls} max-w-[300px]`}
              />
              {q && (
                <span className="text-[12px] text-[#6D6E71]">
                  {visible.length} of {docs.length} match
                </span>
              )}
            </div>
          )}
          {docs.length === 0 ? (
            <div className="rounded-lg border-2 border-dashed border-[#C9CED4] bg-white/60 p-14 text-center">
              <p className="mb-4 text-[14px] text-[#4A4F57]">
                No documents yet — New Document opens a picker of ready-to-edit starting points.
              </p>
              <Btn variant="primary" onClick={() => setModal('templates')}>
                <Plus size={14} /> New Document
              </Btn>
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-lg border-2 border-dashed border-[#C9CED4] bg-white/60 p-10 text-center text-[13px] text-[#4A4F57]">
              No documents match “{query.trim()}”.
            </div>
          ) : (
            <div className="flex flex-wrap gap-7">
              {visible.map((d) => (
                <Card
                  key={d.id}
                  doc={d}
                  selecting={selecting}
                  selected={selected.has(d.id)}
                  onToggle={() => toggle(d.id)}
                />
              ))}
            </div>
          )}
        </div>
      </main>
      <footer className="flex h-7 shrink-0 items-center gap-2 border-t border-[#D8DBDE] bg-white px-3 text-[11.5px] text-[#4A4F57]">
        <span className="truncate" data-testid="status-text">
          {status}
        </span>
        {statusAction && (
          <button
            type="button"
            data-testid="status-action"
            onClick={statusAction.run}
            className="shrink-0 cursor-pointer font-bold tracking-[0.04em] text-[#C8102E] uppercase hover:underline"
          >
            {statusAction.label}
          </button>
        )}
        {syncStat?.supported && (syncStat.enabled || syncStat.lastError) && (
          <button
            type="button"
            data-testid="sync-footer"
            title="Sync with the other store computers — click for settings"
            onClick={() => setModal('sync')}
            className={`ml-auto shrink-0 cursor-pointer text-[11px] hover:underline ${
              syncStat.lastError ? 'font-semibold text-[#C8102E]' : 'text-[#6D6E71]'
            }`}
          >
            {syncStatusText(syncStat)}
          </button>
        )}
      </footer>
      {compiling && compileDocs.length > 0 && (
        <CompileModal
          docs={compileDocs}
          onClose={() => {
            setCompiling(false);
            stopSelecting();
          }}
        />
      )}
    </div>
  );
}
