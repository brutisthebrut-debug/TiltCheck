import { describe, expect, it } from "vitest";
import {
  activeLegOdds,
  americanToDecimal,
  americanToFractional,
  bookDecimal,
  combineAmerican,
  combineDecimalBookStyle,
  combineDecimalExact,
  decimalToAmerican,
  formatOddsAs,
  isValidAmericanOdds,
  parlayPayoutExact,
  parseOddsInput,
  payoutFromAmerican,
} from "../index";

describe("american <-> decimal", () => {
  it("converts favorites and dogs exactly", () => {
    expect(americanToDecimal(-110)).toBeCloseTo(1.9090909, 6);
    expect(americanToDecimal(+150)).toBe(2.5);
    expect(americanToDecimal(-200)).toBe(1.5);
    expect(americanToDecimal(+100)).toBe(2);
  });

  it("round-trips through decimal", () => {
    for (const odds of [-110, -105, -250, +100, +125, +900]) {
      expect(decimalToAmerican(americanToDecimal(odds))).toBe(odds);
    }
    // -100 and +100 are the same price (evens); +100 is canonical.
    expect(decimalToAmerican(americanToDecimal(-100))).toBe(100);
  });

  it("snaps book decimals to the standard American price", () => {
    expect(decimalToAmerican(1.91)).toBe(-110); // bet365's -110
    expect(decimalToAmerican(2.5)).toBe(150);
    expect(decimalToAmerican(1.5)).toBe(-200);
    expect(decimalToAmerican(2.0)).toBe(100);
  });

  it("shows 2-dp book prices", () => {
    expect(bookDecimal(-110)).toBe(1.91);
    expect(bookDecimal(+150)).toBe(2.5);
  });
});

describe("validation", () => {
  it("rejects the dead zone and non-integers", () => {
    expect(isValidAmericanOdds(0)).toBe(false);
    expect(isValidAmericanOdds(50)).toBe(false);
    expect(isValidAmericanOdds(-99)).toBe(false);
    expect(isValidAmericanOdds(-110.5)).toBe(false);
    expect(isValidAmericanOdds(-100)).toBe(true);
    expect(isValidAmericanOdds(100)).toBe(true);
  });
});

describe("parlay combination", () => {
  const legs = [-110, -110, -110];

  it("exact combination matches the server formula", () => {
    const exact = combineDecimalExact(legs);
    expect(exact).toBeCloseTo(Math.pow(21 / 11, 3), 10);
    expect(combineAmerican(legs)).toBe(Math.round((exact - 1) * 100));
  });

  it("book-style multiplies displayed 2-dp prices", () => {
    expect(combineDecimalBookStyle(legs)).toBeCloseTo(1.91 ** 3, 10);
  });

  it("payout equals exact decimal times stake (no double rounding)", () => {
    const stake = 50;
    const exactPayout = parlayPayoutExact(legs, stake);
    expect(exactPayout).toBeCloseTo(combineDecimalExact(legs) * stake, 10);
    // The old client bug: payout computed from the rounded American price.
    const rounded = combineAmerican(legs);
    const doubleRounded = (rounded / 100) * stake + stake;
    expect(Math.abs(exactPayout - doubleRounded)).toBeGreaterThan(0);
  });

  it("two-leg favorite math", () => {
    // -110 x -110 = 3.6446... -> +264
    expect(combineAmerican([-110, -110])).toBe(264);
  });
});

describe("single-bet payout", () => {
  it("includes the stake", () => {
    expect(payoutFromAmerican(-110, 110)).toBeCloseTo(210, 6);
    expect(payoutFromAmerican(+150, 100)).toBe(250);
  });
});

describe("parseOddsInput", () => {
  it("parses american", () => {
    expect(parseOddsInput("-110", "american")).toEqual({ ok: true, american: -110 });
    expect(parseOddsInput("+150", "american")).toEqual({ ok: true, american: 150 });
    expect(parseOddsInput("150", "american")).toEqual({ ok: true, american: 150 });
  });

  it("rejects dead-zone and decimal-looking american input", () => {
    expect(parseOddsInput("50", "american").ok).toBe(false);
    expect(parseOddsInput("0", "american").ok).toBe(false);
    expect(parseOddsInput("1.91", "american").ok).toBe(false);
  });

  it("parses decimal", () => {
    expect(parseOddsInput("1.91", "decimal")).toEqual({ ok: true, american: -110 });
    expect(parseOddsInput("2.50", "decimal")).toEqual({ ok: true, american: 150 });
    expect(parseOddsInput("2", "decimal")).toEqual({ ok: true, american: 100 });
  });

  it("rejects impossible decimals", () => {
    expect(parseOddsInput("1", "decimal").ok).toBe(false);
    expect(parseOddsInput("0.5", "decimal").ok).toBe(false);
    expect(parseOddsInput("-1.91", "decimal").ok).toBe(false);
  });

  it("parses fractional", () => {
    expect(parseOddsInput("10/11", "fractional")).toEqual({ ok: true, american: -110 });
    expect(parseOddsInput("3/2", "fractional")).toEqual({ ok: true, american: 150 });
    expect(parseOddsInput("1/1", "fractional")).toEqual({ ok: true, american: 100 });
    expect(parseOddsInput("10 / 11", "fractional")).toEqual({ ok: true, american: -110 });
  });

  it("rejects malformed fractions", () => {
    expect(parseOddsInput("10/0", "fractional").ok).toBe(false);
    expect(parseOddsInput("ten/eleven", "fractional").ok).toBe(false);
    expect(parseOddsInput("1.91", "fractional").ok).toBe(false);
  });

  it("rejects blanks", () => {
    expect(parseOddsInput("  ", "american").ok).toBe(false);
  });
});

describe("display", () => {
  it("formats in each preference", () => {
    expect(formatOddsAs(-110, "american")).toBe("-110");
    expect(formatOddsAs(150, "american")).toBe("+150");
    expect(formatOddsAs(-110, "decimal")).toBe("1.91");
    expect(formatOddsAs(150, "decimal")).toBe("2.50");
    expect(formatOddsAs(-110, "fractional")).toBe("10/11");
    expect(formatOddsAs(150, "fractional")).toBe("3/2");
    expect(formatOddsAs(100, "fractional")).toBe("1/1");
  });

  it("americanToFractional reduces", () => {
    expect(americanToFractional(-250)).toBe("2/5");
    expect(americanToFractional(600)).toBe("6/1");
  });
});

describe("activeLegOdds — pushed/voided legs come off the ticket", () => {
  it("drops pushed and voided legs, keeps everything else", () => {
    const legs = [
      { odds: 100, status: "won" },
      { odds: -110, status: "push" },
      { odds: 150, status: "void" },
      { odds: -200, status: "pending" },
    ];
    expect(activeLegOdds(legs)).toEqual([100, -200]);
  });

  it("mixed push reduces a parlay's combined price and payout", () => {
    // Two +100 legs: full ticket pays 4.0x. One pushes -> pays like a
    // single +100 bet: 2.0x.
    const legs = [
      { odds: 100, status: "won" },
      { odds: 100, status: "push" },
    ];
    const remaining = activeLegOdds(legs);
    expect(combineDecimalExact(remaining)).toBeCloseTo(2.0, 10);
    expect(parlayPayoutExact(remaining, 50)).toBeCloseTo(100, 2);
  });

  it("single remaining leg keeps its own price", () => {
    const remaining = activeLegOdds([
      { odds: -110, status: "won" },
      { odds: 130, status: "void" },
    ]);
    expect(remaining).toEqual([-110]);
    expect(combineAmerican(remaining)).toBe(-110);
  });

  it("all legs pushed leaves nothing to combine — the ticket is a refund", () => {
    expect(
      activeLegOdds([
        { odds: 100, status: "push" },
        { odds: -110, status: "push" },
      ])
    ).toEqual([]);
  });

  it("no pushes leaves the ticket untouched", () => {
    expect(
      activeLegOdds([
        { odds: 100, status: "won" },
        { odds: -110, status: "won" },
      ])
    ).toEqual([100, -110]);
  });
});
