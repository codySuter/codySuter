// Convergent merge for multi-PC library sync — same semantics as Ace Sign
// Studio's batch sync, adapted to documents and templates:
//
// - entries merge per id by newest timestamp, whole-value (a document is
//   edited as a unit; there is no partial merge);
// - deletions carry a tombstone ({ id, deletedAt }) so a deleted document
//   can't be resurrected by another PC's older copy — while an edit or an
//   Undo AFTER the delete (newer stamp) deliberately brings it back;
// - tombstones expire after 60 days and fall out of the merged doc, so the
//   sync file doesn't accumulate one dead key per deletion forever.
//
// Pure functions, no Electron imports — unit-tested by
// scripts/sync-merge-test.mjs and shared with electron/sync.cjs.
'use strict';

const TOMBSTONE_KEEP_MS = 60 * 24 * 60 * 60 * 1000;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Date.parse(v) || 0);

/** A tombstone marks a deletion: it has deletedAt and no content. */
function isTombstone(entry) {
  return !!entry && entry.deletedAt != null && !entry.blocks && !entry.doc;
}

/** Newest activity on an entry — an edit or a deletion, whichever is later. */
function stampOf(entry) {
  if (!entry) return 0;
  return Math.max(num(entry.updatedAt), num(entry.savedAt), num(entry.deletedAt));
}

function isDeadTombstone(entry, now) {
  return isTombstone(entry) && num(entry.deletedAt) < now - TOMBSTONE_KEEP_MS;
}

/**
 * Merge one keyed entry map (documents or templates). Local and remote map
 * ids to either a full entry or a tombstone. Returns the merged map plus
 * what each side has to do to converge:
 * - localWrites: full entries this PC must adopt (write to disk)
 * - localDeletes: ids this PC must delete (a newer tombstone won)
 * - changedRemote: the merged map differs from what the remote held
 */
function mergeEntryMaps(local, remote, now = Date.now()) {
  const l = local && typeof local === 'object' ? local : {};
  const r = remote && typeof remote === 'object' ? remote : {};
  const merged = {};
  const localWrites = [];
  const localDeletes = [];
  let changedRemote = false;

  for (const id of new Set([...Object.keys(l), ...Object.keys(r)])) {
    const le = l[id];
    const re = r[id];
    let winner;
    if (!re) {
      winner = le;
      changedRemote = true;
    } else if (!le) {
      winner = re;
      if (isTombstone(re)) {
        // Nothing local to delete — just remember the tombstone.
      } else {
        localWrites.push(re);
      }
    } else {
      winner = stampOf(le) >= stampOf(re) ? le : re;
      if (stampOf(le) > stampOf(re)) changedRemote = true;
      if (stampOf(re) > stampOf(le)) {
        if (isTombstone(re)) {
          if (!isTombstone(le)) localDeletes.push(id);
        } else {
          localWrites.push(re);
        }
      }
    }
    // Expired tombstones fall out of the merged doc entirely.
    if (isDeadTombstone(winner, now)) {
      if (re) changedRemote = true;
      continue;
    }
    merged[id] = winner;
  }
  return { merged, localWrites, localDeletes, changedRemote };
}

/**
 * Merge the whole sync doc. `local` holds this PC's current state as entry
 * maps (documents/templates including its own tombstones); `remote` is the
 * parsed sync file, or null when the repo has none yet.
 */
function mergeSyncDoc(local, remote, by, now = Date.now()) {
  const docs = mergeEntryMaps(local.documents, remote && remote.documents, now);
  const tpls = mergeEntryMaps(local.templates, remote && remote.templates, now);
  return {
    merged: {
      v: 1,
      documents: docs.merged,
      templates: tpls.merged,
      updatedAt: new Date(now).toISOString(),
      by: String(by || '').trim(),
    },
    changedRemote: !remote || docs.changedRemote || tpls.changedRemote,
    changedLocal:
      docs.localWrites.length > 0 ||
      docs.localDeletes.length > 0 ||
      tpls.localWrites.length > 0 ||
      tpls.localDeletes.length > 0,
    docWrites: docs.localWrites,
    docDeletes: docs.localDeletes,
    tplWrites: tpls.localWrites,
    tplDeletes: tpls.localDeletes,
  };
}

module.exports = {
  TOMBSTONE_KEEP_MS,
  isTombstone,
  stampOf,
  isDeadTombstone,
  mergeEntryMaps,
  mergeSyncDoc,
};
