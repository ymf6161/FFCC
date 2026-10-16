import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Money } from "@/components/money";
import { formatHeroParts, MINUS, moneySign } from "@/money";

describe("moneySign", () => {
  it("is + for money in, − for money out, none for transfers, − for negative balances", () => {
    expect(moneySign(385000, "in")).toBe("+");
    expect(moneySign(-8640, "out")).toBe(MINUS);
    expect(moneySign(8640, "out")).toBe(MINUS); // out is always shown as out
    expect(moneySign(0, "out")).toBe("");
    expect(moneySign(-50000, "transfer")).toBe("");
    expect(moneySign(-12000, "balance")).toBe(MINUS);
    expect(moneySign(12000, "balance")).toBe("");
  });
});

describe("formatHeroParts", () => {
  it("uses the same sign rule as list rows", () => {
    expect(formatHeroParts(385000, "in")).toEqual({ sign: "+", pounds: "£3,850", pence: "00" });
    expect(formatHeroParts(-421836, "out")).toEqual({ sign: MINUS, pounds: "£4,218", pence: "36" });
    expect(formatHeroParts(421836, "out").sign).toBe(MINUS);
    expect(formatHeroParts(50000, "transfer").sign).toBe("");
    expect(formatHeroParts(-120, "balance")).toEqual({ sign: MINUS, pounds: "£1", pence: "20" });
  });
});

const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("<Money>", () => {
  for (const size of ["hero", "figure", "row"] as const) {
    it(`shows + for money in and − for money out at ${size} size`, () => {
      const moneyIn = text(renderToStaticMarkup(<Money pence={385000} kind="in" size={size} />));
      const moneyOut = text(renderToStaticMarkup(<Money pence={-8640} kind="out" size={size} />));
      expect(moneyIn.startsWith("+£3,850")).toBe(true);
      expect(moneyOut.startsWith(`${MINUS}£86`)).toBe(true);
      expect(moneyOut).not.toContain("-");
    });
  }

  it("shows the pence on hero figures", () => {
    expect(text(renderToStaticMarkup(<Money pence={421836} kind="balance" size="hero" />))).toBe("£4,218.36");
  });
});
