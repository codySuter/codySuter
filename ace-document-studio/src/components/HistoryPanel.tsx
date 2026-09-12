import { useEffect, useState } from 'react';
import { api, type HistoryEntry } from '../api';
import { normalizeDoc } from '../model/normalize';
import type { StudioDoc } from '../model/types';
import { useStore } from '../store';
import { Btn, Modal } from './ui';
import { PageView } from './PageView';

const PREVIEW_W = 300;

function stamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Revision history: the app snapshots each document's saved state when an
// editing stretch begins (at most one snapshot per 10 minutes). This panel
// previews any snapshot and restores it — restoring first snapshots the
// current state, so nothing is ever lost.
export function HistoryPanel({ onClose }: { onClose: () => void }) {
  const current = useStore((s) => s.current);
  const replaceCurrent = useStore((s) => s.replaceCurrent);
  const saveNow = useStore((s) => s.saveNow);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [selected, setSelected] = useState<HistoryEntry | null>(null);
  const [preview, setPreview] = useState<StudioDoc | null>(null);

  const docId = current?.id;

  useEffect(() => {
    if (!docId) return;
    void api.listHistory(docId).then((list) => {
      setEntries(list);
      setSelected(list[0] ?? null);
    });
  }, [docId]);

  useEffect(() => {
    if (!docId || !selected) {
      setPreview(null);
      return;
    }
    let dead = false;
    void api.readHistory(docId, selected.file).then((doc) => {
      if (!dead) setPreview(doc ? normalizeDoc(doc) : null);
    });
    return () => {
      dead = true;
    };
  }, [docId, selected]);

  if (!current || !docId) return null;

  const restore = async () => {
    if (!preview || !selected) return;
    // Keep the state being replaced: flush it to disk, snapshot it, then swap.
    await saveNow();
    await api.snapshotHistory(docId);
    replaceCurrent(preview, `Restored the version from ${stamp(selected.ts)}.`);
    onClose();
  };

  return (
    <Modal title="Version history" onClose={onClose} wide>
      {entries === null ? (
        <p className="text-[13px] text-[#6D6E71]">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-[13px] text-[#6D6E71]">
          No earlier versions yet. A snapshot is kept automatically each time you come back
          and edit this document.
        </p>
      ) : (
        <div className="flex gap-4">
          <div className="w-[220px] shrink-0">
            <ul className="flex flex-col gap-1" data-testid="history-list">
              {entries.map((e) => (
                <li key={e.file}>
                  <button
                    type="button"
                    onClick={() => setSelected(e)}
                    className={`w-full cursor-pointer rounded-[6px] border px-2.5 py-2 text-left text-[12px] ${
                      selected?.file === e.file
                        ? 'border-[#C8102E] bg-[#FDECEE] font-semibold text-[#15181D]'
                        : 'border-[#E1E3E6] bg-white text-[#4A4F57] hover:border-[#9AA1A8]'
                    }`}
                  >
                    {stamp(e.ts)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0 flex-1">
            {preview ? (
              <>
                <div
                  className="overflow-hidden rounded-[7px] border border-[#D8DBDE] shadow-[0_1px_4px_rgba(21,24,29,0.08)]"
                  style={{ width: PREVIEW_W, height: PREVIEW_W * (11 / 8.5) }}
                >
                  <div
                    style={{
                      transform: `scale(${PREVIEW_W / 816})`,
                      transformOrigin: 'top left',
                      width: 816,
                      pointerEvents: 'none',
                    }}
                  >
                    <PageView doc={preview} mode="thumb" />
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <Btn variant="primary" data-testid="history-restore" onClick={() => void restore()}>
                    Restore this version
                  </Btn>
                  <span className="text-[11px] text-[#6D6E71]">
                    Restoring keeps today’s state in history too — nothing is lost.
                  </span>
                </div>
              </>
            ) : (
              <p className="text-[13px] text-[#6D6E71]">Select a version to preview it.</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
