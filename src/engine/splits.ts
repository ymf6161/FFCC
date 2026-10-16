import { and, eq, inArray, isNull } from "drizzle-orm";
import { insertAudited, type AuditContext, updateBatchAudited } from "@/audit";
import type { Executor } from "@/db";
import { transactionSplits, transactions } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { assertInteger } from "@/money";

/**
 * Splits (BUILD_PLAN rule 5). A transaction has split lines only when it is
 * split; otherwise its single category sits on the transaction. Every total
 * reads categories through `categoryLines`, so no query handles the two shapes
 * itself.
 */

export type CategoryLine = {
  transactionId: string;
  splitId: string | null;
  categoryId: string | null;
  amount: number;
  reserveId: string | null;
};

type TxLike = { id: string; amount: number; categoryId: string | null; reserveId: string | null };
type SplitLike = { id: string; transactionId: string; categoryId: string | null; amount: number; reserveId: string | null };

/** The category lines of a transaction: its stored splits, or the single implicit split. */
export function categoryLines(tx: TxLike, splits: SplitLike[]): CategoryLine[] {
  const own = splits.filter((s) => s.transactionId === tx.id);
  if (own.length === 0) return [{ transactionId: tx.id, splitId: null, categoryId: tx.categoryId, amount: tx.amount, reserveId: tx.reserveId }];
  return own.map((s) => ({ transactionId: tx.id, splitId: s.id, categoryId: s.categoryId, amount: s.amount, reserveId: s.reserveId ?? tx.reserveId }));
}

/** Loads live splits for many transactions at once. */
export async function loadSplits(ex: Executor, householdId: string, transactionIds?: string[]) {
  return ex
    .select()
    .from(transactionSplits)
    .where(
      and(
        eq(transactionSplits.householdId, householdId),
        isNull(transactionSplits.deletedAt),
        transactionIds ? inArray(transactionSplits.transactionId, transactionIds) : undefined,
      ),
    );
}

/**
 * Divides `total` pence by `weights`, by largest remainder, so the parts
 * always sum exactly to `total` and keep its sign. Integer maths only.
 */
export function allocateProRata(total: number, weights: number[]): number[] {
  assertInteger(total, "total");
  if (weights.length === 0) throw new Error("Nothing to split between");
  const w = weights.map((x) => Math.abs(x));
  const sum = w.reduce((a, b) => a + b, 0);
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  if (sum === 0) {
    const base = Math.floor(abs / w.length);
    return w.map((_, i) => sign * (base + (i < abs - base * w.length ? 1 : 0)));
  }
  const exact = w.map((x) => (BigInt(abs) * BigInt(x)));
  const parts = exact.map((e) => Number(e / BigInt(sum)));
  let left = abs - parts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, rem: e % BigInt(sum) }))
    .sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  for (const { i } of order) {
    if (left === 0) break;
    parts[i]! += 1;
    left -= 1;
  }
  return parts.map((p) => (p === 0 ? 0 : sign * p));
}

export type SplitInput = { categoryId: string | null; amount: number; reserveId?: string | null; note?: string | null };

/**
 * Replaces a transaction's split lines. Rejects any set that does not sum
 * exactly to the transaction amount. An empty set removes the split.
 */
export async function setSplits(
  ex: Executor,
  { householdId, transactionId }: { householdId: string; transactionId: string },
  lines: SplitInput[],
  ctx: AuditContext,
): Promise<void> {
  const [tx] = await ex
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.householdId, householdId), isNull(transactions.deletedAt)));
  if (!tx) throw new Error("That transaction doesn’t exist in this household.");
  for (const line of lines) assertInteger(line.amount, "split amount");
  const sum = lines.reduce((a, l) => a + l.amount, 0);
  if (lines.length > 0 && sum !== tx.amount) {
    throw new Error(`Split lines add up to ${sum} pence, but the payment is ${tx.amount} pence.`);
  }
  const now = nowIso();
  const existing = await loadSplits(ex, householdId, [transactionId]);
  await updateBatchAudited(ex, transactionSplits, { householdId, ids: existing.map((s) => s.id) }, { deletedAt: now, updatedAt: now }, ctx);
  for (const line of lines) {
    await insertAudited(
      ex,
      transactionSplits,
      {
        id: newId(),
        householdId,
        transactionId,
        categoryId: line.categoryId,
        amount: line.amount,
        reserveId: line.reserveId ?? null,
        note: line.note ?? null,
        createdAt: now,
        updatedAt: now,
      },
      ctx,
    );
  }
}
