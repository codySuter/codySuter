// Multi-PC library sync via a private GitHub repo — the same design as
// Ace Sign Studio's batch sync, run from the Electron main process (which
// plays the role Sign Studio's local Go server plays: it owns the token
// and is the only thing that ever talks to api.github.com).
//
// Every computer points File → Sync Settings at the same private repo
// with a fine-grained token (Contents read/write on that repo only).
// What syncs: the document library and saved templates. Version history,
// the trash, and app settings stay per-computer.
//
// Each round is get → merge → sha-guarded put. GitHub's sha-guarded PUT
// gives compare-and-swap: when two PCs write at once, the loser sees a
// conflict, re-pulls, re-merges, and retries once. The merge itself is
// convergent (electron/syncMerge.cjs): newest timestamp wins per document,
// deletions carry 60-day tombstones.
'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { mergeSyncDoc, isTombstone, stampOf, TOMBSTONE_KEEP_MS } = require('./syncMerge.cjs');

const POLL_MS = 20000;
const NUDGE_MS = 2000;
const SYNC_FILE = 'acedocumentstudio-sync.json';
const DEFAULT_REPO = 'codysuter/ace-document-sync';
const GITHUB_API = 'https://api.github.com';
// GitHub's Contents API refuses files over 1MB; stay well under it by
// shrinking big in-document images in the PUSHED copy only — this PC's
// local files keep their full-resolution originals.
const DOC_BUDGET = 900000;
const IMG_THRESHOLD = 80000;

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function repoLooksValid(repo) {
  if (!REPO_RE.test(repo)) return false;
  const [owner, name] = repo.split('/');
  return owner !== '.' && owner !== '..' && name !== '.' && name !== '..';
}

function createSync(deps) {
  const {
    nativeImage,
    userDataDir,
    getSettings, // () => settings object (mutable)
    saveSettings, // () => void
    docsDir, // () => path
    templatesDir, // () => path
    readAllDocsSync, // () => StudioDoc[]
    readJsonSafe, // (file) => parsed | null
    writeJsonAtomic, // async (file, data)
    moveDocToTrash, // async (id) => void
    maybeSnapshot, // (id, force?) => void — history snapshot before overwrite
    safeId, // (id) => sanitized id
    notify, // (payload) => void — 'sync' event to the renderer
  } = deps;

  const state = {
    timer: null,
    nudge: null,
    busy: false,
    lastSyncAt: null, // epoch ms of last successful round
    lastError: null, // user-facing string, or null
  };
  const imgCache = new Map(); // original data URI -> shrunken data URI

  // Release builds carry the store's token (CI writes builtin-sync.json
  // next to this file before packaging — never committed to the repo), so
  // the registers can leave the token box blank. A pasted token wins.
  const builtin = (() => {
    const b = readJsonSafe(path.join(__dirname, 'builtin-sync.json'));
    if (!b || typeof b.token !== 'string' || !b.token.trim()) return null;
    return {
      token: b.token.trim(),
      repo: typeof b.repo === 'string' ? b.repo.trim() : '',
    };
  })();

  // ---- settings ----

  const cfg = () => {
    const s = getSettings();
    return {
      on: !!s.syncOn,
      repo: String(s.syncRepo || '').trim() || (builtin && builtin.repo) || DEFAULT_REPO,
      token: String(s.syncToken || '').trim() || (builtin ? builtin.token : ''),
      name: String(s.syncName || '').trim() || os.hostname(),
    };
  };
  const enabled = () => {
    const c = cfg();
    return c.on && repoLooksValid(c.repo) && c.token !== '';
  };

  // ---- local tombstones (deletions made on this PC, kept 60 days) ----

  const tombFile = () => path.join(userDataDir, 'sync-tombstones.json');

  function readTombs() {
    const t = readJsonSafe(tombFile());
    const ok = t && typeof t === 'object';
    return {
      documents: ok && t.documents && typeof t.documents === 'object' ? t.documents : {},
      templates: ok && t.templates && typeof t.templates === 'object' ? t.templates : {},
    };
  }

  function writeTombs(tombs) {
    const cutoff = Date.now() - TOMBSTONE_KEEP_MS;
    for (const kind of ['documents', 'templates']) {
      for (const id of Object.keys(tombs[kind])) {
        if (tombs[kind][id] < cutoff) delete tombs[kind][id];
      }
    }
    try {
      fs.writeFileSync(tombFile(), JSON.stringify(tombs, null, 2), 'utf8');
    } catch {
      // Tombstones are best-effort; a failed write only risks a
      // resurrected document, never data loss.
    }
  }

  function recordDelete(kind, id) {
    const tombs = readTombs();
    tombs[kind][String(id)] = Date.now();
    writeTombs(tombs);
    request();
  }

  // ---- local state as sync entry maps ----

  function readAllTemplates() {
    const out = [];
    try {
      for (const f of fs.readdirSync(templatesDir())) {
        if (!f.endsWith('.json')) continue;
        const t = readJsonSafe(path.join(templatesDir(), f));
        if (t && typeof t.id === 'string' && t.doc) out.push(t);
      }
    } catch {
      // Missing dir — nothing saved yet.
    }
    return out;
  }

  function buildLocal() {
    const tombs = readTombs();
    const documents = {};
    for (const doc of readAllDocsSync()) {
      if (doc && typeof doc.id === 'string') documents[doc.id] = doc;
    }
    for (const [id, deletedAt] of Object.entries(tombs.documents)) {
      if (!documents[id] || stampOf(documents[id]) < deletedAt) {
        documents[id] = { id, deletedAt };
      }
    }
    const templates = {};
    for (const t of readAllTemplates()) templates[t.id] = t;
    for (const [id, deletedAt] of Object.entries(tombs.templates)) {
      if (!templates[id] || stampOf(templates[id]) < deletedAt) {
        templates[id] = { id, deletedAt };
      }
    }
    return { documents, templates };
  }

  // ---- apply what the merge says this PC must adopt ----

  async function applyLocal(result) {
    let applied = 0;
    for (const doc of result.docWrites) {
      const id = safeId(doc.id);
      if (!id || !Array.isArray(doc.blocks)) continue;
      // The state being replaced goes into this PC's history first.
      maybeSnapshot(id, true);
      await writeJsonAtomic(path.join(docsDir(), `${id}.json`), doc);
      applied++;
    }
    for (const id of result.docDeletes) {
      await moveDocToTrash(id);
      applied++;
    }
    for (const tpl of result.tplWrites) {
      const id = safeId(tpl.id);
      if (!id || !tpl.doc) continue;
      await writeJsonAtomic(path.join(templatesDir(), `${id}.json`), tpl);
      applied++;
    }
    for (const id of result.tplDeletes) {
      try {
        fs.rmSync(path.join(templatesDir(), `${safeId(id)}.json`), { force: true });
        applied++;
      } catch {
        // Already gone.
      }
    }
    return applied;
  }

  // The merged doc's tombstones become this PC's tombstones too, so a
  // deletion learned from another computer survives the next merge even
  // if the remote file is recreated.
  function persistMergedTombstones(merged) {
    const tombs = { documents: {}, templates: {} };
    for (const [kind, map] of [
      ['documents', merged.documents],
      ['templates', merged.templates],
    ]) {
      for (const [id, entry] of Object.entries(map)) {
        if (isTombstone(entry)) {
          const t = entry.deletedAt;
          tombs[kind][id] = typeof t === 'number' ? t : Date.parse(t) || Date.now();
        }
      }
    }
    writeTombs(tombs);
  }

  // ---- GitHub Contents API ----

  async function gh(method, url, token, payload) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    return { status: res.status, text };
  }

  const authError = (status) => {
    if (status === 401) return 'GitHub rejected the token — paste it again (it may have expired)';
    if (status === 403) return "the token doesn't have access — it needs Contents read & write on the sync repo";
    return null;
  };

  async function ghGet(c) {
    const url = `${GITHUB_API}/repos/${c.repo}/contents/${SYNC_FILE}`;
    let r;
    try {
      r = await gh('GET', url, c.token);
    } catch {
      throw new Error("can't reach GitHub — check the internet connection");
    }
    if (r.status === 404) {
      // An unreachable repo and a missing file both 404 — check the repo
      // itself so a typo'd name doesn't silently "sync" into nothing.
      try {
        const repo = await gh('GET', `${GITHUB_API}/repos/${c.repo}`, c.token);
        if (repo.status !== 200) {
          throw new Error(
            "GitHub can't find that repo with this token — check the owner/repo name and the token's repository access",
          );
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('GitHub')) throw e;
      }
      return { missing: true, sha: '' };
    }
    if (r.status === 403 && r.text.includes('too_large')) {
      throw new Error(
        "the sync data has outgrown GitHub's file limit — trim large images from shared documents",
      );
    }
    const auth = authError(r.status);
    if (auth) throw new Error(auth);
    if (r.status !== 200) throw new Error(`GitHub error (${r.status})`);
    let got;
    try {
      got = JSON.parse(r.text);
    } catch {
      throw new Error('unexpected GitHub response');
    }
    try {
      const raw = Buffer.from(String(got.content || '').replace(/\s/g, ''), 'base64').toString('utf8');
      const doc = JSON.parse(raw);
      return { missing: false, sha: got.sha || '', doc };
    } catch {
      // Unreadable sync file — treat as missing so the next write repairs it.
      return { missing: true, sha: got.sha || '' };
    }
  }

  async function ghPut(c, sha, doc) {
    const url = `${GITHUB_API}/repos/${c.repo}/contents/${SYNC_FILE}`;
    const payload = {
      message: `sync from ${c.name}`,
      content: Buffer.from(JSON.stringify(doc)).toString('base64'),
      ...(sha ? { sha } : {}),
    };
    let r;
    try {
      r = await gh('PUT', url, c.token, payload);
    } catch {
      throw new Error("can't reach GitHub — check the internet connection");
    }
    if (r.status === 200 || r.status === 201) return { conflict: false };
    // The sha raced another PC's write — re-pull, re-merge, retry.
    if (r.status === 409 || r.status === 422) return { conflict: true };
    const auth = authError(r.status);
    if (auth) throw new Error(auth);
    throw new Error(`GitHub error (${r.status})`);
  }

  // ---- keep the pushed doc under GitHub's 1MB contents limit ----

  function shrinkImage(src, width, quality) {
    let small = imgCache.get(src + width);
    if (small) return small;
    try {
      const img = nativeImage.createFromDataURL(src);
      if (img.isEmpty() || img.getSize().width <= width) {
        small = src;
      } else {
        small = `data:image/jpeg;base64,${img.resize({ width }).toJPEG(quality).toString('base64')}`;
        if (small.length >= src.length) small = src;
      }
    } catch {
      small = src;
    }
    imgCache.set(src + width, small);
    return small;
  }

  function shrinkPass(out, width, quality) {
    for (const entry of Object.values(out.documents)) {
      if (!entry || !Array.isArray(entry.blocks)) continue;
      for (const b of entry.blocks) {
        if (
          b &&
          b.type === 'image' &&
          typeof b.src === 'string' &&
          b.src.startsWith('data:') &&
          b.src.length > IMG_THRESHOLD
        ) {
          b.src = shrinkImage(b.src, width, quality);
        }
      }
    }
  }

  function shrinkForPush(merged) {
    const out = JSON.parse(JSON.stringify(merged));
    shrinkPass(out, 700, 80);
    if (JSON.stringify(out).length > DOC_BUDGET) shrinkPass(out, 450, 60);
    if (JSON.stringify(out).length > DOC_BUDGET) {
      throw new Error(
        "the shared library has outgrown GitHub's sync file limit — remove or shrink images in the largest documents",
      );
    }
    return out;
  }

  // ---- one get → merge → put round ----

  async function cycle(attempt) {
    const c = cfg();
    const got = await ghGet(c);
    const result = mergeSyncDoc(buildLocal(), got.missing ? null : got.doc, c.name);
    if (result.changedLocal) {
      const applied = await applyLocal(result);
      if (applied > 0) notify({ kind: 'remote-update', applied });
    }
    persistMergedTombstones(result.merged);
    if (result.changedRemote || got.missing) {
      const put = await ghPut(c, got.sha, shrinkForPush(result.merged));
      if (put.conflict) {
        // One retry inside this same invocation; twice in a row means the
        // next poll settles it.
        if (!attempt) return cycle(1);
        return;
      }
    }
    state.lastSyncAt = Date.now();
    state.lastError = null;
  }

  async function sync() {
    if (!enabled() || state.busy) return;
    state.busy = true;
    try {
      await cycle(0);
    } catch (e) {
      state.lastError = e instanceof Error ? e.message : String(e);
    } finally {
      state.busy = false;
      notify({ kind: 'status' });
    }
  }

  /* (Re)start polling — at boot and whenever settings change. */
  function start() {
    clearInterval(state.timer);
    state.timer = null;
    if (!enabled()) {
      state.lastSyncAt = null;
      state.lastError = null;
      notify({ kind: 'status' });
      return;
    }
    state.timer = setInterval(() => void sync(), POLL_MS);
    void sync();
  }

  /* Nudge a sync soon (after local changes) without spamming GitHub. */
  function request() {
    if (!enabled()) return;
    clearTimeout(state.nudge);
    state.nudge = setTimeout(() => void sync(), NUDGE_MS);
  }

  function status() {
    return {
      supported: true,
      enabled: enabled(),
      configured: cfg().token !== '',
      builtin: !!builtin,
      busy: state.busy,
      lastSyncAt: state.lastSyncAt,
      lastError: state.lastError,
    };
  }

  function getUISettings() {
    const s = getSettings();
    return {
      on: !!s.syncOn,
      repo: String(s.syncRepo || '').trim() || (builtin && builtin.repo) || DEFAULT_REPO,
      // Only the token pasted on THIS computer shows in the box; the
      // built-in store token never surfaces in the UI.
      token: String(s.syncToken || ''),
      name: String(s.syncName || '').trim() || os.hostname(),
      hasBuiltin: !!builtin,
    };
  }

  function setUISettings(next) {
    const s = getSettings();
    s.syncOn = !!next.on;
    s.syncRepo = String(next.repo || '').trim();
    s.syncToken = String(next.token || '').trim();
    s.syncName = String(next.name || '').trim();
    if (s.syncOn && !repoLooksValid(s.syncRepo || DEFAULT_REPO)) {
      s.syncOn = false;
      saveSettings();
      start();
      return { ok: false, error: 'the sync repo must look like owner/repo (e.g. codysuter/ace-document-sync)' };
    }
    saveSettings();
    start();
    return { ok: true };
  }

  return {
    start,
    request,
    sync,
    status,
    getUISettings,
    setUISettings,
    recordDocDelete: (id) => recordDelete('documents', id),
    recordTemplateDelete: (id) => recordDelete('templates', id),
  };
}

module.exports = { createSync, SYNC_FILE, DEFAULT_REPO };
