import { and, asc, eq, isNull } from "drizzle-orm";
import { type Actor, insertAudited, updateAudited } from "@/audit";
import type { Executor } from "@/db";
import { accounts, categories, transactions } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { lastDayOfMonthKey, monthOf } from "./dates";

/**
 * The cash wallet month-end sweep (BUILD_PLAN rule 8). For every completed
 * month, all withdrawn cash not covered by cash notes becomes one system
 * transaction, "General cash spending", and the wallet goes back to zero. If
 * the family reports how much cash is on hand, only the difference is swept.
 * Running it again after a late note recalculates the month's sweep.
 */
export const SWEEP_PREFIX = "cash-sweep:";

export type SweepChange = { accountId: string; month: string; amount: number; change: "created" | "updated" | "removed" };

export async function sweepCashWallets(
  ex: Executor,
  householdId: string,
  { today, cashOnHand = new Map(), actor }: { today: string; cashOnHand?: Map<string, number>; actor: Actor },
): Promise<SweepChange[]> {
  const [category] = await ex
    .select()
    .from(categories)
    .where(and(eq(categories.householdId, householdId), eq(categories.name, "General cash spending"), isNull(categories.deletedAt)));
  if (!category) return [];
  const wallets = await ex
    .select()
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), eq(accounts.type, "cash_wallet"), isNull(accounts.deletedAt)));
  const thisMonth = monthOf(today);
  const changes: SweepChange[] = [];
  const now = nowIso();

  for (const wallet of wallets) {
    const rows = await ex
      .select()
      .from(transactions)
      .where(and(eq(transactions.accountId, wallet.id), eq(transactions.householdId, householdId), isNull(transactions.deletedAt), eq(transactions.bookingStatus, "booked")))
      .orderBy(asc(transactions.date));
    const isSweep = (r: (typeof rows)[number]) => r.source === "system" && r.dedupeKey.startsWith(SWEEP_PREFIX);
    const others = rows.filter((r) => !isSweep(r) && r.date > wallet.openingBalanceDate);
    const sweeps = new Map(rows.filter(isSweep).map((r) => [r.dedupeKey.slice(SWEEP_PREFIX.length), r]));
    if (others.length === 0) continue;

    let balance = wallet.openingBalance;
    const months = [...new Set(others.map((r) => monthOf(r.date)))];
    const first = months[0]!;
    for (let month = first; month < thisMonth; month = nextMonth(month)) {
      balance += others.filter((r) => monthOf(r.date) === month).reduce((s, r) => s + r.amount, 0);
      const counted = cashOnHand.get(`${wallet.id}:${month}`) ?? 0;
      const target = Math.max(0, balance - counted);
      const existing = sweeps.get(month);
      const ctx = { actor, reason: "Month-end cash sweep" };
      if (target > 0 && !existing) {
        await insertAudited(
          ex,
          transactions,
          {
            id: newId(),
            householdId,
            accountId: wallet.id,
            date: lastDayOfMonthKey(month),
            amount: -target,
            rawDescription: "General cash spending",
            merchant: "General cash spending",
            categoryId: category.id,
            source: "system",
            bookingStatus: "booked",
            dedupeKey: `${SWEEP_PREFIX}${month}`,
            status: "auto",
            confidence: 100,
            createdAt: now,
            updatedAt: now,
          },
          ctx,
        );
        changes.push({ accountId: wallet.id, month, amount: -target, change: "created" });
      } else if (existing && target > 0 && existing.amount !== -target) {
        await updateAudited(ex, transactions, { id: existing.id, householdId }, { amount: -target, updatedAt: now }, { actor, reason: "Recalculated the cash sweep after a late note or count" });
        changes.push({ accountId: wallet.id, month, amount: -target, change: "updated" });
      } else if (existing && target === 0) {
        await updateAudited(ex, transactions, { id: existing.id, householdId }, { deletedAt: now, updatedAt: now }, { actor, reason: "Nothing left to sweep for this month" });
        changes.push({ accountId: wallet.id, month, amount: 0, change: "removed" });
      }
      balance -= target;
    }
  }
  return changes;
}

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
