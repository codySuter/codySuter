/* ============================================================
   Ace Location Studio — reading an Ace planogram PDF and building the
   files for a new plan. Pure functions only (no DOM, no pdf.js calls),
   so the same file runs in the app and under `node tests/unit.mjs`.

   The app hands in each page's text as pdf.js gives it (string +
   transform matrix + width). From that we read:
     - the cover page: POG ID, title, live date
     - the ACE HARDWARE PRODUCT REPORT: one row per SKU with FACINGS,
       REC QTY and SEG (segment = one 4-ft section of the plan)
     - the "ACE NUMBER" drawing pages: where each SKU label sits, so the
       drawing can be made clickable

   Files built from it (all CRLF, no trailing newline):
     <POG> NEWLOC - Eagle Import.csv   SKU,Location 1,Location 3
     <POG> LABELS.csv                  facings,SKU   (one location)
     <POG> LABELS <loc>.csv + <POG> LABELS ALL.csv   (several locations)
   Location 3 = REC QTY scaled down by facings, rounded down, never
   below 1; blank when the plan lists no REC QTY. 0 facings drops the SKU
   from every file.
   ============================================================ */
"use strict";

(function (root) {
  const SKU_RE = /^\d{4,8}[A-Z]?$/;
  const UPC_RE = /^\d{11,14}$/;
  const DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
  const POG_RE = /^[A-Z0-9]{5,12}$/;
  const NUM_COLS = ["FACINGS", "REC", "SEG", "ROW", "COL"];
  const REPORT_COLS = ["SKU CODE", "UPC", "DESCRIPTION", "VENDOR'S PART#", "VENDOR NAME", "FACINGS", "REC", "SEG", "PEG ID", "ROW", "COL"];

  /* ---------------- text items ---------------- */

  /** Normalize one pdf.js text item: { str, x, y, w, size, rot, box }.
   *  x/y is the baseline origin in PDF units (y up); box is the item's
   *  rectangle {x0, y0, x1, y1}, whatever its rotation. */
  function normItem(it) {
    const [a, b, c, d, e, f] = it.transform;
    const size = Math.hypot(a, b) || Math.hypot(c, d) || 1;
    const w = it.width || 0;
    let rot = 0;
    if (Math.abs(b) > Math.abs(a)) rot = b > 0 ? 90 : 270;
    else if (a < 0) rot = 180;
    // Corners: origin, along the text by its width, and "up" the glyphs by its size.
    const ux = a / size, uy = b / size;
    const vh = Math.hypot(c, d) || 1;
    const vx = c / vh, vy = d / vh;
    const xs = [e, e + ux * w, e + vx * size, e + ux * w + vx * size];
    const ys = [f, f + uy * w, f + vy * size, f + uy * w + vy * size];
    return {
      str: String(it.str || "").trim(), x: e, y: f, w, size, rot,
      box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
    };
  }

  /** Group upright items into lines (top of page first), each sorted left
   *  to right. */
  function toLines(items, tol) {
    const t = tol || 1.5;
    const flat = items.filter((i) => i.str && i.rot === 0).sort((p, q) => q.y - p.y || p.x - q.x);
    const lines = [];
    for (const it of flat) {
      const line = lines.length && Math.abs(lines[lines.length - 1].y - it.y) <= t ? lines[lines.length - 1] : null;
      if (line) line.items.push(it);
      else lines.push({ y: it.y, items: [it] });
    }
    lines.forEach((l) => l.items.sort((p, q) => p.x - q.x));
    return lines;
  }

  const center = (it) => it.x + it.w / 2;
  const toInt = (s) => (/^\d+$/.test(String(s).trim()) ? parseInt(s, 10) : null);

  /* ---------------- the whole plan ---------------- */

  /**
   * pages: [{ num, items: [normItem…], width, height }]
   * Returns { pogId, title, liveDate, items, segments, drawings, coverPage, warnings }.
   */
  function parsePlan(pages) {
    const warnings = [];
    const meta = readMeta(pages);
    const rows = readReport(pages);
    if (!rows.length) {
      return { ...meta, items: [], segments: [], drawings: [], warnings: ["No ACE HARDWARE PRODUCT REPORT found in this PDF — is it an Ace planogram?"] };
    }
    const items = mergeRows(rows, warnings);
    const segNums = [...new Set(items.map((i) => i.seg))].sort((a, b) => a - b);
    const segments = segNums.map((seg) => ({ seg, skus: items.filter((i) => i.seg === seg).length }));
    const drawings = readDrawings(pages, items);
    for (const s of segNums) {
      if (!drawings.some((d) => d.seg === s)) warnings.push(`Segment ${s} has no drawing page — its SKUs are in the list only.`);
    }
    const unlabeled = items.filter((i) => !drawings.some((d) => d.labels.some((l) => l.sku === i.sku)));
    if (drawings.length && unlabeled.length) {
      warnings.push(`${unlabeled.length} SKU${unlabeled.length === 1 ? " isn't" : "s aren't"} labeled on the drawing (${unlabeled.slice(0, 5).map((i) => i.sku).join(", ")}${unlabeled.length > 5 ? "…" : ""}) — change ${unlabeled.length === 1 ? "it" : "them"} from the list.`);
    }
    return { ...meta, items, segments, drawings, warnings };
  }

  function readMeta(pages) {
    const out = { pogId: "", title: "", liveDate: "", coverPage: pages.length ? pages[0].num : 1 };
    for (const p of pages) {
      const its = p.items.filter((i) => i.str && i.rot === 0);
      if (!out.pogId) {
        const tag = its.find((i) => /^POG ID:?$/i.test(i.str));
        if (tag) {
          const near = its
            .filter((i) => POG_RE.test(i.str) && i.x > tag.x && i.x - tag.x < 160 && i.y <= tag.y + 4 && tag.y - i.y < 30)
            .sort((a, b) => (a.x - tag.x + (tag.y - a.y)) - (b.x - tag.x + (tag.y - b.y)));
          if (near.length) out.pogId = near[0].str;
        }
      }
      if (its.some((i) => /^COVER PAGE$/i.test(i.str))) {
        out.coverPage = p.num;
        if (!out.title) {
          const top = Math.max(...its.map((i) => i.y));
          const first = its.filter((i) => Math.abs(i.y - top) < 2).sort((a, b) => a.x - b.x)[0];
          if (first) out.title = first.str;
        }
        if (!out.liveDate) {
          const d = its.find((i) => DATE_RE.test(i.str));
          if (d) out.liveDate = d.str;
        }
      }
    }
    return out;
  }

  /** Product report rows, in report order. */
  function readReport(pages) {
    const rows = [];
    let cols = null; // header name → x center
    let curSeg = null, fixture = "", fixtureLoc = "";
    for (const p of pages) {
      const lines = toLines(p.items);
      const isReport = p.items.some((i) => /ACE HARDWARE PRODUCT REPORT/i.test(i.str)) || lines.some((l) => l.items.some((i) => i.str === "SKU CODE"));
      if (!isReport) continue;
      for (const line of lines) {
        const strs = line.items.map((i) => i.str);
        const segTag = strs.find((s) => /^In Segment:/i.test(s));
        if (segTag) {
          curSeg = toInt(segTag.replace(/^In Segment:\s*/i, ""));
          const fx = strs.find((s) => /^On Fixture Description:/i.test(s));
          fixture = fx ? fx.replace(/^On Fixture Description:\s*/i, "") : "";
          const fl = strs.find((s) => /^Fixture Location:/i.test(s));
          fixtureLoc = fl ? fl.replace(/^Fixture Location:\s*/i, "") : "";
          continue;
        }
        if (strs.includes("SKU CODE")) {
          cols = {};
          for (const it of line.items) if (REPORT_COLS.includes(it.str)) cols[it.str] = center(it);
          continue;
        }
        if (!cols || cols.FACINGS == null) continue;
        const first = line.items[0];
        if (!first || !SKU_RE.test(first.str) || !line.items.some((i) => UPC_RE.test(i.str))) continue;
        // Each cell goes to the heading whose center it sits closest to —
        // a small number (or N/A) to the nearest number column when it's
        // right under one, anything else to the nearest text column (PEG ID
        // text, for one, starts well left of its heading).
        const cell = {};
        const names = Object.keys(cols);
        const numNames = names.filter((n) => NUM_COLS.includes(n));
        const textNames = names.filter((n) => !NUM_COLS.includes(n));
        for (const it of line.items) {
          let pool = textNames;
          if (/^(\d{1,4}|N\/A)$/.test(it.str) && numNames.some((n) => Math.abs(center(it) - cols[n]) < 14)) pool = numNames;
          let best = null, dist = Infinity;
          for (const n of pool) {
            const dd = Math.abs(center(it) - cols[n]);
            if (dd < dist) { dist = dd; best = n; }
          }
          cell[best] = cell[best] ? cell[best] + " " + it.str : it.str;
        }
        const sku = first.str;
        const facings = toInt(cell.FACINGS);
        rows.push({
          sku,
          upc: cell.UPC || "",
          desc: cell.DESCRIPTION || "",
          vendor: cell["VENDOR NAME"] || "",
          facings: facings == null ? 1 : facings,
          rec: cell.REC != null ? toInt(cell.REC) : null,
          seg: toInt(cell.SEG) != null ? toInt(cell.SEG) : curSeg != null ? curSeg : 1,
          peg: cell["PEG ID"] || "",
          row: cell.ROW && cell.ROW !== "N/A" ? cell.ROW : "",
          col: cell.COL && cell.COL !== "N/A" ? cell.COL : "",
          fixture, fixtureLoc,
          page: p.num,
        });
      }
    }
    return rows;
  }

  /** One entry per SKU. A SKU listed twice adds its facings and REC QTY
   *  together; one listed in two segments keeps the first segment for its
   *  Location 1 (with a warning). */
  function mergeRows(rows, warnings) {
    const bySku = new Map();
    const multiSeg = [];
    for (const r of rows) {
      const cur = bySku.get(r.sku);
      if (!cur) { bySku.set(r.sku, { ...r, segs: [r.seg], spots: 1 }); continue; }
      cur.facings += r.facings;
      cur.rec = cur.rec == null && r.rec == null ? null : (cur.rec || 0) + (r.rec || 0);
      cur.spots++;
      if (!cur.segs.includes(r.seg)) { cur.segs.push(r.seg); if (!multiSeg.includes(r.sku)) multiSeg.push(r.sku); }
    }
    if (multiSeg.length) {
      warnings.push(`In more than one section: ${multiSeg.join(", ")}. Each gets its first section's location; facings and REC QTY are added together.`);
    }
    return [...bySku.values()];
  }

  /** The "ACE NUMBER" drawing pages and where each SKU's label is. A page's
   *  segment is the one most of its labels belong to (labels of long items
   *  that hang into the next section show on both pages). */
  function readDrawings(pages, items) {
    const segOf = new Map(items.map((i) => [i.sku, i.seg]));
    const out = [];
    for (const p of pages) {
      if (!p.items.some((i) => /^ACE NUMBER$/i.test(i.str))) continue;
      const labels = p.items
        .filter((i) => segOf.has(i.str))
        .map((i) => ({ sku: i.str, ...i.box, rot: i.rot }));
      if (!labels.length) continue;
      const votes = {};
      labels.forEach((l) => { const s = segOf.get(l.sku); votes[s] = (votes[s] || 0) + 1; });
      const seg = Number(Object.keys(votes).sort((a, b) => votes[b] - votes[a] || a - b)[0]);
      out.push({ page: p.num, seg, labels, width: p.width, height: p.height });
    }
    return out;
  }

  /* ---------------- facings → capacity ---------------- */

  /** Location 3 for a SKU at `facings` (the plan has `planFacings` and
   *  `rec`): REC QTY scaled down, rounded down, never below 1. null when
   *  there's no REC QTY or the SKU is dropped (0 facings). */
  function capacity(rec, planFacings, facings) {
    if (rec == null || facings <= 0) return null;
    if (!planFacings || facings >= planFacings) return rec;
    return Math.max(1, Math.floor((rec * facings) / planFacings));
  }

  /* ---------------- locations ---------------- */

  const normCode = (s) => String(s == null ? "" : s).trim().toUpperCase();

  /** Why a location code can't be used, or "" if it's fine. */
  function codeProblem(code) {
    const c = normCode(code);
    if (!c) return "Type the location for this section.";
    if (c.length > 5) return `Locations are at most 5 characters — "${c}" is ${c.length}.`;
    if (!/^[A-Z0-9-]+$/.test(c)) return "Use letters, numbers and dashes only.";
    return "";
  }

  /** The next panel after a code: 12R03 → 12R04, 12R9 → 12R10. "" if the
   *  code doesn't end in a number. */
  function nextCode(code, step) {
    const m = /^(.*?)(\d+)$/.exec(normCode(code));
    if (!m) return "";
    const n = parseInt(m[2], 10) + (step == null ? 1 : step);
    if (n < 0) return "";
    const num = String(n).padStart(m[2].length, "0");
    const out = m[1] + num;
    return out.length <= 5 ? out : "";
  }

  /* ---------------- files ---------------- */

  function csvField(v) {
    const s = String(v == null ? "" : v);
    return /[",\r\n]/.test(s) || s !== s.trim() ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const csvLines = (rows) => rows.map((r) => r.map(csvField).join(",")).join("\r\n");

  /** The rows each file needs, in report order, skipping dropped SKUs.
   *  codes: { seg → location }, facings: { sku → facings } (missing = plan). */
  function planRows(items, codes, facings) {
    const f = facings || {};
    return items
      .map((i) => {
        const fc = f[i.sku] != null ? f[i.sku] : i.facings;
        return { item: i, sku: i.sku, seg: i.seg, loc: normCode(codes[i.seg]), facings: fc, cap: capacity(i.rec, i.facings, fc) };
      })
      .filter((r) => r.facings > 0);
  }

  function importCSV(rows) {
    return csvLines([["SKU", "Location 1", "Location 3"]].concat(rows.map((r) => [r.sku, r.loc, r.cap == null ? "" : r.cap])));
  }

  function labelCSV(rows) {
    return csvLines(rows.map((r) => [r.facings, r.sku]));
  }

  const safeName = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9-]/g, "");

  /** Every file to save: [{ kind, name, csv, rows, loc }]. Labels are
   *  split by location when there's more than one, plus an ALL file. Rows
   *  are ordered by section, then report order. */
  function planFiles(plan, codes, facings) {
    const pog = safeName(plan.pogId) || "PLAN";
    const segOrder = new Map((plan.segments || []).map((s, i) => [s.seg, i]));
    const rows = planRows(plan.items, codes, facings)
      .map((r, i) => ({ r, i }))
      .sort((a, b) => (segOrder.get(a.r.seg) - segOrder.get(b.r.seg)) || a.i - b.i)
      .map((x) => x.r);
    const files = [{ kind: "import", name: `${pog} NEWLOC - Eagle Import.csv`, csv: importCSV(rows), rows: rows.length }];
    const locs = [];
    rows.forEach((r) => { if (!locs.includes(r.loc)) locs.push(r.loc); });
    if (locs.length <= 1) {
      files.push({ kind: "labels", name: `${pog} LABELS.csv`, csv: labelCSV(rows), rows: rows.length, loc: locs[0] || "" });
    } else {
      for (const loc of locs) {
        const lr = rows.filter((r) => r.loc === loc);
        files.push({ kind: "labels", name: `${pog} LABELS ${safeName(loc) || "NOLOC"}.csv`, csv: labelCSV(lr), rows: lr.length, loc });
      }
      files.push({ kind: "labels-all", name: `${pog} LABELS ALL.csv`, csv: labelCSV(rows), rows: rows.length, loc: "" });
    }
    return files;
  }

  const Pog = {
    SKU_RE, normItem, toLines, parsePlan, readReport, readMeta, readDrawings, mergeRows,
    capacity, codeProblem, nextCode, planRows, importCSV, labelCSV, planFiles, csvField,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = Pog;
  else root.Pog = Pog;
})(typeof window !== "undefined" ? window : globalThis);
