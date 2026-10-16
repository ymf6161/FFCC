import { and, asc, eq, isNull } from "drizzle-orm";
import type { Executor } from "@/db";
import { accounts, balanceCheckpoints, transactions } from "@/db/schema";

export type Drift =
  | { status: "no_checkpoints" }
  | { status: "matches"; checkedOn: string }
  | { status: "differs"; difference: number; since: string; checkedOn: string };

/**
 * Compares our balance with the bank's own figures (BUILD_PLAN rule 11).
 * Our balance on a date = opening balance + booked, non-deleted transactions
 * after the opening date, up to and including that date. Looks at the latest
 * checkpoint; if it differs, `since` is the first checkpoint that differed
 * after the last one that matched. `difference` is ours minus the bank's.
 */
export async function accountDrift(ex: Executor, householdId: string, accountId: string): Promise<Drift> {
  const [account] = await ex
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)));
  if (!account) return { status: "no_checkpoints" };

  const checkpoints = (
    await ex
      .select({ date: balanceCheckpoints.date, balance: balanceCheckpoints.balance })
      .from(balanceCheckpoints)
      .where(and(eq(balanceCheckpoints.householdId, householdId), eq(balanceCheckpoints.accountId, accountId), isNull(balanceCheckpoints.deletedAt)))
      .orderBy(asc(balanceCheckpoints.date))
  ).filter((c) => c.date >= account.openingBalanceDate);
  if (checkpoints.length === 0) return { status: "no_checkpoints" };

  const rows = await ex
    .select({ date: transactions.date, amount: transactions.amount })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.accountId, accountId),
        eq(transactions.bookingStatus, "booked"),
        isNull(transactions.deletedAt),
      ),
    )
    .orderBy(asc(transactions.date));

  let balance = account.openingBalance;
  let i = 0;
  let lastMatchIndex = -1;
  const results = checkpoints.map((c, index) => {
    while (i < rows.length && rows[i]!.date <= c.date) {
      if (rows[i]!.date > account.openingBalanceDate) balance += rows[i]!.amount;
      i++;
    }
    const difference = balance - c.balance;
    if (difference === 0) lastMatchIndex = index;
    return { ...c, difference };
  });

  const latest = results.at(-1)!;
  if (latest.difference === 0) return { status: "matches", checkedOn: latest.date };
  const firstDiffering = results[lastMatchIndex + 1]!;
  return { status: "differs", difference: latest.difference, since: firstDiffering.date, checkedOn: latest.date };
}
