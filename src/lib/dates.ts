const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Dates as DESIGN.md asks: "16 Oct 2026", or "16 Oct" within the current
 * year, "Today", "Yesterday". Day before month, always. Works on YYYY-MM-DD
 * strings so there is no time-zone drift.
 */
export function formatDate(date: string, today: string, { relative = true }: { relative?: boolean } = {}): string {
  if (relative) {
    if (date === today) return "Today";
    const t = new Date(`${today}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() - 1);
    if (date === t.toISOString().slice(0, 10)) return "Yesterday";
  }
  const [y, m, d] = date.split("-");
  const short = `${Number(d)} ${MONTHS[Number(m) - 1]}`;
  return y === today.slice(0, 4) ? short : `${short} ${y}`;
}

/** "16 Oct 2026" always, for ranges and records. */
export function formatFullDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}
