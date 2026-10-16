import { z } from "zod";

const AMOUNT_PATTERN = /^(\d{1,3}(,\d{3})+|\d+)(\.(\d{1,2}))?$/;

export const AMOUNT_HINT = "That doesn’t look like an amount. Try something like 250.00.";

/**
 * Parses what a person types into an amount field into whole pence.
 * Accepts 40, 40.00, £40, 40.5, 1,250.00. Never goes through a float.
 * Returns a positive number; direction (in or out) is chosen separately.
 */
export const amountInputSchema = z
  .string()
  .transform((raw) => raw.trim().replace(/^£\s*/, ""))
  .refine((s) => AMOUNT_PATTERN.test(s), { message: AMOUNT_HINT })
  .transform((s) => {
    const [whole = "0", fraction = ""] = s.replace(/,/g, "").split(".");
    return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  })
  .refine((p) => Number.isSafeInteger(p), { message: AMOUNT_HINT });

export function parseAmountToPence(input: string): { ok: true; pence: number } | { ok: false; error: string } {
  const result = amountInputSchema.safeParse(input);
  if (result.success) return { ok: true, pence: result.data };
  return { ok: false, error: result.error.issues[0]?.message ?? AMOUNT_HINT };
}
