/**
 * Unit tests for the multi-computer sync merge (mergeSyncDoc in
 * web/js/sync.js). These semantics are load-bearing for stores running
 * several computers: concurrent appends must both survive, full saves must
 * stay wholesale-authoritative (no resurrection), and expired tombstones
 * must fall out of the doc. No browser needed.
 *
 * Usage: node e2e/unit-merge.mjs   (exit 1 on any failure)
 */
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const E2E = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(E2E, "..", "web", "js", "sync.js"), "utf8");

// Extract just mergeSyncDoc — the rest of sync.js touches fetch/DOM.
const start = src.indexOf("function mergeSyncDoc");
const end = src.indexOf("/* ---------- keep the pushed doc");
if (start < 0 || end < 0) { console.error("could not locate mergeSyncDoc in sync.js"); process.exit(1); }

globalThis.Batches = { data: {} };
globalThis.History = { data: [], MAX: 25 };
globalThis.Settings = { get: () => ({}) };
// eslint-disable-next-line no-eval
(0, eval)(src.slice(start, end));

let failures = 0;
const ok = (name, cond, extra) => {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${name}${!cond && extra ? ` — ${JSON.stringify(extra)}` : ""}`);
  if (!cond) { failures++; process.exitCode = 1; }
};
const uids = (b) => (b && b.items ? b.items.map((i) => i.uid).sort().join(",") : "(tombstone)");
const iso = (d) => new Date(d).toISOString();
const NOW = Date.now();
const base = iso(NOW - 4 * 86400000);

console.log("→ concurrent appends");
{
  Batches.data = { Sale: { savedAt: base, items: [{ uid: "a" }, { uid: "x", addedAt: iso(NOW - 60000) }] } };
  const r = mergeSyncDoc({ batches: { Sale: { savedAt: base, items: [{ uid: "a" }, { uid: "y", addedAt: iso(NOW - 55000) }] } }, history: [] });
  ok("both sides' appends survive", uids(r.merged.batches.Sale) === "a,x,y", r.merged.batches.Sale);
  ok("both directions flagged changed", r.changedLocal && r.changedRemote);
}

console.log("→ removal sticks (full save is authoritative)");
{
  // remote full-saved without x AFTER x was added — x must not resurrect
  Batches.data = { Sale: { savedAt: base, items: [{ uid: "a" }, { uid: "x", addedAt: iso(NOW - 3 * 86400000) }] } };
  const r = mergeSyncDoc({ batches: { Sale: { savedAt: iso(NOW - 86400000), items: [{ uid: "a", addedAt: iso(NOW - 86400000) }] } }, history: [] });
  ok("removed item stays removed", uids(r.merged.batches.Sale) === "a", r.merged.batches.Sale);
}

console.log("→ append newer than the winning save is rescued");
{
  Batches.data = { Sale: { savedAt: base, items: [{ uid: "a" }, { uid: "z", addedAt: iso(NOW - 1000) }] } };
  const r = mergeSyncDoc({ batches: { Sale: { savedAt: iso(NOW - 3600000), items: [{ uid: "a", addedAt: iso(NOW - 3600000) }] } }, history: [] });
  ok("fresh local append survives a newer remote full save", uids(r.merged.batches.Sale) === "a,z", r.merged.batches.Sale);
}

console.log("→ tombstones");
{
  Batches.data = { Old: { deletedAt: "2020-01-01T00:00:00Z" } };
  const r = mergeSyncDoc({ batches: { Old: { deletedAt: "2020-01-01T00:00:00Z" } }, history: [] });
  ok("expired tombstone drops out of the doc", !("Old" in r.merged.batches));
  ok("dropping a remote tombstone marks the doc changed", r.changedRemote);

  Batches.data = { B: { savedAt: base, items: [{ uid: "z", addedAt: iso(NOW - 1000) }] } };
  const r2 = mergeSyncDoc({ batches: { B: { deletedAt: iso(NOW - 2000) } }, history: [] });
  ok("fresh delete beats a concurrent append", !!r2.merged.batches.B.deletedAt, r2.merged.batches.B);

  Batches.data = { C: { deletedAt: iso(NOW - 2000) } };
  const r3 = mergeSyncDoc({ batches: { C: { savedAt: iso(NOW - 1000), items: [{ uid: "n", addedAt: iso(NOW - 1000) }] } }, history: [] });
  ok("a save after the delete resurrects the batch", uids(r3.merged.batches.C) === "n", r3.merged.batches.C);
}

console.log("→ first sync (no remote doc)");
{
  Batches.data = { A: { savedAt: base, items: [{ uid: "a" }] } };
  History.data = [{ uid: "h1", at: base }];
  const r = mergeSyncDoc(null);
  ok("local content forms the doc", uids(r.merged.batches.A) === "a" && r.merged.history.length === 1);
  ok("write is requested", r.changedRemote);
}

console.log("→ history union");
{
  Batches.data = {};
  History.data = [{ uid: "h1", at: iso(NOW - 1000) }];
  const r = mergeSyncDoc({ batches: {}, history: [{ uid: "h2", at: iso(NOW - 2000) }, { uid: "h1", at: iso(NOW - 1000) }] });
  ok("history unions by uid, newest first", r.merged.history.map((h) => h.uid).join(",") === "h1,h2", r.merged.history);
}

console.log("→ merge is idempotent");
{
  Batches.data = { Sale: { savedAt: base, items: [{ uid: "a" }, { uid: "x", addedAt: iso(NOW - 60000) }] } };
  const r1 = mergeSyncDoc({ batches: { Sale: { savedAt: base, items: [{ uid: "a" }, { uid: "y", addedAt: iso(NOW - 55000) }] } }, history: [] });
  const snapshot = uids(r1.merged.batches.Sale);
  // merging the merged doc against itself must change nothing
  const r2 = mergeSyncDoc(JSON.parse(JSON.stringify(r1.merged)));
  ok("re-merge is a no-op", uids(r2.merged.batches.Sale) === snapshot && !r2.changedLocal && !r2.changedRemote,
    { uids: uids(r2.merged.batches.Sale), changedLocal: r2.changedLocal, changedRemote: r2.changedRemote });
}

console.log(failures ? `\n${failures} failure(s)` : "\nall merge tests passed");
