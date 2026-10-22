/* ============================================================
   Ace Change Studio — the money math. Pure functions only (no DOM),
   so the same file runs in the app and under `node tests/unit.mjs`.

   All drawer amounts are integer CENTS. Change-box math is in whole
   DOLLARS (every roll and bill there is a whole-dollar amount).
   Floating-point dollars are never added up anywhere.
   ============================================================ */
"use strict";

(function (root) {
  /* ---------------- denominations ---------------- */

  // Everything that can be in a register drawer. No pennies: the store
  // rounds cash sales to the nickel.
  const DRAWER_DENOMS = [
    { id: "b100", kind: "bill", cents: 10000, label: "$100 bills", short: "$100" },
    { id: "b50", kind: "bill", cents: 5000, label: "$50 bills", short: "$50" },
    { id: "b20", kind: "bill", cents: 2000, label: "$20 bills", short: "$20" },
    { id: "b10", kind: "bill", cents: 1000, label: "$10 bills", short: "$10" },
    { id: "b5", kind: "bill", cents: 500, label: "$5 bills", short: "$5" },
    { id: "b1", kind: "bill", cents: 100, label: "$1 bills", short: "$1" },
    { id: "rq", kind: "roll", cents: 1000, per: 40, label: "Quarter rolls", short: "Q roll" },
    { id: "rd", kind: "roll", cents: 500, per: 50, label: "Dime rolls", short: "D roll" },
    { id: "rn", kind: "roll", cents: 200, per: 40, label: "Nickel rolls", short: "N roll" },
    { id: "cq", kind: "coin", cents: 25, label: "Quarters", short: "25¢" },
    { id: "cd", kind: "coin", cents: 10, label: "Dimes", short: "10¢" },
    { id: "cn", kind: "coin", cents: 5, label: "Nickels", short: "5¢" },
  ];
  const DENOM = Object.fromEntries(DRAWER_DENOMS.map((d) => [d.id, d]));

  // The change box: coin rolls are never opened; bill straps can be.
  // Dollar value per unit (roll or bill).
  const BOX_STOCK = [
    { id: "rq", dollars: 10, unit: "roll", label: "Quarters", pack: "roll", packOf: 40 },
    { id: "rd", dollars: 5, unit: "roll", label: "Dimes", pack: "roll", packOf: 50 },
    { id: "rn", dollars: 2, unit: "roll", label: "Nickels", pack: "roll", packOf: 40 },
    { id: "b1", dollars: 1, unit: "bill", label: "Ones", pack: "strap", packOf: 100 },
    { id: "b5", dollars: 5, unit: "bill", label: "Fives", pack: "strap", packOf: 100 },
    { id: "b10", dollars: 10, unit: "bill", label: "Tens", pack: "strap", packOf: 100 },
  ];
  // Bills that never belong in the change box — they go to the bank.
  const BOX_BIG = [
    { id: "b100", dollars: 100, label: "$100 bills" },
    { id: "b50", dollars: 50, label: "$50 bills" },
    { id: "b20", dollars: 20, label: "$20 bills" },
  ];
  const BOX_VALUE = Object.fromEntries([...BOX_STOCK, ...BOX_BIG].map((d) => [d.id, d.dollars]));

  const DEFAULT_IDEAL = { rq: 20, rd: 10, rn: 10, b1: 400, b5: 100, b10: 100 };
  // The store's usual reset: 3 tens, 8 fives, ~60 ones and $20 in coin.
  const DEFAULT_RESET = { b10: 3, b5: 8, b1: 60, cq: 50, cd: 50, cn: 50 };

  /* ---------------- small helpers ---------------- */

  const int = (v) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  function sumCents(counts) {
    let t = 0;
    for (const d of DRAWER_DENOMS) t += int(counts && counts[d.id]) * d.cents;
    return t;
  }

  function sumDollars(counts) {
    let t = 0;
    for (const id in BOX_VALUE) t += int(counts && counts[id]) * BOX_VALUE[id];
    return t;
  }

  /** "$1,234.50" / "-$2.00". */
  function money(cents, opts) {
    const neg = cents < 0;
    const abs = Math.abs(Math.round(cents));
    const d = Math.floor(abs / 100);
    const c = abs % 100;
    const s = "$" + d.toLocaleString("en-US") + (opts && opts.noCents && c === 0 ? "" : "." + String(c).padStart(2, "0"));
    if (opts && opts.sign) return (neg ? "−" : cents > 0 ? "+" : "") + s;
    return (neg ? "−" : "") + s;
  }

  function dollars(n, opts) {
    return money(Math.round(n * 100), Object.assign({ noCents: true }, opts));
  }

  /** Parse "$412.35", "412.3", "1,200" → cents, or null when not a number. */
  function parseMoney(text) {
    if (text == null) return null;
    let s = String(text).trim().replace(/[$,\s]/g, "");
    if (!s) return null;
    let neg = false;
    if (s.startsWith("-") || s.startsWith("−")) { neg = true; s = s.slice(1); }
    if (!/^\d*(\.\d{0,2})?$/.test(s) || s === ".") return null;
    const [whole, frac = ""] = s.split(".");
    const cents = int(whole || "0") * 100 + int((frac + "00").slice(0, 2));
    return neg ? -cents : cents;
  }

  /* ---------------- over / short ---------------- */

  /** Flag level for an over/short amount (cents): "good" | "warn" | "bad". */
  function flagLevel(overShortCents, flags) {
    const f = flags || { green: 100, yellow: 500 };
    const a = Math.abs(overShortCents);
    if (a <= f.green) return "good";
    if (a <= f.yellow) return "warn";
    return "bad";
  }

  /* ---------------- drawer reset ----------------
     Pick how many of each denomination to leave so the drawer is back to
     exactly its start amount, staying as close as possible to the reset
     recipe. It's a small bounded-knapsack: dynamic programming over the
     amount in nickels, minimising a "distance from the recipe" cost.

     Cost of leaving l of a denomination whose recipe says t:
       fewer than the recipe:  (t − l) × value
       more than the recipe:   (l − t) × value × surplusFactor
     Big bills carry a steep surplus factor (they don't make change), and
     coin rolls a mild one (loose coin is handier in the till). */
  const SURPLUS_FACTOR = { b100: 12, b50: 10, b20: 6, b10: 1.5, b5: 1.2, b1: 1, rq: 1.4, rd: 1.4, rn: 1.4, cq: 1, cd: 1, cn: 1 };

  function planReset(counts, recipe, startCents) {
    const start = Math.max(0, Math.round(startCents));
    const have = {};
    for (const d of DRAWER_DENOMS) have[d.id] = int(counts && counts[d.id]);
    const total = sumCents(have);
    const empty = () => Object.fromEntries(DRAWER_DENOMS.map((d) => [d.id, 0]));

    // Under the start amount: everything stays in the drawer.
    if (total <= start) {
      return {
        total, start, exact: total === start, shortCents: start - total,
        leave: Object.assign(empty(), have), pull: empty(),
        leaveCents: total, pullCents: 0,
      };
    }

    const UNIT = 5; // every denomination is a whole number of nickels
    const T = Math.floor(start / UNIT);
    const INF = 1e18;
    let best = new Float64Array(T + 1).fill(INF);
    best[0] = 0;
    const choice = []; // per denomination: Int32Array of l chosen at each amount

    for (const d of DRAWER_DENOMS) {
      const u = d.cents / UNIT;
      const t = int(recipe && recipe[d.id]);
      const f = SURPLUS_FACTOR[d.id] || 1;
      const maxL = Math.min(have[d.id], Math.floor(T / u));
      const next = new Float64Array(T + 1).fill(INF);
      const pick = new Int32Array(T + 1).fill(-1);
      for (let a = 0; a <= T; a++) {
        if (best[a] === INF) continue;
        for (let l = 0; l <= maxL; l++) {
          const na = a + l * u;
          if (na > T) break;
          const dev = l < t ? (t - l) * d.cents : (l - t) * d.cents * f;
          // tiny tie-breaker: prefer leaving smaller denominations
          const c = best[a] + dev + l * 1e-6 * (DRAWER_DENOMS.length - DRAWER_DENOMS.indexOf(d));
          if (c < next[na]) { next[na] = c; pick[na] = l; }
        }
      }
      best = next;
      choice.push(pick);
    }

    // Exactly the start amount if we can; otherwise the closest amount under.
    let target = T;
    while (target > 0 && best[target] === INF) target--;

    const leave = empty();
    let a = target;
    for (let i = DRAWER_DENOMS.length - 1; i >= 0; i--) {
      const d = DRAWER_DENOMS[i];
      const l = choice[i][a];
      leave[d.id] = l;
      a -= l * (d.cents / UNIT);
    }
    const pull = empty();
    for (const d of DRAWER_DENOMS) pull[d.id] = have[d.id] - leave[d.id];
    const leaveCents = sumCents(leave);
    return {
      total, start, exact: leaveCents === start, shortCents: start - leaveCents,
      leave, pull, leaveCents, pullCents: total - leaveCents,
    };
  }

  /* ---------------- change-box order (even swap) ----------------
     1. What's missing: ideal − counted. Coins in whole rolls; bills
        rounded UP to the bill rounding (half strap = 50 by default).
     2. What goes to the bank: every $20/$50/$100, plus 5s and 10s that
        are more than `excessThreshold` bills over ideal (down to ideal).
     3. Even swap: the bills handed over must equal the order to the dollar.
        - Plenty to take: take the smallest set of bank bills that covers
          the order (biggest bills first), and put any leftover dollar or
          two into extra ones so the two sides match exactly.
        - Not enough: trim the bill rounding (ones, then fives, then tens)
          back toward the exact shortage, then — the box itself is short —
          cut whatever will still be fullest after the order, and top up
          with ones if a cut overshoots.
     4. Report the box's variance from its ideal total. */
  function planOrder(haveIn, idealIn, opts) {
    const o = Object.assign({ billRound: 50, excessThreshold: 25 }, opts || {});
    const R = Math.max(1, int(o.billRound) || 1);
    const have = {}, ideal = {};
    for (const s of BOX_STOCK) { have[s.id] = int(haveIn && haveIn[s.id]); ideal[s.id] = int(idealIn && idealIn[s.id]); }
    for (const b of BOX_BIG) have[b.id] = int(haveIn && haveIn[b.id]);

    const idealTotal = sumDollars(ideal);
    const boxTotal = sumDollars(have);

    // 1. shortages and the rounded-up order
    const short = {}, order = {};
    for (const s of BOX_STOCK) {
      short[s.id] = Math.max(0, ideal[s.id] - have[s.id]);
      order[s.id] = s.unit === "bill" && short[s.id] > 0 ? Math.ceil(short[s.id] / R) * R : short[s.id];
    }

    // 2. bills that may go to the bank, biggest first. The primary pool is
    //    what always goes: big bills, plus 5s/10s well over ideal. The
    //    secondary pool (5s/10s only a little over ideal) is used only to
    //    pay for rounding an order up to half straps when the primary
    //    pool alone can't.
    const primary = [], secondary = [];
    for (const b of BOX_BIG) primary.push({ id: b.id, dollars: b.dollars, n: have[b.id] });
    for (const id of ["b10", "b5"]) {
      const extra = Math.max(0, have[id] - ideal[id]);
      const well = extra > int(o.excessThreshold);
      primary.push({ id, dollars: BOX_VALUE[id], n: well ? extra : 0 });
      secondary.push({ id, dollars: BOX_VALUE[id], n: well ? 0 : extra });
    }
    const total = (pool) => pool.reduce((t, p) => t + p.n * p.dollars, 0);
    const primaryTotal = total(primary), secondaryTotal = total(secondary);

    const orderValue = () => BOX_STOCK.reduce((t, s) => t + order[s.id] * s.dollars, 0);
    const take = { b100: 0, b50: 0, b20: 0, b10: 0, b5: 0 };
    const notes = [];
    let W = orderValue();

    // Take the smallest amount ≥ need from `pool`, biggest bills first;
    // returns the dollars taken.
    const takeAtLeast = (pool, need) => {
      const max = total(pool);
      const reach = reachableSums(pool, max);
      let V = Math.max(0, need);
      while (!reach[0][V]) V++; // max itself is always reachable
      let rem = V;
      pool.forEach((p, i) => {
        let k = Math.min(p.n, Math.floor(rem / p.dollars));
        while (k > 0 && !reach[i + 1][rem - k * p.dollars]) k--;
        take[p.id] += k;
        rem -= k * p.dollars;
      });
      return V;
    };
    const evenUp = (V) => {
      if (V > W) {
        order.b1 += V - W;
        notes.push({ kind: "info", text: `Added ${V - W} extra one${V - W === 1 ? "" : "s"} so the swap comes out even.` });
      }
    };

    if (primaryTotal >= W) {
      // 3a. the usual case: big bills cover it
      evenUp(takeAtLeast(primary, W));
    } else if (primaryTotal + secondaryTotal >= W) {
      // 3b. all the big bills, plus a few spare 10s/5s to pay for rounding
      for (const p of primary) take[p.id] += p.n;
      evenUp(primaryTotal + takeAtLeast(secondary, W - primaryTotal));
    } else {
      // 3c. take everything, shrink the order to fit
      for (const p of [...primary, ...secondary]) take[p.id] += p.n;
      const poolTotal = primaryTotal + secondaryTotal;
      let diff = W - poolTotal;
      for (const id of ["b1", "b5", "b10"]) {
        const room = order[id] - short[id];
        const k = Math.min(room, Math.floor(diff / BOX_VALUE[id]));
        if (k > 0) { order[id] -= k; diff -= k * BOX_VALUE[id]; }
      }
      let guard = 0;
      while (diff > 0 && guard++ < 10000) {
        const cands = BOX_STOCK.filter((s) => order[s.id] > 0);
        if (!cands.length) break;
        const fill = (s) => (ideal[s.id] ? (have[s.id] + order[s.id]) / ideal[s.id] : Infinity);
        const fits = cands.filter((s) => s.dollars <= diff);
        const pickFrom = fits.length ? fits : cands.slice().sort((x, y) => x.dollars - y.dollars).slice(0, 1);
        pickFrom.sort((x, y) => fill(y) - fill(x) || y.dollars - x.dollars);
        const s = pickFrom[0];
        order[s.id] -= 1;
        diff -= s.dollars;
      }
      if (diff < 0) order.b1 += -diff;
      if (orderValue() < BOX_STOCK.reduce((t, s) => t + short[s.id] * s.dollars, 0)) {
        notes.push({ kind: "warn", text: "There aren't enough bills to take to cover everything that's low, so this order fills what's running out first." });
      }
    }
    W = orderValue();
    const takeValue = Object.keys(take).reduce((t, id) => t + take[id] * BOX_VALUE[id], 0);

    const after = {};
    for (const s of BOX_STOCK) after[s.id] = have[s.id] + order[s.id] - (take[s.id] || 0);
    for (const b of BOX_BIG) after[b.id] = have[b.id] - take[b.id];
    const leftBig = BOX_BIG.filter((b) => after[b.id] > 0).map((b) => ({ id: b.id, n: after[b.id] }));
    if (leftBig.length && W > 0) {
      notes.push({ kind: "info", text: "Some big bills stay in the box — the box is over its ideal total, so they weren't needed for this swap." });
    }

    return {
      have, ideal, short, order, take, after,
      orderValue: W, takeValue, even: W === takeValue,
      boxTotal, idealTotal, variance: boxTotal - idealTotal,
      afterTotal: sumDollars(after), leftBig, notes,
      nothingToOrder: W === 0,
    };
  }

  // reach[i][s]: can pool items i.. make exactly s dollars?
  function reachableSums(pool, max) {
    const reach = new Array(pool.length + 1);
    reach[pool.length] = new Uint8Array(max + 1);
    reach[pool.length][0] = 1;
    for (let i = pool.length - 1; i >= 0; i--) {
      const prev = reach[i + 1], cur = new Uint8Array(max + 1);
      const { dollars: v, n } = pool[i];
      for (let s = 0; s <= max; s++) {
        if (!prev[s]) continue;
        for (let k = 0; k <= n && s + k * v <= max; k++) cur[s + k * v] = 1;
      }
      reach[i] = cur;
    }
    return reach;
  }

  /** "2 straps + 1 half strap", "37 bills", "6 rolls". */
  function packText(id, n) {
    const s = BOX_STOCK.find((x) => x.id === id);
    if (!s || n <= 0) return "—";
    if (s.unit === "roll") return `${n} roll${n === 1 ? "" : "s"}`;
    const straps = Math.floor(n / 100), half = Math.floor((n % 100) / 50), loose = n % 50;
    const parts = [];
    if (straps) parts.push(`${straps} strap${straps === 1 ? "" : "s"}`);
    if (half) parts.push("1 half strap");
    if (loose) parts.push(`${loose} bill${loose === 1 ? "" : "s"}`);
    return parts.join(" + ");
  }

  /** Plain-text order for the clipboard. */
  function orderText(plan, opts) {
    const lines = [];
    const head = (opts && opts.title) || "Change order";
    lines.push(head);
    for (const s of BOX_STOCK) {
      const n = plan.order[s.id];
      if (n > 0) lines.push(`  ${s.label}: ${packText(s.id, n)} (${dollars(n * s.dollars)})`);
    }
    lines.push(`  Total: ${dollars(plan.orderValue)}`);
    lines.push("");
    lines.push("Bills to take to the bank");
    for (const id of ["b100", "b50", "b20", "b10", "b5"]) {
      const n = plan.take[id] || 0;
      if (n > 0) lines.push(`  ${n} × $${BOX_VALUE[id]} (${dollars(n * BOX_VALUE[id])})`);
    }
    lines.push(`  Total: ${dollars(plan.takeValue)}`);
    return lines.join("\n");
  }

  /* ---------------- smart layout ----------------
     From saved change-box counts: how fast is each denomination used
     between one visit and the next? (After-swap stock last time minus
     what's counted now, over the days in between.) Then share the same
     total out so every denomination lasts about the same number of days,
     in whole rolls and half straps, with sensible minimums. */
  const MIN_LOGS = 3;
  const MIN_DAYS = 14;
  const MIN_UNITS = { rq: 2, rd: 2, rn: 2, b1: 50, b5: 50, b10: 50 };

  function usageRates(boxLogs) {
    const logs = (boxLogs || []).filter((l) => l && l.have && l.after && l.ts).slice().sort((a, b) => a.ts - b.ts);
    const used = Object.fromEntries(BOX_STOCK.map((s) => [s.id, 0]));
    let days = 0, intervals = 0;
    for (let i = 1; i < logs.length; i++) {
      const dt = (logs[i].ts - logs[i - 1].ts) / 86400000;
      if (dt < 0.25) continue; // same visit counted twice
      days += dt;
      intervals++;
      for (const s of BOX_STOCK) used[s.id] += int(logs[i - 1].after[s.id]) - int(logs[i].have[s.id]);
    }
    const rate = {};
    for (const s of BOX_STOCK) rate[s.id] = days > 0 ? Math.max(0, used[s.id] / days) : 0;
    return { rate, days, logs: logs.length, intervals };
  }

  function suggestIdeal(boxLogs, idealIn) {
    const ideal = {};
    for (const s of BOX_STOCK) ideal[s.id] = int(idealIn && idealIn[s.id]);
    const u = usageRates(boxLogs);
    const ready = u.logs >= MIN_LOGS && u.days >= MIN_DAYS;
    const res = { ready, logs: u.logs, days: u.days, needLogs: Math.max(0, MIN_LOGS - u.logs), needDays: Math.max(0, Math.ceil(MIN_DAYS - u.days)), rate: u.rate };
    if (!ready) return res;

    const T = sumDollars(ideal);
    const vr = {}; // dollars used per day
    for (const s of BOX_STOCK) vr[s.id] = u.rate[s.id] * s.dollars;
    const minV = (s) => MIN_UNITS[s.id] * s.dollars;
    const valueAt = (D) => BOX_STOCK.reduce((t, s) => t + Math.max(minV(s), vr[s.id] * D), 0);
    if (BOX_STOCK.every((s) => vr[s.id] === 0)) return Object.assign(res, { ready: false, noUsage: true });

    // days of cover D so the shares add up to the current total
    let lo = 0, hi = 1;
    while (valueAt(hi) < T && hi < 1e6) hi *= 2;
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (valueAt(mid) < T) lo = mid; else hi = mid; }
    const D = hi;

    const step = (s) => (s.unit === "roll" ? 1 : 50);
    const next = {};
    for (const s of BOX_STOCK) {
      const units = Math.max(minV(s), vr[s.id] * D) / s.dollars;
      next[s.id] = Math.max(MIN_UNITS[s.id], Math.round(units / step(s)) * step(s));
    }
    // Nudge back toward the original total one pack at a time, but only
    // while it's more than NUDGE_TOL off: forcing an exact dollar match
    // would keep shaving whichever item has the smallest pack (nickels).
    const NUDGE_TOL = 25;
    const cover = (s, n) => (vr[s.id] > 0 ? (n * s.dollars) / vr[s.id] : Infinity);
    for (let guard = 0; guard < 200; guard++) {
      const diff = T - sumDollars(next);
      if (Math.abs(diff) <= NUDGE_TOL) break;
      if (diff > 0) {
        const c = BOX_STOCK.filter((s) => vr[s.id] > 0 && s.dollars * step(s) <= diff)
          .sort((a, b) => cover(a, next[a.id]) - cover(b, next[b.id]))[0];
        if (!c) break;
        next[c.id] += step(c);
      } else if (diff < 0) {
        const c = BOX_STOCK.filter((s) => next[s.id] - step(s) >= MIN_UNITS[s.id] && s.dollars * step(s) <= -diff)
          .sort((a, b) => cover(b, next[b.id]) - cover(a, next[a.id]))[0];
        if (!c) break;
        next[c.id] -= step(c);
      } else break;
    }

    const rows = BOX_STOCK.map((s) => ({
      id: s.id, label: s.label,
      now: ideal[s.id], next: next[s.id],
      perDay: u.rate[s.id],
      coverNow: cover(s, ideal[s.id]), coverNext: cover(s, next[s.id]),
    }));
    const changed = rows.some((r) => r.now !== r.next);
    const finite = (xs) => xs.filter(Number.isFinite);
    const minNow = Math.min(...finite(rows.map((r) => r.coverNow)));
    const minNext = Math.min(...finite(rows.map((r) => r.coverNext)));
    return Object.assign(res, { next, rows, changed, total: sumDollars(next), currentTotal: T, minCoverNow: minNow, minCoverNext: minNext });
  }

  const Cash = {
    DRAWER_DENOMS, DENOM, BOX_STOCK, BOX_BIG, BOX_VALUE, DEFAULT_IDEAL, DEFAULT_RESET,
    MIN_LOGS, MIN_DAYS,
    sumCents, sumDollars, money, dollars, parseMoney, flagLevel,
    planReset, planOrder, packText, orderText, usageRates, suggestIdeal,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = Cash;
  else root.Cash = Cash;
})(typeof window !== "undefined" ? window : globalThis);
