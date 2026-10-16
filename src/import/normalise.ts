import { z } from "zod";
import type { Mapping } from "./mapping";
import { DATE_FORMAT_LABELS, parseAmount, parseDate } from "./parse-values";

export type NormalisedRow = {
  /** 1 = the first row under the header. */
  rowNumber: number;
  date: string;
  /** Signed integer pence: money in positive, money out negative. */
  amount: number;
  description: string;
  externalId?: string;
  /** Bank-reported balance after this row, in pence. */
  balance?: number;
};

export type RowError = { rowNumber: number; reason: string };

const rowSchema = z.object({
  rowNumber: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().int().safe(),
  description: z.string().min(1).max(500),
  externalId: z.string().min(1).max(200).optional(),
  balance: z.number().int().safe().optional(),
});

export type NormaliseResult = {
  rows: NormalisedRow[];
  errors: RowError[];
  /** The file's own order. Rows are always returned oldest first. */
  fileOrder: "oldest_first" | "newest_first";
};

/**
 * Turns the data rows under the header into validated rows in date order.
 * Rows that can't be read are reported with their row number and a reason.
 */
export function normaliseRows(rows: string[][], mapping: Mapping): NormaliseResult {
  const headers = rows[mapping.headerRow] ?? [];
  const index = (name: string | undefined) => (name === undefined ? -1 : headers.indexOf(name));
  const missing = [mapping.dateColumn, mapping.amountColumn, mapping.debitColumn, mapping.creditColumn, ...mapping.descriptionColumns]
    .filter((c): c is string => c !== undefined)
    .filter((c) => index(c) < 0);
  if (missing.length > 0) {
    return { rows: [], errors: [{ rowNumber: 0, reason: `This file has no column called ${missing.map((m) => `“${m}”`).join(", ")}.` }], fileOrder: "oldest_first" };
  }

  const out: NormalisedRow[] = [];
  const errors: RowError[] = [];
  const data = rows.slice(mapping.headerRow + 1);

  data.forEach((cells, i) => {
    const rowNumber = i + 1;
    const cell = (name: string | undefined) => (name === undefined ? "" : (cells[index(name)] ?? "").trim());
    const fail = (reason: string) => errors.push({ rowNumber, reason });

    const rawDate = cell(mapping.dateColumn);
    const date = parseDate(rawDate, mapping.dateFormat);
    if (!date) return fail(rawDate ? `The date “${rawDate}” doesn’t match ${DATE_FORMAT_LABELS[mapping.dateFormat]}.` : "There is no date.");

    let amount: number;
    if (mapping.amountColumn !== undefined) {
      const raw = cell(mapping.amountColumn);
      const value = parseAmount(raw);
      if (value === null) return fail("There is no amount.");
      if (value === undefined) return fail(`“${raw}” isn’t an amount.`);
      amount = mapping.signConvention === "money_out_positive" ? -value : value;
    } else {
      const rawOut = cell(mapping.debitColumn);
      const rawIn = cell(mapping.creditColumn);
      const paidOut = parseAmount(rawOut);
      const paidIn = parseAmount(rawIn);
      if (paidOut === undefined) return fail(`“${rawOut}” isn’t an amount.`);
      if (paidIn === undefined) return fail(`“${rawIn}” isn’t an amount.`);
      const outAbs = Math.abs(paidOut ?? 0);
      const inAbs = Math.abs(paidIn ?? 0);
      if (outAbs !== 0 && inAbs !== 0) return fail("Both paid in and paid out have an amount.");
      if (paidOut === null && paidIn === null) return fail("There is no amount.");
      amount = inAbs - outAbs;
    }
    if (amount === 0) amount = 0; // never -0

    const description = mapping.descriptionColumns.map(cell).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if (!description) return fail("There is no description.");

    let balance: number | undefined;
    if (mapping.runningBalanceColumn !== undefined) {
      const raw = cell(mapping.runningBalanceColumn);
      const value = parseAmount(raw);
      if (value === undefined) return fail(`The balance “${raw}” isn’t an amount.`);
      balance = value ?? undefined;
    }
    const externalId = mapping.externalIdColumn !== undefined ? cell(mapping.externalIdColumn) || undefined : undefined;

    const parsed = rowSchema.safeParse({ rowNumber, date, amount, description: description.slice(0, 500), externalId, balance });
    if (!parsed.success) return fail("This row couldn’t be read.");
    out.push(parsed.data);
  });

  const newestFirst = out.length > 1 && out[0]!.date > out[out.length - 1]!.date;
  if (newestFirst) out.reverse();
  return { rows: out, errors, fileOrder: newestFirst ? "newest_first" : "oldest_first" };
}

/** The balance at the end of each day, from the last row of that day in date order. */
export function endOfDayBalances(rows: NormalisedRow[]): { date: string; balance: number }[] {
  const byDate = new Map<string, number>();
  for (const row of rows) if (row.balance !== undefined) byDate.set(row.date, row.balance);
  return [...byDate.entries()].map(([date, balance]) => ({ date, balance }));
}
