import { Copy, Plus, Trash2 } from 'lucide-react';
import { plainText } from '../model/sanitize';
import type { PolicyDoc } from '../model/types';
import { useStore } from '../store';
import { AppHeader, Btn } from './ui';
import { PageView } from './PageView';

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
  const status = useStore((s) => s.status);

  return (
    <div className="flex h-full flex-col">
      <AppHeader
        right={
          <Btn variant="topbar-primary" onClick={() => void createNewDoc()} data-testid="new-doc">
            <Plus size={14} /> New Document
          </Btn>
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
