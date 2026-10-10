/* ============================================================
   Ace Location Studio — the location-clearing rules. Pure functions
   only (no DOM), so the same file runs in the app and under
   `node tests/unit.mjs`.

   Eagle keeps six location slots per SKU (index 0 = Location 1):
     1  primary shelf location        — cleared by default when it matches
     2  system flag (MDONE, 16END…)   — only when ticked for that code
     3  primary shelf capacity        — only when ticked for that code
     4–6 overstock locations          — cleared by default when they match
   Each code can be set to clear its own choice of slots; without one it
   clears the default four (1, 4, 5, 6).
   A code clears every location that STARTS WITH it, so "12R" clears
   12R01–12R09 and "12R03" clears just 12R03. In the import file a "?"
   tells Eagle to clear that slot; every other slot is written back
   exactly as it is today, because Eagle expects all six columns.
   ============================================================ */
"use strict";

(function (root) {
  const SLOTS = 6;
  const CLEARABLE = [0, 3, 4, 5];
  const PROTECTED = [1, 2];
  const MAX_CODE = 5; // Eagle location codes are at most 5 characters
  const SLOT_NAMES = ["Location 1", "Location 2", "Location 3", "Location 4", "Location 5", "Location 6"];
  const SLOT_ROLES = ["Shelf", "Flag", "Capacity", "Overstock", "Overstock", "Overstock"];
  const HEADER = ["SKU"].concat(SLOT_NAMES);
  const CLEAR_MARK = "?";

  const norm = (s) => String(s == null ? "" : s).trim().toUpperCase();

  /** Split typed text into codes: commas, semicolons or spaces separate
   *  them; upper-cased, de-duplicated, in the order typed. */
  function parseCodes(text) {
    const out = [];
    for (const part of String(text || "").split(/[\s,;]+/)) {
      const c = norm(part);
      if (c && !out.includes(c)) out.push(c);
    }
    return out;
  }

  /** Why a code can't be used, or "" if it's fine. */
  function codeProblem(code) {
    const c = norm(code);
    if (!c) return "Type a location code.";
    if (c.length > MAX_CODE) return `Location codes are at most ${MAX_CODE} characters — "${c}" is ${c.length}.`;
    if (c.includes(CLEAR_MARK)) return "A code can't contain a question mark.";
    if (/["\s,;]/.test(c)) return "A code can't contain spaces, commas or quotes.";
    return "";
  }

  /** The first code a location value starts with, or null. */
  function matchCode(value, codes) {
    const v = norm(value);
    if (!v || v === CLEAR_MARK) return null;
    for (const c of codes) if (c && v.startsWith(c)) return c;
    return null;
  }

  /** The slots a code clears: its own choice, or the default four. */
  function slotsFor(code, slotsByCode) {
    const s = slotsByCode && slotsByCode[code];
    if (!Array.isArray(s)) return CLEARABLE.slice();
    return Array.from(new Set(s.filter((x) => Number.isInteger(x) && x >= 0 && x < SLOTS))).sort((a, b) => a - b);
  }

  /** Whether a code's choice is the default (Locations 1, 4, 5, 6). */
  function isDefaultSlots(slots) {
    return slots.length === CLEARABLE.length && CLEARABLE.every((x) => slots.includes(x));
  }

  /** Codes made redundant by a shorter code that already covers them
   *  ("12R03" when "12R" is on the list): [{ code, by }]. */
  function coveredCodes(codes) {
    const out = [];
    codes.forEach((c) => {
      const by = codes.find((o) => o !== c && c.startsWith(o));
      if (by) out.push({ code: c, by });
    });
    return out;
  }

  /**
   * Work out the clear for a loaded file.
   * rows:  [{ sku, desc, locs: [6 strings] }]
   * codes: ["12R", …] (already normalized)
   * slotsByCode: optional { "12R": [0], … } — which slots each code clears
   *   (index 0 = Location 1); a code without an entry clears 1, 4, 5 and 6.
   * Returns {
   *   changed:   rows going into the import — { sku, desc, before, after, cleared: [slot…] }
   *   unchanged: number of SKUs with nothing to clear (left out of the import)
   *   cells:     number of "?" written
   *   stats:     per code, in order — { code, cells, skus, values: [sorted], bySlot: [6] }
   *   protectedHits: matches left alone because that slot isn't ticked for
   *     the code (Location 2/3 by default) — { sku, slot, value, code }
   * }
   */
  function planClear(rows, codes, slotsByCode) {
    const list = (codes || []).map(norm).filter(Boolean);
    const slotsOf = Object.fromEntries(list.map((c) => [c, slotsFor(c, slotsByCode)]));
    // For each slot, the codes that clear it (in typed order).
    const codesFor = [];
    for (let k = 0; k < SLOTS; k++) codesFor.push(list.filter((c) => slotsOf[c].includes(k)));
    const stats = list.map((code) => ({ code, cells: 0, skus: 0, values: [], bySlot: [0, 0, 0, 0, 0, 0] }));
    const byCode = Object.fromEntries(stats.map((s) => [s.code, { s, values: new Set(), skus: new Set() }]));
    const changed = [];
    const protectedHits = [];
    let cells = 0;
    (rows || []).forEach((row, i) => {
      const before = [];
      for (let k = 0; k < SLOTS; k++) before.push(row.locs && row.locs[k] != null ? String(row.locs[k]) : "");
      const after = before.slice();
      const cleared = [];
      for (let slot = 0; slot < SLOTS; slot++) {
        const code = matchCode(before[slot], codesFor[slot]);
        if (!code) {
          const skipped = matchCode(before[slot], list);
          if (skipped) protectedHits.push({ sku: row.sku, slot, value: before[slot], code: skipped });
          continue;
        }
        after[slot] = CLEAR_MARK;
        cleared.push(slot);
        const b = byCode[code];
        b.s.cells++;
        b.s.bySlot[slot]++;
        b.values.add(norm(before[slot]));
        b.skus.add(i);
      }
      if (cleared.length) {
        cells += cleared.length;
        changed.push({ sku: String(row.sku), desc: row.desc || "", before, after, cleared });
      }
    });
    for (const s of stats) {
      const b = byCode[s.code];
      s.skus = b.skus.size;
      s.values = Array.from(b.values).sort(locCompare);
    }
    return { changed, unchanged: (rows || []).length - changed.length, cells, stats, protectedHits };
  }

  /** Natural sort for location codes: 12R2 < 12R10. */
  function locCompare(a, b) {
    return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
  }

  function csvField(v) {
    const s = String(v == null ? "" : v);
    return /[",\r\n]/.test(s) || s !== s.trim() ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** The Eagle import file: SKU + all six locations for every changed SKU,
   *  CRLF line endings, matching the layout Eagle's import map expects. */
  function importCSV(changed) {
    const lines = [HEADER.join(",")];
    for (const r of changed || []) lines.push([r.sku].concat(r.after).map(csvField).join(","));
    return lines.join("\r\n");
  }

  /** "12R LOCCLEAR - Eagle Import.csv" — named after the codes. */
  function importFileName(codes) {
    const clean = (codes || []).map((c) => norm(c).replace(/[^A-Z0-9-]/g, "")).filter(Boolean);
    let lead = clean.slice(0, 6).join(" ");
    if (clean.length > 6) lead += ` +${clean.length - 6} more`;
    lead = lead.replace(/^[^A-Za-z0-9]+/, "");
    return (lead ? lead + " " : "") + "LOCCLEAR - Eagle Import.csv";
  }

  /** Short readable list of matched values: "12R01, 12R02 … 12R09 (9)". */
  function valuesSummary(values, max) {
    const n = values.length;
    const m = max || 6;
    if (n <= m) return values.join(", ");
    return values.slice(0, m - 1).join(", ") + ` … ${values[n - 1]} (${n})`;
  }

  const Clear = {
    SLOTS, CLEARABLE, PROTECTED, MAX_CODE, SLOT_NAMES, SLOT_ROLES, HEADER, CLEAR_MARK,
    parseCodes, codeProblem, matchCode, coveredCodes, slotsFor, isDefaultSlots, planClear, importCSV, importFileName,
    valuesSummary, locCompare, csvField,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = Clear;
  else root.Clear = Clear;
})(typeof window !== "undefined" ? window : globalThis);
