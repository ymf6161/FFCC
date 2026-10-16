/** ISO UTC timestamp text, the only timestamp format we store. */
export const nowIso = (): string => new Date().toISOString();

/** YYYY-MM-DD from a Date, using UK local time (transaction dates are UK local). */
export function ukDate(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
