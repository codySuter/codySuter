import { useEffect, useState } from 'react';
import { api, type BackupEntry } from '../api';
import { runImport } from '../App';
import { useStore } from '../store';
import { Btn, Modal } from './ui';

function stamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// The app writes a rotating automatic backup of the whole library on
// every quit. This panel restores one — replacing the current library
// after taking one more safety backup of it.
export function BackupRestore({ onClose }: { onClose: () => void }) {
  const toLibrary = useStore((s) => s.toLibrary);
  const setStatus = useStore((s) => s.setStatus);
  const [backups, setBackups] = useState<BackupEntry[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.listBackups().then(setBackups);
  }, []);

  const restore = async (file: string) => {
    setBusy(true);
    const r = await api.restoreBackup(file);
    setBusy(false);
    if (r.ok) {
      onClose();
      await toLibrary();
      setStatus(`Library restored — ${r.count ?? 0} documents.`);
    } else {
      setStatus(`Restore failed: ${r.error ?? 'unknown error'}`);
    }
  };

  return (
    <Modal title="Restore from backup" onClose={onClose}>
      {backups === null ? (
        <p className="text-[13px] text-[#6D6E71]">Loading…</p>
      ) : backups.length === 0 ? (
        <p className="text-[13px] text-[#6D6E71]">
          No automatic backups yet — one is written every time the app quits. You can also
          restore from a backup file you exported.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5" data-testid="backup-list">
          {backups.map((b) => (
            <li
              key={b.file}
              className="flex items-center justify-between rounded-[6px] border border-[#E1E3E6] px-3 py-2"
            >
              <div>
                <div className="text-[12.5px] font-semibold text-[#15181D]">{stamp(b.ts)}</div>
                <div className="text-[11px] text-[#6D6E71]">
                  {b.count} document{b.count === 1 ? '' : 's'}
                </div>
              </div>
              {confirming === b.file ? (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-[#C8102E]">
                    Replace the whole library?
                  </span>
                  <Btn variant="primary" disabled={busy} onClick={() => void restore(b.file)}>
                    Restore
                  </Btn>
                  <Btn onClick={() => setConfirming(null)}>Cancel</Btn>
                </div>
              ) : (
                <Btn onClick={() => setConfirming(b.file)}>Restore…</Btn>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 border-t border-[#E1E3E6] pt-3">
        <Btn
          onClick={() => {
            onClose();
            void runImport();
          }}
        >
          Import a backup file instead…
        </Btn>
        <p className="mt-2 text-[11px] text-[#8A9099]">
          Restoring replaces the library, but a safety backup of its current state is taken
          first. Importing a file adds its documents without replacing anything.
        </p>
      </div>
    </Modal>
  );
}
