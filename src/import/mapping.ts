import { z } from "zod";
import type { BankProfileMapping } from "@/db/schema/plumbing";
import { DATE_FORMATS } from "./parse-values";

/**
 * How to read one bank's CSV layout. Column references are header names.
 * Validated with Zod whenever it crosses a boundary (form input, saved profile).
 */
export const bankProfileMappingSchema = z
  .object({
    headerRow: z.number().int().min(0).max(50),
    dateColumn: z.string().min(1),
    dateFormat: z.enum(DATE_FORMATS),
    amountColumn: z.string().min(1).optional(),
    debitColumn: z.string().min(1).optional(),
    creditColumn: z.string().min(1).optional(),
    signConvention: z.enum(["money_in_positive", "money_out_positive"]),
    descriptionColumns: z.array(z.string().min(1)).min(1).max(5),
    runningBalanceColumn: z.string().min(1).optional(),
    externalIdColumn: z.string().min(1).optional(),
  })
  .refine((m) => m.amountColumn !== undefined || (m.debitColumn !== undefined && m.creditColumn !== undefined), {
    message: "Choose an amount column, or both a paid-out and a paid-in column.",
  }) satisfies z.ZodType<BankProfileMapping>;

export type Mapping = z.infer<typeof bankProfileMappingSchema>;

/** Header names compared loosely: lower case, single spaces, no surrounding quotes or colons. */
export function normaliseHeader(cell: string): string {
  return cell.trim().replace(/\s+/g, " ").replace(/:$/, "").toLowerCase();
}

/** Identifies a layout by its column names, in order. */
export function headerSignature(headers: string[]): string {
  return headers.map(normaliseHeader).join("|");
}
