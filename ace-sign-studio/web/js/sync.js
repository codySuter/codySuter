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

  // One get→merge→put cycle; sync() wraps it with the busy guard.
  async _cycle(attempt) {
      const got = await this.call({ op: "get" });
      if (got.ok === false) throw new Error(got.error || "sync failed");
      const { changedLocal, changedRemote, merged } = mergeSyncDoc(got.missing ? null : got.doc);
      if (changedLocal) {
        persistState();
        syncRefreshUI();
        showToast("Synced updates from another computer.");
      }
      if (changedRemote || got.missing) {
        const put = await this.call({ op: "put", sha: got.sha || "", doc: await shrinkSyncDoc(merged) });
        if (put.ok === false) throw new Error(put.error || "sync write failed");
        if (put.conflict) {
          // another PC wrote between our get and put — merge theirs in too.
          // One retry, inside this same invocation: recursing after clearing
          // _busy would let a poll tick start a second concurrent sync()
          // while the retry is mid-flight.
          if (!attempt) return await this._cycle(1);
          return; // twice in a row: let the next poll settle it
        }
      }
      this.lastSync = new Date();
      this.lastError = null;
  },

  async sync() {
    if (!this.enabled() || this._busy) return;
    this._busy = true;
    try {
      await this._cycle(0);
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
   history. Runs fine against null (no remote file yet).

   Batch semantics: a full save (or delete) is wholesale-authoritative —
   newest savedAt/deletedAt wins the whole value. Appends are finer-grained:
   items carry an addedAt stamp and do NOT bump savedAt, and the merge
   rescues the losing side's items that were appended after the winning
   side's last full save. That way two computers appending to the same batch
   in the same sync window both keep their signs, while a stale copy can
   never resurrect items that a newer full save deliberately removed. */
function mergeSyncDoc(remote) {
  let changedLocal = false, changedRemote = false;

  // ---- batches: per-name newest-wins + append rescue, tombstones included ----
  const stampOf = (b) => Math.max(Date.parse((b && b.savedAt) || 0) || 0, Date.parse((b && b.deletedAt) || 0) || 0);
  const tombCutoff = Date.now() - 60 * 86400000;
  const isDeadTombstone = (b) => b && !b.items && (Date.parse(b.deletedAt || 0) || 0) < tombCutoff;
  const rb = (remote && remote.batches && typeof remote.batches === "object") ? remote.batches : {};
  const lb = Batches.data;
  const mergedB = {};
  for (const n of new Set([...Object.keys(lb), ...Object.keys(rb)])) {
    const l = lb[n], r = rb[n];
    let winner;
    if (!r) { winner = l; changedRemote = true; }
    else if (!l) { winner = r; changedLocal = true; }
    else {
      const newer = stampOf(l) >= stampOf(r) ? l : r;
      const older = newer === l ? r : l;
      winner = newer;
      if (newer.items && older.items) {
        // Rescue the older side's genuinely-new appends. addedAt of an item
        // the newer save could have seen is ≤ its savedAt, so this can only
        // pick up appends the newer side never knew about.
        const have = new Set(newer.items.map((q) => q && q.uid));
        const saveStamp = Date.parse(newer.savedAt || 0) || 0;
        const rescued = older.items.filter((q) =>
          q && q.uid && !have.has(q.uid) && (Date.parse(q.addedAt || 0) || 0) > saveStamp);
        if (rescued.length) winner = Object.assign({}, newer, { items: newer.items.concat(rescued) });
      }
      const uidsOf = (b) => (b.items || []).map((q) => q && q.uid).join("\n");
      if (stampOf(l) > stampOf(r) || uidsOf(winner) !== uidsOf(r)) changedRemote = true;
      if (stampOf(r) > stampOf(l) || uidsOf(winner) !== uidsOf(l)) changedLocal = true;
    }
    // Expired tombstones fall out of the doc here — without this, the local
    // 60-day prune is undone by the next merge and the sync doc accumulates
    // one dead key per deleted batch name forever.
    if (isDeadTombstone(winner)) {
      if (r) changedRemote = true;
      continue;
    }
    mergedB[n] = winner;
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

/* ---------- keep the pushed doc under GitHub's 1MB contents limit ----------
   Custom photos live inside specs as data URIs (~200-400KB each after the
   editor's downscale); a few of them would push the sync file past the
   Contents API's 1MB ceiling and break every computer's sync reads. The
   pushed copy re-encodes big data-URI photos to ~700px (fine for store
   signage print) and, if the doc is somehow still too big, drops history
   photos first and batch photos as a last resort. Local state is never
   touched — this PC keeps its full-resolution originals. */
const SYNC_DOC_BUDGET = 900000; // bytes, safety margin under GitHub's 1MB
const SYNC_IMG_THRESHOLD = 80000;
const _syncImgCache = new Map(); // original data URI -> shrunken data URI

async function shrinkSyncDoc(doc) {
  const out = JSON.parse(JSON.stringify(doc));
  const eachSpec = (fn) => {
    for (const n of Object.keys(out.batches || {})) {
      for (const q of (out.batches[n] && out.batches[n].items) || []) fn(q.spec, "batch");
    }
    for (const h of out.history || []) {
      for (const q of h.items || []) fn(q.spec, "history");
    }
  };
  const big = [];
  eachSpec((spec) => {
    if (spec && typeof spec.image === "string" && spec.image.startsWith("data:") && spec.image.length > SYNC_IMG_THRESHOLD) {
      big.push(spec);
    }
  });
  for (const spec of big) {
    let small = _syncImgCache.get(spec.image);
    if (!small) {
      try { small = await downscaleDataURL(spec.image, 700, 0.8); } catch (e) { small = spec.image; }
      _syncImgCache.set(spec.image, small);
    }
    if (small && small.length < spec.image.length) spec.image = small;
  }
  if (JSON.stringify(out).length > SYNC_DOC_BUDGET) {
    eachSpec((spec, where) => {
      if (where === "history" && spec && typeof spec.image === "string" && spec.image.startsWith("data:")) spec.image = null;
    });
  }
  if (JSON.stringify(out).length > SYNC_DOC_BUDGET) {
    eachSpec((spec) => {
      if (spec && typeof spec.image === "string" && spec.image.startsWith("data:")) spec.image = null;
    });
  }
  return out;
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
