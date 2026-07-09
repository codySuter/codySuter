/**
 * Dice engine for Loreforge.
 *
 * Supports standard notation ("2d6+3", "1d20", "4d6kh3", "2d20kl1", "d100",
 * "1d8+1d6+2", flat modifiers), D&D advantage/disadvantage, and Daggerheart
 * Duality Dice (2d12 Hope/Fear, doubles crit, ±d6 advantage/disadvantage).
 */

export type RNG = () => number;

export interface DieRoll {
  value: number;
  kept: boolean;
}

export interface DiceTerm {
  kind: "dice";
  sign: 1 | -1;
  count: number;
  sides: number;
  keep?: { mode: "h" | "l"; n: number };
  rolls: DieRoll[];
  subtotal: number;
}

export interface ModTerm {
  kind: "mod";
  sign: 1 | -1;
  value: number;
}

export type Term = DiceTerm | ModTerm;

export interface RollResult {
  expression: string;
  total: number;
  terms: Term[];
  /** Natural 20 / natural 1 on a single d20 (for crit styling). */
  nat20: boolean;
  nat1: boolean;
  breakdown: string;
}

export class DiceParseError extends Error {}

const TERM_RE = /^([+-]?)\s*(?:(\d*)d(\d+)(?:(kh|kl|k)(\d+))?|(\d+))\s*/i;

/** Parse and roll a dice expression. Throws DiceParseError on invalid input. */
export function roll(expression: string, rng: RNG = Math.random): RollResult {
  const cleaned = expression.trim().toLowerCase().replace(/\s+/g, "");
  if (cleaned.length === 0) throw new DiceParseError("Empty dice expression");
  let rest = cleaned;
  const terms: Term[] = [];
  let first = true;
  let guard = 0;
  while (rest.length > 0) {
    if (++guard > 64) throw new DiceParseError("Expression too long");
    const match = TERM_RE.exec(rest);
    if (!match || match[0].length === 0) {
      throw new DiceParseError(`Can't read "${rest}" — try something like 2d6+3`);
    }
    const [token, signRaw, countRaw, sidesRaw, keepRaw, keepNRaw, flatRaw] = match;
    if (!first && signRaw === "") {
      throw new DiceParseError(`Missing + or - before "${rest}"`);
    }
    const sign: 1 | -1 = signRaw === "-" ? -1 : 1;
    if (flatRaw !== undefined) {
      terms.push({ kind: "mod", sign, value: parseInt(flatRaw, 10) });
    } else {
      const count = countRaw === "" || countRaw === undefined ? 1 : parseInt(countRaw, 10);
      const sides = parseInt(sidesRaw, 10);
      if (count < 1 || count > 100) throw new DiceParseError("Dice count must be 1-100");
      if (sides < 2 || sides > 1000) throw new DiceParseError("Dice must have 2-1000 sides");
      let keep: DiceTerm["keep"];
      if (keepRaw) {
        const mode = keepRaw === "kl" ? "l" : "h";
        const n = Math.min(parseInt(keepNRaw!, 10), count);
        if (n < 1) throw new DiceParseError("Keep count must be at least 1");
        keep = { mode, n };
      }
      const rolls: DieRoll[] = [];
      for (let i = 0; i < count; i++) {
        rolls.push({ value: 1 + Math.floor(rng() * sides), kept: true });
      }
      if (keep) {
        const sorted = rolls
          .map((r, i) => ({ i, v: r.value }))
          .sort((a, b) => (keep!.mode === "h" ? b.v - a.v : a.v - b.v));
        const keptIdx = new Set(sorted.slice(0, keep.n).map((x) => x.i));
        rolls.forEach((r, i) => (r.kept = keptIdx.has(i)));
      }
      const subtotal = rolls.filter((r) => r.kept).reduce((sum, r) => sum + r.value, 0);
      terms.push({ kind: "dice", sign, count, sides, keep, rolls, subtotal });
    }
    rest = rest.slice(token.length);
    first = false;
  }

  const total = terms.reduce(
    (sum, t) => sum + t.sign * (t.kind === "dice" ? t.subtotal : t.value),
    0,
  );

  const d20Terms = terms.filter(
    (t): t is DiceTerm => t.kind === "dice" && t.sides === 20,
  );
  const keptD20 = d20Terms.flatMap((t) => t.rolls.filter((r) => r.kept));
  const nat20 = keptD20.length === 1 && keptD20[0].value === 20;
  const nat1 = keptD20.length === 1 && keptD20[0].value === 1;

  return {
    expression: prettyExpression(terms),
    total,
    terms,
    nat20,
    nat1,
    breakdown: breakdownOf(terms),
  };
}

function prettyExpression(terms: Term[]): string {
  return terms
    .map((t, i) => {
      const sign = i === 0 ? (t.sign < 0 ? "-" : "") : t.sign < 0 ? " − " : " + ";
      if (t.kind === "mod") return `${sign}${t.value}`;
      const keep = t.keep ? `k${t.keep.mode}${t.keep.n}` : "";
      return `${sign}${t.count}d${t.sides}${keep}`;
    })
    .join("");
}

function breakdownOf(terms: Term[]): string {
  return terms
    .map((t, i) => {
      const sign = i === 0 ? (t.sign < 0 ? "-" : "") : t.sign < 0 ? " − " : " + ";
      if (t.kind === "mod") return `${sign}${t.value}`;
      const inner = t.rolls
        .map((r) => (r.kept ? `${r.value}` : `~${r.value}~`))
        .join(", ");
      return `${sign}[${inner}]`;
    })
    .join("");
}

/** Roll d20 with advantage/disadvantage plus a modifier. */
export function rollD20(
  modifier: number,
  mode: "normal" | "advantage" | "disadvantage" = "normal",
  rng: RNG = Math.random,
): RollResult {
  const modSuffix = modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : "";
  if (mode === "normal") return roll(`1d20${modSuffix}`, rng);
  const keep = mode === "advantage" ? "kh1" : "kl1";
  return roll(`2d20${keep}${modSuffix}`, rng);
}

export interface DualityResult {
  hope: number;
  fear: number;
  modifier: number;
  bonusDie?: { kind: "advantage" | "disadvantage"; value: number };
  total: number;
  outcome: "critical" | "hope" | "fear";
  breakdown: string;
}

/**
 * Daggerheart Duality Dice: 2d12 (Hope die + Fear die) + modifier.
 * Doubles = critical success. Otherwise the higher die decides whether you
 * roll "with Hope" or "with Fear". Advantage adds +1d6, disadvantage −1d6.
 */
export function rollDuality(
  modifier = 0,
  mode: "normal" | "advantage" | "disadvantage" = "normal",
  rng: RNG = Math.random,
): DualityResult {
  const d12 = () => 1 + Math.floor(rng() * 12);
  const hope = d12();
  const fear = d12();
  let bonusDie: DualityResult["bonusDie"];
  let total = hope + fear + modifier;
  if (mode !== "normal") {
    const value = 1 + Math.floor(rng() * 6);
    bonusDie = { kind: mode === "advantage" ? "advantage" : "disadvantage", value };
    total += mode === "advantage" ? value : -value;
  }
  const outcome: DualityResult["outcome"] =
    hope === fear ? "critical" : hope > fear ? "hope" : "fear";
  const parts = [`Hope ${hope}`, `Fear ${fear}`];
  if (modifier !== 0) parts.push(modifier > 0 ? `+${modifier}` : `${modifier}`);
  if (bonusDie) {
    parts.push(
      bonusDie.kind === "advantage" ? `adv +${bonusDie.value}` : `dis −${bonusDie.value}`,
    );
  }
  return { hope, fear, modifier, bonusDie, total, outcome, breakdown: parts.join(" · ") };
}

/** Ability score → modifier (D&D). */
export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function formatMod(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

/** Quick validity check used by inline dice chip editing. */
export function isValidExpression(expression: string): boolean {
  try {
    roll(expression, () => 0.5);
    return true;
  } catch {
    return false;
  }
}
