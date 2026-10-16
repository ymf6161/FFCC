import { headerSignature, type Mapping, normaliseHeader } from "./mapping";
import { guessDateFormats, parseAmount, parseDate } from "./parse-values";
import { findPreset } from "./presets";

const MAX_PREAMBLE = 15;

function looksLikeValue(cell: string): boolean {
  const text = cell.trim();
  if (text === "") return false;
  if (parseAmount(text) !== undefined) return true;
  return guessDateFormats([text]).length > 0;
}

/**
 * Finds the header row: the first row (within the first 15) that has the same
 * number of cells as most rows in the file and whose cells are names, not
 * values. This skips account summaries some banks put above the table.
 */
export function findHeaderRow(rows: string[][]): number {
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.length, (counts.get(row.length) ?? 0) + 1);
  const widths = [...counts.entries()].filter(([w]) => w >= 2).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const width = widths[0]?.[0];
  if (width === undefined) return 0;
  for (let i = 0; i < Math.min(rows.length, MAX_PREAMBLE); i++) {
    const row = rows[i]!;
    if (row.length !== width) continue;
    const named = row.filter((c) => c.trim() !== "" && !looksLikeValue(c)).length;
    if (named >= Math.ceil(width / 2)) return i;
  }
  return 0;
}

const find = (headers: string[], pattern: RegExp) => headers.find((h) => pattern.test(normaliseHeader(h)));

/** A first guess at the mapping from column names and sample values. The family checks it. */
export function guessMapping(rows: string[][], headerRow: number): Partial<Mapping> & { headerRow: number } {
  const headers = rows[headerRow] ?? [];
  const sample = rows.slice(headerRow + 1, headerRow + 41);
  const column = (name: string | undefined) => {
    const i = name === undefined ? -1 : headers.indexOf(name);
    return i < 0 ? [] : sample.map((r) => r[i] ?? "");
  };

  const dateColumn = find(headers, /^(transaction |posting |value )?date$/) ?? find(headers, /date/);
  const debitColumn = find(headers, /^(paid out|money out|debit|debits|withdrawals?|out)$/);
  const creditColumn = find(headers, /^(paid in|money in|credit|credits|deposits?|in)$/);
  const amountColumn = find(headers, /^(amount|value|transaction amount|amount \(gbp\))$/);
  const runningBalanceColumn = find(headers, /balance/);
  const externalIdColumn = find(headers, /^(transaction id|transaction reference|id)$/);
  const description =
    find(headers, /^(description|memo|details|narrative|transaction description)$/) ??
    find(headers, /description|memo|details|narrative|payee|name|reference/);

  const dateFormat = guessDateFormats(column(dateColumn).filter(Boolean))[0];
  const amounts = column(amountColumn)
    .map(parseAmount)
    .filter((a): a is number => typeof a === "number");
  const allPositive = amounts.length > 0 && amounts.every((a) => a >= 0);

  return {
    headerRow,
    dateColumn,
    dateFormat,
    ...(debitColumn && creditColumn && !amountColumn ? { debitColumn, creditColumn } : { amountColumn }),
    // A column with no negative values at all is most likely a card statement showing spending as positive.
    signConvention: allPositive ? "money_out_positive" : "money_in_positive",
    descriptionColumns: description ? [description] : [],
    runningBalanceColumn,
    externalIdColumn,
  };
}

export type Detection = {
  headerRow: number;
  headers: string[];
  signature: string;
  /** Name of the recognised layout, if any. */
  recognisedAs: string | null;
  mapping: Partial<Mapping> & { headerRow: number };
};

/** Recognises the layout: the household's saved profiles first, then built-in presets, then a guess. */
export function detectLayout(rows: string[][], savedProfiles: { name: string; headerSignature: string | null; mapping: Mapping }[]): Detection {
  const headerRow = findHeaderRow(rows);
  const headers = rows[headerRow] ?? [];
  const signature = headerSignature(headers);
  const saved = savedProfiles.find((p) => p.headerSignature === signature);
  if (saved) return { headerRow, headers, signature, recognisedAs: saved.name, mapping: { ...saved.mapping, headerRow } };
  const preset = findPreset(signature);
  if (preset) {
    // Keep the preset's columns but trust the sample dates if the preset's format doesn't read them.
    const dateSamples = rows.slice(headerRow + 1, headerRow + 41).map((r) => r[headers.indexOf(preset.mapping.dateColumn)] ?? "");
    const readable = dateSamples.filter(Boolean).every((d) => parseDate(d, preset.mapping.dateFormat) !== null);
    const dateFormat = readable ? preset.mapping.dateFormat : (guessDateFormats(dateSamples.filter(Boolean))[0] ?? preset.mapping.dateFormat);
    return { headerRow, headers, signature, recognisedAs: preset.name, mapping: { ...preset.mapping, dateFormat, headerRow } };
  }
  return { headerRow, headers, signature, recognisedAs: null, mapping: guessMapping(rows, headerRow) };
}
