/** Date helpers on `YYYY-MM-DD` strings. Calendar maths in UTC so there is no clock or DST drift. */

export function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

export function addMonths(date: string, months: number): string {
  const d = parseDate(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(Math.min(day, daysInMonth(d.getUTCFullYear(), d.getUTCMonth())));
  return formatDate(d);
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** A date in the given month, clamped to the month's length. */
export function dateInMonth(year: number, monthIndex: number, day: number): string {
  return formatDate(new Date(Date.UTC(year, monthIndex, Math.min(day, daysInMonth(year, monthIndex)))));
}

export function lastDayOfMonth(date: string): string {
  const d = parseDate(date);
  return dateInMonth(d.getUTCFullYear(), d.getUTCMonth(), 31);
}
