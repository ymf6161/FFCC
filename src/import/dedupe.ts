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
