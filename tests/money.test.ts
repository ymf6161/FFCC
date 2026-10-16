import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyRate, formatMoney, MINUS, parseAmountToPence } from "@/money";

describe("formatMoney", () => {
  it("formats pounds and pence with thousands separators", () => {
    expect(formatMoney(123456)).toBe("£1,234.56");
    expect(formatMoney(40)).toBe("£0.40");
    expect(formatMoney(1200)).toBe("£12.00");
    expect(formatMoney(0)).toBe("£0.00");
    expect(formatMoney(123456789012)).toBe("£1,234,567,890.12");
  });

  it("shows money out with a true minus sign, never a hyphen", () => {
    expect(formatMoney(-8640, { kind: "out" })).toBe(`${MINUS}£86.40`);
    expect(formatMoney(-8640, { kind: "out" })).not.toContain("-");
  });

  it("shows money in with a plus sign", () => {
    expect(formatMoney(385000, { kind: "in" })).toBe("+£3,850.00");
  });

  it("shows transfers with no sign", () => {
    expect(formatMoney(-50000, { kind: "transfer" })).toBe("£500.00");
    expect(formatMoney(50000, { kind: "transfer" })).toBe("£500.00");
  });

  it("shows negative balances with a minus and positive ones bare", () => {
    expect(formatMoney(-12000)).toBe(`${MINUS}£120.00`);
    expect(formatMoney(12000)).toBe("£120.00");
  });

  it("rounds to whole pounds only when asked", () => {
    expect(formatMoney(650049, { wholePounds: true })).toBe("£6,500");
    expect(formatMoney(650050, { wholePounds: true })).toBe("£6,501");
  });

  it("rejects anything that is not whole pence", () => {
    expect(() => formatMoney(1.5)).toThrow(TypeError);
    expect(() => formatMoney(Number.NaN)).toThrow(TypeError);
  });

  it("round-trips through the parser for any amount", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000_000 }), (pence) => {
        const parsed = parseAmountToPence(formatMoney(pence));
        expect(parsed).toEqual({ ok: true, pence });
      }),
    );
  });
});

describe("applyRate (the one rounding helper)", () => {
  it("rounds half away from zero to whole pence", () => {
    expect(applyRate(105, 1000)).toBe(11); // 10.5p -> 11p
    expect(applyRate(-105, 1000)).toBe(-11);
    expect(applyRate(104, 1000)).toBe(10);
    expect(applyRate(385000, 1000)).toBe(38500);
    expect(applyRate(1, 4999)).toBe(0);
    expect(applyRate(1, 5000)).toBe(1);
    expect(applyRate(-1, 4999)).toBe(0);
    expect(Object.is(applyRate(-1, 4999), -0)).toBe(false);
  });

  it("always returns a whole number within half a penny of the exact value", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e9, max: 1e9 }), fc.integer({ min: 0, max: 10_000 }), (pence, bp) => {
        const result = applyRate(pence, bp);
        expect(Number.isInteger(result)).toBe(true);
        // Compare in units of 1/10000 of a penny: half a penny is 5000.
        const diff = BigInt(result) * 10000n - BigInt(pence) * BigInt(bp);
        expect(diff <= 5000n && diff >= -5000n).toBe(true);
      }),
    );
  });

  it("is symmetric: the rate of a refund is the negative of the rate of the purchase", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e9 }), fc.integer({ min: 0, max: 10_000 }), (pence, bp) => {
        expect(applyRate(-pence, bp)).toBe(-applyRate(pence, bp) || 0);
      }),
    );
  });

  it("rejects fractional inputs", () => {
    expect(() => applyRate(10.5, 1000)).toThrow(TypeError);
    expect(() => applyRate(100, 10.5)).toThrow(TypeError);
  });
});

describe("parseAmountToPence", () => {
  it.each([
    ["40", 4000],
    ["40.00", 4000],
    ["£40", 4000],
    ["£ 40", 4000],
    ["40.5", 4050],
    ["0.07", 7],
    ["1,250.99", 125099],
    [" 12.30 ", 1230],
  ])("reads %j as %i pence", (input, pence) => {
    expect(parseAmountToPence(input)).toEqual({ ok: true, pence });
  });

  it.each(["", "abc", "12.345", "-5", "1,25", "£", "4 0", "1e3", "12.", ".5"])("rejects %j with a helpful message", (input) => {
    const result = parseAmountToPence(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Try something like 250\.00/);
  });
});
