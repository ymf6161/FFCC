import { describe, expect, it } from "vitest";
import { lineKind, looksLikeRefund, merchantKey, normaliseMerchant } from "@/engine/merchant";

describe("normaliseMerchant", () => {
  it.each([
    ["FRESHWAYS SUPERMARKET ON 12/01", "FRESHWAYS SUPERMARKET"],
    ["CARD PAYMENT TO FRESHWAYS SUPERMARKET ON 12 JAN BCC", "FRESHWAYS SUPERMARKET"],
    ["BRIGHTSPARK ENERGY DD", "BRIGHTSPARK ENERGY"],
    ["TZEDAKAH FUND SO", "TZEDAKAH FUND"],
    ["TESCO STORES 3297 LONDON", "TESCO STORES"],
    ["REFUND LITTLE STEPS KIDSWEAR", "LITTLE STEPS KIDSWEAR"],
    ["Coffee Corner COFFEE CORNER", "COFFEE CORNER"],
    ["מכולת השכונה ON 12/01", "מכולת השכונה"],
    ["החזר חנות צעצועים", "חנות צעצועים"],
    ["מכולת", "מכולת"],
  ])("%s → %s", (raw, expected) => {
    expect(normaliseMerchant(raw)).toBe(expected);
  });

  it("gives a refund and its purchase the same key, in English and Hebrew", () => {
    expect(merchantKey(normaliseMerchant("REFUND FRESHWAYS SUPERMARKET"))).toBe(merchantKey(normaliseMerchant("FRESHWAYS SUPERMARKET ON 03/02")));
    expect(merchantKey(normaliseMerchant("החזר מכולת השכונה"))).toBe(merchantKey(normaliseMerchant("מכולת השכונה")));
  });

  it("recognises refunds and card-style lines", () => {
    expect(looksLikeRefund("REFUND X")).toBe(true);
    expect(looksLikeRefund("החזר חנות")).toBe(true);
    expect(looksLikeRefund("REFUNDABLE DEPOSIT")).toBe(false);
    expect(lineKind("FRESHWAYS SUPERMARKET", -100)).toBe("card");
    expect(lineKind("J COHEN FASTER PAYMENT", -100)).toBe("other");
    expect(lineKind("TZEDAKAH FUND SO", -100)).toBe("other");
    expect(lineKind("ACME SALARY", 100)).toBe("other");
  });
});
