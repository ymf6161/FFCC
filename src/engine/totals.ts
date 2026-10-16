import { and, eq, gte, isNull, lte, sum } from "drizzle-orm";
import type { Executor } from "@/db";
import { accounts, categories, maaserLedger, reserveMovements, transactions } from "@/db/schema";
import { categoryLines, loadSplits } from "./splits";

/**
 * Totals the rest of the app reads (Home, Reports). Transfers, pending and
 * deleted rows never count (rules 3, 12). Refunds sit in their purchase's
 * expense category, so they reduce spending in the month they arrive (rule 4).
 */
export type PeriodTotals = {
  income: number;
  /** Positive number: money out on spending, net of refunds. */
  spending: number;
  byCategory: Map<string, number>;
  /** Signed sum of rows not yet categorised (not income or spending until sorted). */
  uncategorised: number;
};

export async function periodTotals(ex: Executor, householdId: string, { from, to }: { from: string; to: string }): Promise<PeriodTotals> {
  const cats = new Map((await ex.select().from(categories).where(eq(categories.householdId, householdId))).map((c) => [c.id, c]));
  const rows = await ex
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        isNull(transactions.deletedAt),
        eq(transactions.bookingStatus, "booked"),
        gte(transactions.date, from),
        lte(transactions.date, to),
      ),
    );
  const splits = await loadSplits(ex, householdId, rows.map((r) => r.id));
  const out: PeriodTotals = { income: 0, spending: 0, byCategory: new Map(), uncategorised: 0 };
  for (const tx of rows) {
    for (const line of categoryLines(tx, splits)) {
      const cat = line.categoryId ? cats.get(line.categoryId) : undefined;
      if (!cat) {
        out.uncategorised += line.amount;
        continue;
      }
      if (cat.kind === "transfer") continue; // paired or not, never income or spending
      out.byCategory.set(cat.name, (out.byCategory.get(cat.name) ?? 0) + line.amount);
      if (cat.kind === "income") out.income += line.amount;
      else out.spending -= line.amount;
    }
  }
  return out;
}

/** Balance on a date: opening balance (as at its date) plus booked rows after it (rule 11). */
export async function accountBalances(ex: Executor, householdId: string, date: string) {
  const accts = await ex.select().from(accounts).where(and(eq(accounts.householdId, householdId), isNull(accounts.deletedAt)));
  const rows = await ex
    .select({ accountId: transactions.accountId, date: transactions.date, amount: transactions.amount })
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), isNull(transactions.deletedAt), eq(transactions.bookingStatus, "booked"), lte(transactions.date, date)));
  return accts.map((a) => ({
    account: a,
    balance: a.openingBalance + rows.filter((r) => r.accountId === a.id && r.date > a.openingBalanceDate).reduce((s, r) => s + r.amount, 0),
  }));
}

export async function maaserOwed(ex: Executor, householdId: string, date = "9999-12-31"): Promise<number> {
  const [row] = await ex
    .select({ total: sum(maaserLedger.amount) })
    .from(maaserLedger)
    .where(and(eq(maaserLedger.householdId, householdId), isNull(maaserLedger.deletedAt), lte(maaserLedger.date, date)));
  return Number(row?.total ?? 0);
}

export async function reservesTotal(ex: Executor, householdId: string, date = "9999-12-31"): Promise<number> {
  const [row] = await ex
    .select({ total: sum(reserveMovements.amount) })
    .from(reserveMovements)
    .where(and(eq(reserveMovements.householdId, householdId), isNull(reserveMovements.deletedAt), lte(reserveMovements.date, date)));
  return Number(row?.total ?? 0);
}

const LIQUID_TYPES = new Set(["current", "savings", "cash_wallet"]);

/**
 * Available cash = liquid balances (current, savings, cash wallet) − reserves −
 * ma'aser owed (rule 6). Credit card balances are not subtracted. May be negative.
 */
export async function availableCash(ex: Executor, householdId: string, date: string) {
  const balances = await accountBalances(ex, householdId, date);
  const liquid = balances.filter((b) => b.account.isLiquid && LIQUID_TYPES.has(b.account.type)).reduce((s, b) => s + b.balance, 0);
  const reserved = await reservesTotal(ex, householdId, date);
  const owed = await maaserOwed(ex, householdId, date);
  return { liquid, reserved, maaserOwed: owed, available: liquid - reserved - owed };
}
