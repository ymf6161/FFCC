import { describe, expect, it } from "vitest";
import { formatDate, formatFullDate } from "@/lib/dates";

describe("formatDate", () => {
  const today = "2026-10-16";
  it("says Today and Yesterday", () => {
    expect(formatDate("2026-10-16", today)).toBe("Today");
    expect(formatDate("2026-10-15", today)).toBe("Yesterday");
    expect(formatDate("2026-03-01", "2026-03-02")).toBe("Yesterday");
  });
  it("leaves out the year within the current year, day before month", () => {
    expect(formatDate("2026-02-03", today)).toBe("3 Feb");
    expect(formatDate("2025-12-31", today)).toBe("31 Dec 2025");
  });
  it("can skip the relative words", () => {
    expect(formatDate("2026-10-16", today, { relative: false })).toBe("16 Oct");
    expect(formatFullDate("2026-10-16")).toBe("16 Oct 2026");
  });
});
