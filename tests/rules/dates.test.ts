import { describe, expect, it } from "vitest";
import { daysBetween, financialYearOf, financialYearRange, lastDayOfMonthKey, monthOf } from "@/engine/dates";

/** Dates: months and financial years from YYYY-MM-DD strings; default year starts 6 April. */
describe("dates", () => {
  it("works out the financial year from the date string, default 6 April", () => {
    expect(financialYearOf("2026-04-05")).toBe(2025);
    expect(financialYearOf("2026-04-06")).toBe(2026);
    expect(financialYearOf("2026-12-31")).toBe(2026);
    expect(financialYearRange(2026)).toEqual({ from: "2026-04-06", to: "2027-04-05" });
  });
  it("supports a different start per household", () => {
    expect(financialYearOf("2026-01-01", { month: 1, day: 1 })).toBe(2026);
    expect(financialYearRange(2024, { month: 1, day: 1 })).toEqual({ from: "2024-01-01", to: "2024-12-31" });
  });
  it("gets months and month ends without time zones, including leap years", () => {
    expect(monthOf("2026-03-31")).toBe("2026-03");
    expect(lastDayOfMonthKey("2028-02")).toBe("2028-02-29");
    expect(lastDayOfMonthKey("2026-02")).toBe("2026-02-28");
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2); // across the UK clock change
  });
});
