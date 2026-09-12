// Unit tests for the multi-PC sync merge (electron/syncMerge.cjs) — the
// same semantics Ace Sign Studio's batch sync proved out: newest wins,
// tombstones block resurrection, edits after a delete win, expired
// tombstones fall out, and the merge is idempotent.
//   node scripts/sync-merge-test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mergeSyncDoc, TOMBSTONE_KEEP_MS } = require('../electron/syncMerge.cjs');

const NOW = 1_800_000_000_000; // fixed clock keeps the tests deterministic
// Small offsets map to recent timestamps — a raw "200" would read as 1970
// and trip the (correct) 60-day tombstone expiry.
const at = (offset) => NOW - 1_000_000 + offset;
const doc = (id, offset, title = id) => ({ id, title, blocks: [], updatedAt: at(offset) });
const tomb = (id, offset) => ({ id, deletedAt: at(offset) });
const tpl = (id, offset) => ({ id, name: id, savedAt: at(offset), doc: doc(`${id}-doc`, offset) });
const local = (documents = {}, templates = {}) => ({ documents, templates });

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

check('first push: no remote file yet → everything local goes up', () => {
  const r = mergeSyncDoc(local({ a: doc('a', 100) }), null, 'pc1', NOW);
  assert.equal(r.changedRemote, true);
  assert.equal(r.changedLocal, false);
  assert.deepEqual(Object.keys(r.merged.documents), ['a']);
  assert.equal(r.merged.by, 'pc1');
});

check('remote-only document is adopted locally', () => {
  const r = mergeSyncDoc(local(), { documents: { b: doc('b', 200) } }, 'pc1', NOW);
  assert.equal(r.changedLocal, true);
  assert.deepEqual(r.docWrites.map((d) => d.id), ['b']);
  assert.equal(r.docDeletes.length, 0);
});

check('newest edit wins in both directions', () => {
  const r = mergeSyncDoc(
    local({ a: doc('a', 300, 'newer-local'), b: doc('b', 100, 'older-local') }),
    { documents: { a: doc('a', 100, 'older-remote'), b: doc('b', 300, 'newer-remote') } },
    'pc1',
    NOW,
  );
  assert.equal(r.merged.documents.a.title, 'newer-local');
  assert.equal(r.merged.documents.b.title, 'newer-remote');
  assert.equal(r.changedRemote, true);
  assert.deepEqual(r.docWrites.map((d) => d.id), ['b']);
});

check('a newer remote tombstone deletes the local document', () => {
  const r = mergeSyncDoc(
    local({ a: doc('a', 100) }),
    { documents: { a: tomb('a', 200) } },
    'pc1',
    NOW,
  );
  assert.deepEqual(r.docDeletes, ['a']);
  assert.equal(r.docWrites.length, 0);
  assert.equal(r.merged.documents.a.deletedAt, at(200));
});

check("a stale remote copy can't resurrect a locally deleted document", () => {
  const r = mergeSyncDoc(
    local({ a: tomb('a', 300) }),
    { documents: { a: doc('a', 100) } },
    'pc1',
    NOW,
  );
  assert.equal(r.merged.documents.a.deletedAt, at(300));
  assert.equal(r.docWrites.length, 0);
  assert.equal(r.changedRemote, true); // the tombstone must go up
});

check('an edit (or Undo) after a remote delete deliberately resurrects', () => {
  const r = mergeSyncDoc(
    local({ a: doc('a', 400, 'restored') }),
    { documents: { a: tomb('a', 300) } },
    'pc1',
    NOW,
  );
  assert.equal(r.merged.documents.a.title, 'restored');
  assert.equal(r.docDeletes.length, 0);
  assert.equal(r.changedRemote, true);
});

check('expired tombstones fall out of the merged doc', () => {
  const dead = { id: 'a', deletedAt: NOW - TOMBSTONE_KEEP_MS - 1000 };
  const r = mergeSyncDoc(
    local(),
    { documents: { a: dead, b: doc('b', 500) } },
    'pc1',
    NOW,
  );
  assert.equal('a' in r.merged.documents, false);
  assert.equal('b' in r.merged.documents, true);
  assert.equal(r.changedRemote, true); // dropping the dead key rewrites remote
});

check('merge is idempotent: a second round changes nothing', () => {
  const first = mergeSyncDoc(
    local({ a: doc('a', 300) }, { t1: tpl('t1', 200) }),
    { documents: { a: doc('a', 100), b: tomb('b', 900) }, templates: {} },
    'pc1',
    NOW,
  );
  // Converged local state: the merged docs/tombstones ARE the local state.
  const again = mergeSyncDoc(
    local({ ...first.merged.documents }, { ...first.merged.templates }),
    first.merged,
    'pc1',
    NOW,
  );
  assert.equal(again.changedLocal, false);
  assert.equal(again.changedRemote, false);
});

check('templates share the same semantics (newest wins, tombstones hold)', () => {
  const r = mergeSyncDoc(
    local({}, { t1: tpl('t1', 100), t2: tomb('t2', 400) }),
    { templates: { t1: tpl('t1', 300), t2: { ...tpl('t2', 200) } } },
    'pc1',
    NOW,
  );
  assert.equal(r.merged.templates.t1.savedAt, at(300));
  assert.deepEqual(r.tplWrites.map((t) => t.id), ['t1']);
  assert.equal(r.merged.templates.t2.deletedAt, at(400));
  assert.equal(r.tplDeletes.length, 0); // nothing local to delete
});

check('two computers with disjoint documents end up with the union', () => {
  const r = mergeSyncDoc(
    local({ a: doc('a', 100) }),
    { documents: { b: doc('b', 200) } },
    'pc1',
    NOW,
  );
  assert.deepEqual(Object.keys(r.merged.documents).sort(), ['a', 'b']);
  assert.deepEqual(r.docWrites.map((d) => d.id), ['b']);
  assert.equal(r.changedRemote, true);
});

console.log(`SYNC MERGE OK — ${passed} checks passed`);
