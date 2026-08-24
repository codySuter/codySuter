import { useEffect, useState } from 'react';
import { api, type SyncStatus } from '../api';
import { Btn, Field, Modal, inputCls } from './ui';

export function syncStatusText(s: SyncStatus | null): string {
  if (!s || !s.supported) return 'Multi-PC sync is available in the desktop app.';
  if (!s.enabled) return 'Off — turn it on to share the library with the other store computers.';
  if (s.lastError) return `⚠ ${s.lastError}`;
  if (s.lastSyncAt) {
    const mins = Math.round((Date.now() - s.lastSyncAt) / 60000);
    return mins < 1 ? '✓ Synced just now' : `✓ Synced ${mins} minute${mins === 1 ? '' : 's'} ago`;
  }
  return 'Connecting…';
}

// Multi-PC sync setup — the same model as Ace Sign Studio: every computer
// points at the same private GitHub repo with a fine-grained token, and
// the library + saved templates stay merged across all of them.
export function SyncSettings({ onClose }: { onClose: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [supported, setSupported] = useState(true);
  const [hasBuiltin, setHasBuiltin] = useState(false);
  const [on, setOn] = useState(false);
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void api.syncGetSettings().then((s) => {
      if (!s) {
        setSupported(false);
      } else {
        setOn(s.on);
        setRepo(s.repo);
        setToken(s.token);
        setName(s.name);
        setHasBuiltin(!!s.hasBuiltin);
      }
      setLoaded(true);
    });
  }, []);

  // Live status line while the dialog is open.
  useEffect(() => {
    if (!supported) return;
    let dead = false;
    const tick = () => void api.syncStatus().then((s) => !dead && setStatus(s));
    tick();
    const timer = setInterval(tick, 2000);
    const off = api.onSync(() => tick());
    return () => {
      dead = true;
      clearInterval(timer);
      off();
    };
  }, [supported]);

  const save = async () => {
    setSaveError(null);
    setSaved(false);
    const r = await api.syncSetSettings({ on, repo: repo.trim(), token: token.trim(), name: name.trim() });
    if (!r.ok) {
      setSaveError(r.error ?? 'Could not save the sync settings.');
      if (r.error?.includes('owner/repo')) setOn(false);
    } else {
      setSaved(true);
    }
  };

  return (
    <Modal title="Sync between store computers" onClose={onClose}>
      {!loaded ? (
        <p className="text-[13px] text-[#6D6E71]">Loading…</p>
      ) : !supported ? (
        <p className="text-[13px] text-[#6D6E71]">
          Multi-PC sync runs in the desktop app — it isn't available in the browser build.
        </p>
      ) : (
        <>
          <p className="mb-3 text-[12.5px] leading-relaxed text-[#4A4F57]">
            Every computer that points at the same private GitHub repo shares one library:
            documents and saved templates merge automatically (newest edit wins, deletions
            carry over). Version history and the trash stay on each computer.
          </p>
          <label className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-[#20242B]">
            <input
              type="checkbox"
              data-testid="sync-on"
              checked={on}
              onChange={(e) => setOn(e.target.checked)}
            />
            Share this library with the other store computers
          </label>
          <Field label="Sync repo (owner/repo — a private repo you own)">
            <input
              data-testid="sync-repo"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="codysuter/ace-document-sync"
              className={inputCls}
            />
          </Field>
          <Field
            label={
              hasBuiltin
                ? 'Fine-grained token — leave blank to use the built-in store token'
                : 'Fine-grained token — Contents read & write on that repo only'
            }
          >
            <input
              data-testid="sync-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={hasBuiltin ? 'Built-in store token (leave blank)' : 'github_pat_…'}
              className={inputCls}
            />
          </Field>
          <Field label="This computer's name (shows in sync history)">
            <input
              data-testid="sync-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Front register"
              className={inputCls}
            />
          </Field>
          <p className="mb-3 text-[11px] leading-relaxed text-[#8A9099]">
            {hasBuiltin
              ? 'This build carries the store token — tick the box, Save, and you’re done. Paste a token only to override it.'
              : 'The token stays on this computer and is sent only to api.github.com. It is never included in backups or exported documents. Create one at GitHub → Settings → Developer settings → Fine-grained tokens, limited to the sync repo with “Contents” read & write.'}
          </p>
          <div className="flex items-center gap-2">
            <Btn variant="primary" data-testid="sync-save" onClick={() => void save()}>
              Save
            </Btn>
            {status?.enabled && (
              <Btn onClick={() => void api.syncNow()} disabled={status.busy}>
                Sync now
              </Btn>
            )}
            <span className="text-[12px] text-[#4A4F57]" data-testid="sync-status-text">
              {saveError ? `⚠ ${saveError}` : saved ? 'Saved.' : ''}
            </span>
          </div>
          <div className="mt-3 border-t border-[#E1E3E6] pt-2.5 text-[12px] text-[#4A4F57]">
            {syncStatusText(status)}
          </div>
        </>
      )}
    </Modal>
  );
}
