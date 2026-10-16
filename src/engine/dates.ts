/**
 * Months and financial years from `YYYY-MM-DD` strings, never from timestamps
 * (BUILD_PLAN section 4, "Dates"). The financial year start is per household,
 * default 6 April.
 */

export const monthOf = (date: string): string => date.slice(0, 7);

export function lastDayOfMonthKey(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

/** The financial year a date falls in, named by the year it starts: 2026-04-05 → 2025 when it starts on 6 April. */
export function financialYearOf(date: string, start: { month: number; day: number } = { month: 4, day: 6 }): number {
  const year = Number(date.slice(0, 4));
  const startThisYear = `${year}-${String(start.month).padStart(2, "0")}-${String(start.day).padStart(2, "0")}`;
  return date >= startThisYear ? year : year - 1;
}

/** First and last day of the financial year starting in `year`. */
export function financialYearRange(year: number, start: { month: number; day: number } = { month: 4, day: 6 }): { from: string; to: string } {
  const from = `${year}-${String(start.month).padStart(2, "0")}-${String(start.day).padStart(2, "0")}`;
  const next = new Date(Date.UTC(year + 1, start.month - 1, start.day));
  next.setUTCDate(next.getUTCDate() - 1);
  return { from, to: next.toISOString().slice(0, 10) };
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function addDaysTo(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
