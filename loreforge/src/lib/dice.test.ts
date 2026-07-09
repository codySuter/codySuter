import { describe, it, expect } from "vitest";
import { roll, rollD20, rollDuality, abilityMod, isValidExpression, DiceParseError } from "./dice";

/** Deterministic RNG stepping through provided values (0..1). */
function seq(...values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

/** rng value that makes a die of `sides` land on `face`. */
const face = (value: number, sides: number) => (value - 1 + 0.5) / sides;

describe("roll parser", () => {
  it("rolls simple NdX+M", () => {
    const r = roll("2d6+3", seq(face(4, 6), face(2, 6)));
    expect(r.total).toBe(9);
    expect(r.terms).toHaveLength(2);
  });

  it("defaults count to 1 and handles d100", () => {
    const r = roll("d100", seq(face(73, 100)));
    expect(r.total).toBe(73);
  });

  it("supports keep-highest (4d6kh3)", () => {
    const r = roll("4d6kh3", seq(face(1, 6), face(4, 6), face(5, 6), face(6, 6)));
    expect(r.total).toBe(15);
    const dice = r.terms[0];
    if (dice.kind !== "dice") throw new Error("expected dice term");
    expect(dice.rolls.filter((x) => x.kept)).toHaveLength(3);
    expect(dice.rolls[0].kept).toBe(false);
  });

  it("supports keep-lowest for disadvantage (2d20kl1)", () => {
    const r = roll("2d20kl1", seq(face(17, 20), face(3, 20)));
    expect(r.total).toBe(3);
  });

  it("handles multiple dice terms and negative mods", () => {
    const r = roll("1d8+1d6-2", seq(face(8, 8), face(1, 6)));
    expect(r.total).toBe(7);
  });

  it("handles flat numbers", () => {
    expect(roll("5").total).toBe(5);
  });

  it("flags natural 20 and natural 1", () => {
    expect(roll("1d20+5", seq(face(20, 20))).nat20).toBe(true);
    expect(roll("1d20", seq(face(1, 20))).nat1).toBe(true);
    expect(roll("2d6", seq(face(6, 6), face(6, 6))).nat20).toBe(false);
  });

  it("rejects garbage", () => {
    expect(() => roll("banana")).toThrow(DiceParseError);
    expect(() => roll("2d")).toThrow(DiceParseError);
    expect(() => roll("1d20 2d6")).toThrow(DiceParseError);
    expect(isValidExpression("2d6+1")).toBe(true);
    expect(isValidExpression("nope")).toBe(false);
  });
});

describe("rollD20 advantage", () => {
  it("advantage keeps highest", () => {
    const r = rollD20(4, "advantage", seq(face(6, 20), face(15, 20)));
    expect(r.total).toBe(19);
  });
  it("disadvantage keeps lowest", () => {
    const r = rollD20(0, "disadvantage", seq(face(6, 20), face(15, 20)));
    expect(r.total).toBe(6);
  });
});

describe("Daggerheart duality", () => {
  it("rolls with hope when hope die is higher", () => {
    const r = rollDuality(2, "normal", seq(face(10, 12), face(4, 12)));
    expect(r.outcome).toBe("hope");
    expect(r.total).toBe(16);
  });

  it("rolls with fear when fear die is higher", () => {
    const r = rollDuality(0, "normal", seq(face(3, 12), face(9, 12)));
    expect(r.outcome).toBe("fear");
    expect(r.total).toBe(12);
  });

  it("doubles crit", () => {
    const r = rollDuality(1, "normal", seq(face(7, 12), face(7, 12)));
    expect(r.outcome).toBe("critical");
    expect(r.total).toBe(15);
  });

  it("advantage adds a d6, disadvantage subtracts", () => {
    const adv = rollDuality(0, "advantage", seq(face(5, 12), face(8, 12), face(4, 6)));
    expect(adv.total).toBe(17);
    expect(adv.bonusDie).toEqual({ kind: "advantage", value: 4 });
    const dis = rollDuality(0, "disadvantage", seq(face(5, 12), face(8, 12), face(4, 6)));
    expect(dis.total).toBe(9);
  });
});

describe("abilityMod", () => {
  it("computes 5e modifiers", () => {
    expect(abilityMod(10)).toBe(0);
    expect(abilityMod(8)).toBe(-1);
    expect(abilityMod(20)).toBe(5);
    expect(abilityMod(13)).toBe(1);
    expect(abilityMod(7)).toBe(-2);
  });
});
