/* ============================================================
   Multi-PC sync via a private GitHub repo.

   Every computer points Settings → Sync at the same private repo with a
   fine-grained token (Contents read/write on that repo only). What syncs:
   saved batches and print history. The live queue stays per-computer —
   hand a queue to another PC by saving it as a batch.

   The merge is convergent, so PCs can write in any order:
   - batches merge per name by newest timestamp, and deletions carry a
     tombstone ({deletedAt}) so a deleted batch can't be resurrected by
     another PC's older copy;
   - history entries merge as a union keyed by uid, newest first, capped.

   Writes go through GitHub's sha-guarded PUT (compare-and-swap): when two
   PCs race, the loser gets conflict:true, re-pulls, re-merges, retries.
   ============================================================ */
"use strict";

const Sync = {
  POLL_MS: 20000,
  lastSync: null,   // Date of last successful round
  lastError: null,  // user-facing string, or null
  _timer: null,
  _rq: null,
  _busy: false,

  cfg() {
    const s = Settings.get();
    // a blank token is fine — release builds carry the store token and
    // the backend substitutes it server-side
    return { repo: String(s.syncRepo || "").trim(), token: String(s.syncToken || "").trim() };
  },
  enabled() {
    return !!Settings.get().syncOn && !!this.cfg().repo;
  },

  /* (Re)start polling — call at boot and whenever Settings change. */
  start() {
    clearInterval(this._timer);
    this._timer = null;
    if (!this.enabled()) { this.lastSync = null; this.lastError = null; return; }
    this._timer = setInterval(() => this.sync(), this.POLL_MS);
    this.sync();
  },

  /* Nudge a sync soon (after local changes) without spamming GitHub. */
  request() {
    if (!this.enabled()) return;
    clearTimeout(this._rq);
    this._rq = setTimeout(() => this.sync(), 2000);
  },

  async call(payload) {
    const c = this.cfg();
    const resp = await fetch("/api/sync/github", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ repo: c.repo, token: c.token, by: Settings.get().syncName || "" }, payload)),
    });
    if (!resp.ok) throw new Error(`sync failed (${resp.status})`);
    return resp.json();
  },

  async sync(attempt) {
    if (!this.enabled() || this._busy) return;
    this._busy = true;
    try {
      const got = await this.call({ op: "get" });
      if (got.ok === false) throw new Error(got.error || "sync failed");
      const { changedLocal, changedRemote, merged } = mergeSyncDoc(got.missing ? null : got.doc);
      if (changedLocal) {
        persistState();
        syncRefreshUI();
        showToast("Synced updates from another computer.");
      }
      if (changedRemote || got.missing) {
        const put = await this.call({ op: "put", sha: got.sha || "", doc: merged });
        if (put.ok === false) throw new Error(put.error || "sync write failed");
        if (put.conflict) {
          // another PC wrote between our get and put — merge theirs in too
          this._busy = false;
          if (!attempt) return this.sync(1);
          return; // twice in a row: let the next poll settle it
        }
      }
      this.lastSync = new Date();
      this.lastError = null;
    } catch (e) {
      this.lastError = friendlyError(e);
    } finally {
      this._busy = false;
      syncStatusUI();
    }
  },
};

/* Merge the remote doc into local Batches/History (in place) and report
   which sides changed. Timestamps decide per batch name; uids dedupe
   history. Runs fine against null (no remote file yet). */
function mergeSyncDoc(remote) {
  let changedLocal = false, changedRemote = false;

  // ---- batches: per-name newest-wins, tombstones included ----
  const stampOf = (b) => Math.max(Date.parse((b && b.savedAt) || 0) || 0, Date.parse((b && b.deletedAt) || 0) || 0);
  const rb = (remote && remote.batches && typeof remote.batches === "object") ? remote.batches : {};
  const lb = Batches.data;
  const mergedB = {};
  for (const n of new Set([...Object.keys(lb), ...Object.keys(rb)])) {
    const l = lb[n], r = rb[n];
    if (!r) { mergedB[n] = l; changedRemote = true; continue; }
    if (!l) { mergedB[n] = r; changedLocal = true; continue; }
    if (stampOf(l) === stampOf(r)) { mergedB[n] = l; continue; }
    if (stampOf(l) > stampOf(r)) { mergedB[n] = l; changedRemote = true; }
    else { mergedB[n] = r; changedLocal = true; }
  }
  Batches.data = mergedB;

  // ---- history: union by uid, newest first, capped ----
  const rh = Array.isArray(remote && remote.history) ? remote.history.filter((h) => h && h.uid) : [];
  const lh = History.data.filter((h) => h && h.uid);
  const localUids = new Set(lh.map((h) => h.uid));
  const remoteUids = new Set(rh.map((h) => h.uid));
  const mergedH = lh.concat(rh.filter((h) => !localUids.has(h.uid)))
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
    .slice(0, History.MAX);
  if (mergedH.some((h) => !localUids.has(h.uid))) changedLocal = true;
  if (mergedH.some((h) => !remoteUids.has(h.uid))) changedRemote = true;
  History.data = mergedH;

  return {
    changedLocal,
    changedRemote,
    merged: {
      v: 1,
      batches: mergedB,
      history: mergedH,
      updatedAt: new Date().toISOString(),
      by: String(Settings.get().syncName || "").trim(),
    },
  };
}

/* Refresh whatever synced data is currently on screen. */
function syncRefreshUI() {
  if (typeof renderBatchList === "function" && $("#batchModal") && $("#batchModal").classList.contains("show")) renderBatchList();
  if (typeof renderHistoryList === "function" && $("#historyModal") && $("#historyModal").classList.contains("show")) renderHistoryList();
}

/* Status line inside Settings (only present while the modal is open). */
function syncStatusText() {
  if (!Sync.enabled()) return "Off — tick the box above to share batches and print history with the other store computers.";
  if (Sync.lastError) return "⚠ " + Sync.lastError;
  if (Sync.lastSync) {
    const mins = Math.round((Date.now() - Sync.lastSync.getTime()) / 60000);
    return mins < 1 ? "✓ Synced just now" : `✓ Synced ${mins} minute${mins === 1 ? "" : "s"} ago`;
  }
  return "Connecting…";
}
function syncStatusUI() {
  const elx = $("#syncStatus");
  if (elx) elx.textContent = syncStatusText();
}
