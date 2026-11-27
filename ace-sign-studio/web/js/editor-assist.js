/* ============================================================
   Editor assists: the small helpers that make the sign editor
   forgiving for people who don't live on a computer —
   per-field problem/warning/hint messages, values that fill
   themselves in (Instant Savings), quick-pick chips for percents
   and sale dates, and undo/redo for everything typed or dragged.
   Shared by the single-sign form and the Multi Product cards.
   ============================================================ */
"use strict";

const num = (v) => {
  const s = String(v == null ? "" : v).replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return isNaN(n) ? NaN : n;
};
const money2 = (n) => "$" + n.toFixed(2);

/* Is field `key` shown in this type's form for this spec (modes + hides)? */
function fieldActive(t, spec, key) {
  if (spec.hide && spec.hide[key]) return false;
  return t.fields.some((x) => x.key === key && (!x.modes || x.modes.includes(spec.mode)));
}

/* Required-field problems, as [{key, msg}] in form order. The single
   source of truth behind validateSpec (which reports the first one). */
function specProblems(t, spec) {
  const out = [];
  const need = (k) => fieldActive(t, spec, k);
  const blank = (k) => !String(spec[k] == null ? "" : spec[k]).trim();
  if (need("category") && blank("category")) out.push({ key: "category", msg: "Enter the category name." });
  if (need("name") && blank("name")) out.push({ key: "name", msg: t.id === "big_text" ? "Type the big text." : "Enter a product name (or look up a SKU)." });
  if (t.id === "was_now" && blank("regPrice")) out.push({ key: "regPrice", msg: "Enter the was price." });
  if (t.id === "stihl_clearance" && spec.mode === "wasnow" && blank("regPrice")) out.push({ key: "regPrice", msg: "Enter the was price." });
  if (need("price") && blank("price")) out.push({ key: "price", msg: "Enter a price." });
  if (need("percent") && blank("percent")) out.push({ key: "percent", msg: "Enter the percent off." });
  if (need("savings") && blank("savings")) out.push({ key: "savings", msg: t.id === "buy_get_off" ? "Enter the dollars off." : "Enter the savings amount." });
  return out;
}

/* Soft checks that never block printing: things that are probably a
   typo (a sale price above the regular price, 150% off, dates that are
   already over) plus friendly info lines (2 for $9 = $4.50 each). */
function specNotes(t, spec) {
  const out = [];
  const warn = (key, msg) => out.push({ key, msg, level: "warn" });
  const info = (key, msg) => out.push({ key, msg, level: "info" });
  for (const k of ["price", "regPrice", "savings"]) {
    if (fieldActive(t, spec, k) && Number.isNaN(num(spec[k]))) warn(k, "That doesn't look like a dollar amount — use numbers like 19.99.");
  }
  const price = num(spec.price), reg = num(spec.regPrice);
  const both = price != null && reg != null && !isNaN(price) && !isNaN(reg) && price > 0 && reg > 0;
  const wasNowType = t.id === "was_now" || (t.id === "stihl_clearance" && spec.mode === "wasnow");
  if (both && (t.id === "sale" || t.id === "instant_savings") && price >= reg) {
    warn("price", `The sale price is not lower than the regular price (${money2(reg)}). Double-check the two prices.`);
  } else if (both && wasNowType && price >= reg) {
    warn("price", `The now price is not lower than the was price (${money2(reg)}). Double-check the two prices.`);
  } else if (both && (t.id === "sale" || wasNowType)) {
    info("price", `Customer saves ${money2(reg - price)} (${Math.round((1 - price / reg) * 100)}% off).`);
  }
  if (fieldActive(t, spec, "percent")) {
    const p = num(spec.percent);
    if (p != null && (isNaN(p) || p <= 0 || p >= 100)) warn("percent", "Percent off should be a number from 1 to 99.");
  }
  if (t.id === "two_for" && fieldActive(t, spec, "price")) {
    const q = parseInt(spec.qty, 10) || 2;
    if (price > 0) info("price", `${q} for ${money2(price)} = ${money2(price / q)} each.`);
  }
  if (t.id === "instant_savings" && both && price < reg) {
    const sv = num(spec.savings);
    if (sv > 0 && Math.abs(sv - (reg - price)) > 0.009) warn("savings", `The prices work out to ${money2(reg - price)} in savings, but this says ${money2(sv)}.`);
  }
  if (fieldActive(t, spec, "dates") && spec.endDate) {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (spec.endDate < iso) warn("dates", "These dates are already over — the sign would show an expired sale.");
  }
  return out;
}

/* key → {level, msg} for the messages under each field. Errors only
   once the user has tried to add/print (showErrors); warnings and info
   are always live. One message per field, worst first. */
function fieldMessages(t, spec, showErrors) {
  const map = {};
  const rank = { error: 3, warn: 2, info: 1 };
  const put = (n) => { if (!map[n.key] || rank[n.level] > rank[map[n.key].level]) map[n.key] = n; };
  if (showErrors) for (const p of specProblems(t, spec)) put({ key: p.key, msg: p.msg, level: "error" });
  for (const n of specNotes(t, spec)) put(n);
  return map;
}

/* Paint fieldMessages into a form scope: every .f-field[data-key] gets
   its message line and a matching red/amber edge on its input. */
function paintFieldMessages(scope, t, spec, showErrors) {
  if (!scope) return;
  const msgs = fieldMessages(t, spec, showErrors);
  // a note eases in only when it is new or its words changed — not every
  // time the form rebuilds around it
  const memo = (App._msgMemo = App._msgMemo || {});
  const card = scope.closest(".mp-card");
  const pre = card ? "p" + card.dataset.product + ":" : "";
  for (const box of scope.querySelectorAll(":scope .f-field[data-key]")) {
    // skip fields that belong to a nested Multi Product card
    if (box.closest(".mp-card") !== card) continue;
    const m = msgs[box.dataset.key];
    let line = box.querySelector(":scope > .f-msg");
    if (!line) { line = el("div", "f-msg"); box.appendChild(line); }
    box.classList.remove("has-error", "has-warn", "has-info");
    let txt = "";
    if (m) {
      box.classList.add("has-" + m.level);
      txt = (m.level === "error" ? "⚠ " : m.level === "warn" ? "Check: " : "") + m.msg;
    }
    if (line.textContent !== txt) line.textContent = txt;
    const key = pre + box.dataset.key;
    if (txt && memo[key] !== txt && typeof previewMotionOK === "function" && previewMotionOK()) {
      line.classList.remove("msg-in");
      void line.offsetWidth;
      line.classList.add("msg-in");
    }
    memo[key] = txt;
  }
}

/* Values that fill themselves in from other fields. Instant Savings:
   savings = regular − sale, until the user types their own amount
   (clearing the savings box hands it back to automatic). Returns the
   keys it changed so the caller can refresh those inputs. */
function applyDerived(t, spec, changedKey) {
  const changed = [];
  if (t.id === "instant_savings") {
    if (changedKey === "savings") {
      spec._savingsManual = !!String(spec.savings || "").trim();
    } else if (!spec._savingsManual && (changedKey === "price" || changedKey === "regPrice" || changedKey === "*")) {
      const price = num(spec.price), reg = num(spec.regPrice);
      if (price > 0 && reg > 0 && reg > price) {
        const d = Math.round((reg - price) * 100) / 100;
        const v = Number.isInteger(d) ? String(d) : d.toFixed(2);
        if (spec.savings !== v) { spec.savings = v; changed.push("savings"); }
      }
    }
  }
  return changed;
}

/* A row of one-click value chips under an input (percent presets). The
   chip drives the input like typing would, so every listener runs. */
function addQuickChips(box, inp, values, suffix) {
  const row = el("div", "quick-chips");
  for (const v of values) {
    const c = el("button", "quick-chip", v + (suffix || ""));
    c.type = "button";
    c.onclick = () => {
      inp.value = String(v);
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      if (typeof flashEls === "function") flashEls([inp], "neutral"); // the box it filled shows it took
    };
    row.appendChild(c);
  }
  box.appendChild(row);
  return row;
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* Quick date ranges under a pair of date inputs: set both, then fire the
   inputs' own change handlers so the spec + preview follow. */
function addDatePicks(box, startInp, endInp) {
  const today = new Date();
  const t0 = isoDate(today);
  const monthEnd = isoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  const picks = [
    ["This week", t0, plusDaysISO(t0, 6)],
    ["2 weeks", t0, plusDaysISO(t0, 13)],
    ["Through month end", t0, monthEnd],
  ];
  const row = el("div", "quick-chips");
  for (const [label, s, e] of picks) {
    const c = el("button", "quick-chip", label);
    c.type = "button";
    c.onclick = () => {
      startInp.value = s;
      startInp.dispatchEvent(new Event("change"));
      endInp.value = e;
      endInp.dispatchEvent(new Event("change"));
    };
    row.appendChild(c);
  }
  box.appendChild(row);
}

/* ---------- undo / redo ----------
   Snapshots of the editor's working spec + size, recorded a beat after
   each change settles (so a typed word is one step, not one per key).
   Reset whenever a different sign is opened. */
const EditorHistory = {
  stack: [],
  idx: -1,
  MAX: 80,
  snap() { return JSON.stringify({ spec: App.spec, sizeId: App.sizeId }); },
  reset() { this.stack = [this.snap()]; this.idx = 0; this.paint(); },
  record() {
    const s = this.snap();
    if (this.stack[this.idx] === s) return;
    this.stack = this.stack.slice(0, this.idx + 1);
    this.stack.push(s);
    if (this.stack.length > this.MAX) this.stack.shift();
    this.idx = this.stack.length - 1;
    this.paint();
  },
  canUndo() { return this.idx > 0 || this.snap() !== this.stack[this.idx]; },
  canRedo() { return this.idx < this.stack.length - 1; },
  go(delta) {
    // anything typed but not yet recorded becomes its own step first
    if (delta < 0 && this.snap() !== this.stack[this.idx]) this.record();
    const to = this.idx + delta;
    if (to < 0 || to >= this.stack.length) return false;
    this.idx = to;
    const s = JSON.parse(this.stack[to]);
    App.spec = s.spec;
    App.sizeId = s.sizeId;
    this.paint();
    return true;
  },
  paint() {
    const u = $("#undoBtn"), r = $("#redoBtn");
    if (u) u.disabled = !this.canUndo();
    if (r) r.disabled = !this.canRedo();
  },
};
const recordEditorHistory = debounce(() => { if (App.view === "editor") EditorHistory.record(); }, 450);
