/**
 * Reading dates and amounts from bank CSVs. Amounts become integer pence by
 * parsing the text; no floats are involved (CLAUDE.md money rule 1).
 */

export const DATE_FORMATS = ["dd/mm/yyyy", "dd/mm/yy", "yyyy-mm-dd", "dd-mm-yyyy", "d mmm yyyy", "d mmm yy"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  "dd/mm/yyyy": "16/10/2026",
  "dd/mm/yy": "16/10/26",
  "yyyy-mm-dd": "2026-10-16",
  "dd-mm-yyyy": "16-10-2026",
  "d mmm yyyy": "16 Oct 2026",
  "d mmm yy": "16 Oct 26",
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function isoIfValid(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || year < 1900 || year > 2200) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Two-digit years are 2000–2099; bank exports never reach back to the 1900s. */
const fullYear = (yy: number) => 2000 + yy;

/** Parses a date in the given format to YYYY-MM-DD, or null if it isn't a real date. */
export function parseDate(raw: string, format: DateFormat): string | null {
  const text = raw.trim();
  let m: RegExpMatchArray | null;
  switch (format) {
    case "dd/mm/yyyy":
      m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      return m ? isoIfValid(+m[3]!, +m[2]!, +m[1]!) : null;
    case "dd/mm/yy":
      m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
      return m ? isoIfValid(fullYear(+m[3]!), +m[2]!, +m[1]!) : null;
    case "yyyy-mm-dd":
      m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
      return m ? isoIfValid(+m[1]!, +m[2]!, +m[3]!) : null;
    case "dd-mm-yyyy":
      m = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
      return m ? isoIfValid(+m[3]!, +m[2]!, +m[1]!) : null;
    case "d mmm yyyy":
    case "d mmm yy": {
      m = text.match(/^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ -](\d{2,4})$/);
      if (!m) return null;
      const month = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;
      const yearText = m[3]!;
      if (format === "d mmm yyyy" ? yearText.length !== 4 : yearText.length !== 2) return null;
      const year = yearText.length === 2 ? fullYear(+yearText) : +yearText;
      return isoIfValid(year, month, +m[1]!);
    }
  }
}

/** The formats that read every sample value as a real date. */
export function guessDateFormats(samples: string[]): DateFormat[] {
  const values = samples.map((s) => s.trim()).filter(Boolean);
  if (values.length === 0) return [];
  return DATE_FORMATS.filter((f) => values.every((v) => parseDate(v, f) !== null));
}

const AMOUNT = /^([+-])?£?([+-])?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/**
 * Parses a money value from a CSV cell to signed integer pence.
 * Accepts "12.34", "-12.34", "£1,234.56", "-£5", "£-5", "+3.20", "(12.34)".
 * Returns null for an empty cell, undefined for text that isn't an amount.
 */
export function parseAmount(raw: string): number | null | undefined {
  let text = raw.trim().replace(/\s+/g, "");
  if (text === "") return null;
  let negative = false;
  const bracketed = text.match(/^\((.*)\)$/);
  if (bracketed) {
    negative = true;
    text = bracketed[1]!;
  }
  const m = text.match(AMOUNT);
  if (!m) return undefined;
  const signs = [m[1], m[2]].filter(Boolean);
  if (signs.length > 1) return undefined;
  if (signs[0] === "-") negative = !negative;
  const pounds = Number(m[3]!.replace(/,/g, ""));
  const pence = Number((m[4] ?? "").padEnd(2, "0"));
  const total = pounds * 100 + pence;
  if (!Number.isSafeInteger(total)) return undefined;
  return negative && total !== 0 ? -total : total;
}
