/**
 * Unit tests for the money math in web/js/cash.js — no browser needed.
 * Usage: node tests/unit.mjs
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
// The repo root package.json is "type": "module", so cash.js loads as ESM
// and attaches itself to globalThis instead of module.exports.
const loaded = require("../web/js/cash.js");
const Cash = loaded && loaded.planReset ? loaded : globalThis.Cash;

let failed = 0, passed = 0;
function ok(name, cond, extra) {
  if (cond) passed++;
  else { failed++; console.log(`  ✗ FAIL ${name}${extra !== undefined ? " — " + JSON.stringify(extra) : ""}`); }
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });

const R = Cash.DEFAULT_RESET;
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));

/* ---------- parseMoney / money ---------- */
eq("parse $412.35", Cash.parseMoney("$412.35"), 41235);
eq("parse 1,200", Cash.parseMoney("1,200"), 120000);
eq("parse .5", Cash.parseMoney(".5"), 50);
eq("parse 7.", Cash.parseMoney("7."), 700);
eq("parse -2.10", Cash.parseMoney("-2.10"), -210);
eq("parse junk", Cash.parseMoney("12a"), null);
eq("parse 3 decimals", Cash.parseMoney("1.234"), null);
eq("parse empty", Cash.parseMoney("  "), null);
eq("money", Cash.money(123450), "$1,234.50");
eq("money neg", Cash.money(-200), "−$2.00");
eq("money signed", Cash.money(200, { sign: true }), "+$2.00");
eq("dollars", Cash.dollars(2170), "$2,170");

/* ---------- flags ---------- */
eq("flag exact", Cash.flagLevel(0), "good");
eq("flag $1 is green", Cash.flagLevel(-100), "good");
eq("flag $1.05 yellow", Cash.flagLevel(105), "warn");
eq("flag $5 yellow", Cash.flagLevel(-500), "warn");
eq("flag $5.05 red", Cash.flagLevel(505), "bad");
eq("flag custom", Cash.flagLevel(300, { green: 0, yellow: 200 }), "bad");

/* ---------- recipe itself adds to $150 ---------- */
eq("reset recipe = $150", Cash.sumCents(R), 15000);

/* ---------- planReset ---------- */
{
  // A normal end of shift: recipe plus sales on top.
  const counts = { b100: 1, b50: 0, b20: 12, b10: 5, b5: 10, b1: 75, cq: 60, cd: 55, cn: 52 };
  const p = Cash.planReset(counts, R, 15000);
  ok("normal: exact $150", p.exact && p.leaveCents === 15000, p);
  eq("normal: leaves the recipe", pick(p.leave, ["b10", "b5", "b1", "cq", "cd", "cn", "b20", "b100"]), { b10: 3, b5: 8, b1: 60, cq: 50, cd: 50, cn: 50, b20: 0, b100: 0 });
  eq("normal: pull adds up", p.pullCents, Cash.sumCents(counts) - 15000);
  eq("normal: pull all big bills", pick(p.pull, ["b100", "b20"]), { b100: 1, b20: 12 });
}
{
  // Short on ones: must still land on exactly $150 using other small stuff.
  const counts = { b20: 6, b10: 6, b5: 12, b1: 38, cq: 60, cd: 50, cn: 50 };
  const p = Cash.planReset(counts, R, 15000);
  ok("few ones: still exact", p.exact, p);
  eq("few ones: keeps every one", p.leave.b1, 38);
  ok("few ones: no twenties left", p.leave.b20 === 0, p.leave);
  let sum = 0; for (const k in p.leave) sum += p.leave[k] * Cash.DENOM[k].cents;
  eq("few ones: leave sums to $150", sum, 15000);
}
{
  // Under $150: everything stays, nothing to pull.
  const counts = { b10: 3, b5: 8, b1: 50, cq: 40 };
  const p = Cash.planReset(counts, R, 15000);
  eq("under: pull nothing", p.pullCents, 0);
  eq("under: short by", p.shortCents, 15000 - (3000 + 4000 + 5000 + 1000));
  ok("under: not exact", !p.exact);
}
{
  // Only big bills — $150 can't be made exactly.
  const counts = { b20: 10, b100: 1 };
  const p = Cash.planReset(counts, R, 15000);
  ok("impossible: flagged not exact", !p.exact, p);
  ok("impossible: closest under", p.leaveCents <= 15000 && p.leaveCents >= 14000, p.leaveCents);
  eq("impossible: short amount", p.shortCents, 15000 - p.leaveCents);
}
{
  // Coin rolls count: a drawer with rolls but few loose coins.
  const counts = { b10: 3, b5: 8, b1: 60, rq: 1, rd: 1, rn: 1, cq: 4, cd: 5, cn: 10, b20: 3 };
  const p = Cash.planReset(counts, R, 15000);
  ok("rolls: exact", p.exact, p);
  let sum = 0; for (const k in p.leave) sum += p.leave[k] * Cash.DENOM[k].cents;
  eq("rolls: leave sums to $150", sum, 15000);
}
{
  // Exactly $150 in the drawer, not in recipe shape: nothing to pull.
  const counts = { b20: 2, b10: 5, b5: 4, b1: 40 };
  const p = Cash.planReset(counts, R, 15000);
  ok("exact total: nothing pulled", p.exact && p.pullCents === 0, p);
}

{
  // Randomised drawers: leave + pull always equals what was counted, nothing
  // negative, and whenever a drawer holds $150+ in small stuff it's exact.
  let seed = 11;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  let bad = 0;
  for (let i = 0; i < 400; i++) {
    const counts = { b100: rnd(2), b50: rnd(2), b20: rnd(15), b10: rnd(8), b5: rnd(14), b1: rnd(110), rq: rnd(2), rd: rnd(2), rn: rnd(2), cq: rnd(90), cd: rnd(80), cn: rnd(80) };
    const p = Cash.planReset(counts, R, 15000);
    let okk = p.leaveCents + p.pullCents === Cash.sumCents(counts);
    for (const k in counts) okk = okk && p.leave[k] >= 0 && p.pull[k] >= 0 && p.leave[k] + p.pull[k] === counts[k];
    const smallCents = Cash.sumCents(Object.assign({}, counts, { b100: 0, b50: 0, b20: 0 }));
    if (smallCents >= 15000 && counts.cn >= 20) okk = okk && p.exact;
    if (!okk) { bad++; if (bad < 3) console.log("    bad reset", JSON.stringify(counts)); }
  }
  eq("random drawers: all consistent", bad, 0);
}

/* ---------- planOrder ---------- */
const I = Cash.DEFAULT_IDEAL;
eq("default ideal total", Cash.sumDollars(I), 2170);
{
  const p = Cash.planOrder(I, I);
  ok("ideal box: nothing to order", p.nothingToOrder && p.takeValue === 0 && p.variance === 0, p);
}
{
  // Balanced box (total = ideal): drawers took rolls/ones/fives and left big bills.
  const have = { rq: 14, rd: 8, rn: 10, b1: 320, b5: 92, b10: 100, b20: 7, b50: 1 };
  const p = Cash.planOrder(have, I);
  eq("balanced: variance 0", p.variance, 0);
  ok("balanced: even swap", p.even && p.orderValue === 190 && p.takeValue === 190, p);
  eq("balanced: orders the exact shortfall", pick(p.order, ["rq", "rd", "rn", "b1", "b5", "b10"]), { rq: 6, rd: 2, rn: 0, b1: 80, b5: 8, b10: 0 });
  eq("balanced: takes all big bills", pick(p.take, ["b20", "b50", "b100"]), { b20: 7, b50: 1, b100: 0 });
  eq("balanced: box back to ideal", pick(p.after, ["rq", "rd", "rn", "b1", "b5", "b10"]), I);
}
{
  // Box over by a lot of twenties: order rounded up to half straps.
  const have = { rq: 14, rd: 10, rn: 10, b1: 330, b5: 100, b10: 100, b20: 10 };
  const p = Cash.planOrder(have, I);
  // short: 6 rolls Q ($60) + 70 ones → 100 ones ($100) = $160; 8×$20 = $160.
  ok("over: even", p.even, p);
  eq("over: ones in a full strap", p.order.b1, 100);
  eq("over: takes 8 twenties", p.take.b20, 8);
  eq("over: 2 twenties stay", p.leftBig, [{ id: "b20", n: 2 }]);
  eq("over: variance +", p.variance, 70);
}
{
  // Needs an extra few ones to come out even (bills don't divide evenly).
  const have = { rq: 19, rd: 10, rn: 10, b1: 400, b5: 100, b10: 100, b20: 1 };
  const p = Cash.planOrder(have, I);
  // short: 1 roll Q = $10; only a $20 to take → add 10 ones.
  ok("even-up: even", p.even && p.takeValue === 20, p);
  eq("even-up: +10 ones", p.order.b1, 10);
  ok("even-up: note", p.notes.some((n) => /extra/.test(n.text)), p.notes);
}
{
  // Too many tens (well over threshold) go to the bank too.
  const have = { rq: 10, rd: 10, rn: 10, b1: 400, b5: 100, b10: 140 };
  const p = Cash.planOrder(have, I, { excessThreshold: 25 });
  // short 10 rolls Q = $100; 40 extra tens = $400 ≥ 100 → take 10 tens.
  ok("excess tens: even", p.even && p.take.b10 === 10 && p.orderValue === 100, p);
}
{
  // A few spare tens (under the "too many" line) pay for half-strap rounding.
  const have = { rq: 20, rd: 10, rn: 10, b1: 370, b5: 100, b10: 110, b20: 1, b50: 0 };
  const p = Cash.planOrder(have, I, { excessThreshold: 25 });
  // short 30 ones → 50 ($50). Primary = $20. Secondary: 10 spare tens ($100).
  ok("secondary: even", p.even, p);
  eq("secondary: half strap of ones", p.order.b1, 50);
  eq("secondary: takes the twenty + 3 tens", pick(p.take, ["b20", "b10"]), { b20: 1, b10: 3 });
}
{
  // Box short (human error): not enough to take for everything that's low.
  const have = { rq: 10, rd: 5, rn: 10, b1: 300, b5: 100, b10: 100, b20: 5 };
  const p = Cash.planOrder(have, I);
  ok("short box: even", p.even && p.orderValue === 100, p);
  ok("short box: variance negative", p.variance < 0, p.variance);
  ok("short box: warns", p.notes.some((n) => n.kind === "warn"), p.notes);
  // The emptiest (dimes at 50%) should be served before the fullest.
  ok("short box: dimes ordered", p.order.rd > 0, p.order);
}
{
  // Full-strap rounding option.
  const have = { rq: 20, rd: 10, rn: 10, b1: 370, b5: 100, b10: 100, b20: 10 };
  const p = Cash.planOrder(have, I, { billRound: 100 });
  eq("strap rounding: 100 ones", p.order.b1, 100);
  ok("strap rounding: even", p.even, p);
}
{
  // Randomised: every plan must be an even swap, never negative, and the
  // box after must equal before + order − take.
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  let bad = 0;
  for (let i = 0; i < 3000; i++) {
    const have = { rq: rnd(25), rd: rnd(14), rn: rnd(14), b1: rnd(460), b5: rnd(150), b10: rnd(160), b20: rnd(30), b50: rnd(4), b100: rnd(3) };
    const p = Cash.planOrder(have, I, { billRound: [1, 50, 100][rnd(3)], excessThreshold: rnd(40) });
    const neg = Object.values(p.order).some((n) => n < 0) || Object.values(p.take).some((n) => n < 0) || Object.values(p.after).some((n) => n < 0);
    const tooMuch = Object.keys(p.take).some((id) => p.take[id] > have[id]);
    const consistent = p.afterTotal === p.boxTotal + p.orderValue - p.takeValue;
    if (!p.even || neg || tooMuch || !consistent) { bad++; if (bad < 3) console.log("    bad plan", JSON.stringify({ have, order: p.order, take: p.take })); }
  }
  eq("random plans: all even & sane", bad, 0);
}

/* ---------- packText / orderText ---------- */
eq("pack roll", Cash.packText("rq", 6), "6 rolls");
eq("pack strap+half", Cash.packText("b1", 150), "1 strap + 1 half strap");
eq("pack loose", Cash.packText("b10", 37), "37 bills");
eq("pack mix", Cash.packText("b1", 213), "2 straps + 13 bills");
{
  const p = Cash.planOrder({ rq: 14, rd: 8, rn: 10, b1: 320, b5: 92, b10: 100, b20: 7, b50: 1 }, I);
  const t = Cash.orderText(p);
  ok("orderText has quarters", /Quarters: 6 rolls \(\$60\)/.test(t), t);
  ok("orderText has bank bills", /7 × \$20 \(\$140\)/.test(t), t);
}

/* ---------- suggestIdeal ---------- */
{
  const day = 86400000;
  const t0 = Date.UTC(2026, 0, 1);
  // Not enough data yet.
  const s0 = Cash.suggestIdeal([{ ts: t0, have: I, after: I }], I);
  ok("suggest: not ready", !s0.ready && s0.needLogs === 2, s0);

  // Dimes run out fast, nickels barely move, tens come back.
  const logs = [];
  let after = Object.assign({}, I);
  for (let i = 0; i < 6; i++) {
    const have = { rq: after.rq - 8, rd: after.rd - 6, rn: after.rn - 1, b1: after.b1 - 150, b5: after.b5 - 20, b10: after.b10 + 5 };
    logs.push({ ts: t0 + i * 7 * day, have, after: Object.assign({}, I) });
    after = Object.assign({}, I);
  }
  const s = Cash.suggestIdeal(logs, I);
  ok("suggest: ready", s.ready, s);
  ok("suggest: changed", s.changed);
  ok("suggest: more dimes", s.next.rd > I.rd, s.next);
  ok("suggest: fewer nickels", s.next.rn < I.rn, s.next);
  ok("suggest: tens at minimum", s.next.b10 === 50, s.next);
  ok("suggest: bills in half straps", s.next.b1 % 50 === 0 && s.next.b5 % 50 === 0, s.next);
  ok("suggest: total close to current", Math.abs(s.total - 2170) <= 50, s.total);
  ok("suggest: shortest cover improves", s.minCoverNext > s.minCoverNow, [s.minCoverNow, s.minCoverNext]);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
