/**
 * Dedupe keys (BUILD_PLAN rule 10). Phase 2 builds the full import pipeline
 * on these; the seed uses them so its rows satisfy the same unique index.
 */

/**
 * Lower case, letters and digits only (in any script), single spaces.
 * Keeps Hebrew and accented letters: "Café" stays "café", not "caf".
 * Combining marks are dropped after NFC, so Hebrew vowel points don't split
 * words and "שָׁלוֹם" matches "שלום"; precomposed letters like é survive NFC.
 */
export function normaliseDescription(raw: string): string {
  return raw
    .normalize("NFC")
    .toLocaleLowerCase("en-GB")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Key within one account: date + amount + normalised description. */
export function dedupeKey(row: { date: string; amount: number; description: string }): string {
  return `${row.date}|${row.amount}|${normaliseDescription(row.description)}`;
}

/**
 * Numbers identical rows 1, 2, 3… in file order, so two genuine £3.20
 * coffees on the same day both import, and re-importing adds neither again.
 */
export function withOccurrences<T extends { date: string; amount: number; description: string }>(
  rows: T[],
): (T & { dedupeKey: string; dedupeOccurrence: number })[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const key = dedupeKey(row);
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    return { ...row, dedupeKey: key, dedupeOccurrence: occurrence };
  });
}

export type DedupeStatus = "new" | "duplicate" | "near_duplicate";

export type ExistingRow = {
  id: string;
  date: string;
  amount: number;
  rawDescription: string;
  dedupeKey: string;
  dedupeOccurrence: number;
  externalId: string | null;
  source: string;
  /** Header signature of the bank profile the row was imported with, if any. */
  profileSignature: string | null;
};

const NEAR_MATCH_DAYS = 3;

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/**
 * Classifies incoming rows for one account against what is already stored
 * (BUILD_PLAN rule 10). Rows must be in date order.
 * - duplicate: same external id, or same (date, amount, description, occurrence)
 * - near_duplicate: same amount within 3 days, different description, from a
 *   different source or file layout; stored, with a "duplicate?" question
 * - new: everything else
 */
export function classifyRows<T extends { date: string; amount: number; description: string; externalId?: string }>(
  rows: T[],
  existing: ExistingRow[],
  signature: string,
): (T & { dedupeKey: string; dedupeOccurrence: number; status: DedupeStatus; nearMatchId?: string })[] {
  const byExternalId = new Set(existing.map((e) => e.externalId).filter((x): x is string => !!x));
  const byKey = new Set(existing.map((e) => `${e.dedupeKey}#${e.dedupeOccurrence}`));
  const fromElsewhere = existing.filter((e) => e.source !== "csv" || e.profileSignature !== signature);

  return withOccurrences(rows).map((row) => {
    if ((row.externalId && byExternalId.has(row.externalId)) || byKey.has(`${row.dedupeKey}#${row.dedupeOccurrence}`)) {
      return { ...row, status: "duplicate" as const };
    }
    const description = normaliseDescription(row.description);
    const near = fromElsewhere.find(
      (e) =>
        e.amount === row.amount &&
        daysBetween(e.date, row.date) <= NEAR_MATCH_DAYS &&
        normaliseDescription(e.rawDescription) !== description,
    );
    if (near) return { ...row, status: "near_duplicate" as const, nearMatchId: near.id };
    return { ...row, status: "new" as const };
  });
}
