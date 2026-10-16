import { and, asc, eq, gte, isNull } from "drizzle-orm";
import { type Actor, insertBatchAudited, updateBatchAudited } from "@/audit";
import type { Executor } from "@/db";
import { categories, maaserLedger, maaserSettings, reserveMovements, reserves, transactions } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { applyRate } from "@/money";
import { addDaysTo, monthOf } from "./dates";
import { categoryLines, loadSplits } from "./splits";

/**
 * The ma'aser and reserve ledgers (BUILD_PLAN rules 6, 7, 13). Automatic
 * entries are a projection of the transactions: rebuilt from a date forward
 * whenever a source transaction, split or setting changes. Manual entries are
 * never touched. A rebuild that would produce the same entries writes nothing.
 */

type MaaserEntry = {
  date: string;
  kind: "accrual" | "reduction";
  amount: number;
  sourceTransactionId: string;
  sourceSplitId: string | null;
};
type ReserveEntry = {
  reserveId: string;
  date: string;
  kind: "allocation" | "release";
  amount: number;
  sourceTransactionId: string | null;
  sourceSplitId: string | null;
};

/** The ma'aser rate in force on a date: the latest setting from on or before it (rule 7, dated settings). */
export function rateOn(settings: { percentageBp: number; effectiveFrom: string }[], date: string): number | null {
  let rate: number | null = null;
  for (const s of [...settings].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))) {
    if (s.effectiveFrom <= date) rate = s.percentageBp;
  }
  return rate;
}

async function sourceLines(ex: Executor, householdId: string, fromDate: string) {
  const rows = await ex
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        isNull(transactions.deletedAt),
        eq(transactions.bookingStatus, "booked"), // rule 12: pending rows don't count
        gte(transactions.date, fromDate),
      ),
    )
    .orderBy(asc(transactions.date), asc(transactions.id));
  const splits = await loadSplits(ex, householdId);
  return rows.flatMap((tx) => categoryLines(tx, splits).map((line) => ({ ...line, date: tx.date })));
}

/** Computes the automatic entries from `fromDate` on. Pure apart from reads. */
export async function computeLedgers(ex: Executor, householdId: string, { fromDate, today }: { fromDate: string; today: string }) {
  const cats = new Map((await ex.select().from(categories).where(eq(categories.householdId, householdId))).map((c) => [c.id, c]));
  const settings = await ex.select().from(maaserSettings).where(eq(maaserSettings.householdId, householdId));
  const lines = await sourceLines(ex, householdId, fromDate);

  const maaser: MaaserEntry[] = [];
  for (const line of lines) {
    const cat = line.categoryId ? cats.get(line.categoryId) : undefined;
    if (!cat || cat.kind === "transfer") continue;
    if (cat.maaserEffect === "accrue") {
      const rate = rateOn(settings, line.date);
      if (rate === null) continue;
      const amount = applyRate(line.amount, rate); // one rounding per posting (rule 1)
      if (amount !== 0) maaser.push({ date: line.date, kind: "accrual", amount, sourceTransactionId: line.transactionId, sourceSplitId: line.splitId });
    } else if (cat.maaserEffect === "reduce" && line.amount !== 0) {
      // A charity payment (negative) lowers ma'aser owed by its full amount; a charity refund raises it.
      maaser.push({ date: line.date, kind: "reduction", amount: line.amount, sourceTransactionId: line.transactionId, sourceSplitId: line.splitId });
    }
  }

  const reserveRows = await ex.select().from(reserves).where(and(eq(reserves.householdId, householdId), isNull(reserves.deletedAt)));
  const reserve: ReserveEntry[] = [];
  for (const r of reserveRows) {
    if (r.fundingRule === "percent_of_income" && r.fundingValue) {
      for (const line of lines) {
        const cat = line.categoryId ? cats.get(line.categoryId) : undefined;
        if (cat?.kind !== "income" || line.amount <= 0) continue;
        const amount = applyRate(line.amount, r.fundingValue);
        if (amount !== 0) reserve.push({ reserveId: r.id, date: line.date, kind: "allocation", amount, sourceTransactionId: line.transactionId, sourceSplitId: line.splitId });
      }
    }
    if (r.fundingRule === "fixed_monthly" && r.fundingValue) {
      const start = r.createdAt.slice(0, 7);
      for (let month = start; `${month}-01` <= today; month = monthOf(addDaysTo(`${month}-28`, 7))) {
        const date = `${month}-01`;
        if (date >= fromDate) reserve.push({ reserveId: r.id, date, kind: "allocation", amount: r.fundingValue, sourceTransactionId: null, sourceSplitId: null });
      }
    }
  }
  // Spending marked against a reserve releases that amount from it (rule 6).
  for (const line of lines) {
    if (!line.reserveId || line.amount >= 0) continue;
    reserve.push({ reserveId: line.reserveId, date: line.date, kind: "release", amount: line.amount, sourceTransactionId: line.transactionId, sourceSplitId: line.splitId });
  }
  return { maaser, reserve };
}

const maaserKey = (e: { date: string; kind: string; amount: number; sourceTransactionId: string | null; sourceSplitId: string | null }) =>
  `${e.date}|${e.kind}|${e.amount}|${e.sourceTransactionId ?? ""}|${e.sourceSplitId ?? ""}`;
const reserveKey = (e: { reserveId: string } & Parameters<typeof maaserKey>[0]) => `${e.reserveId}|${maaserKey(e)}`;
const sameMultiset = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

export type RebuildResult = { maaserChanged: boolean; reserveChanged: boolean };

/**
 * Replaces automatic ledger entries from `fromDate` on with freshly computed
 * ones. Logged as one batch per ledger. Manual entries stay.
 */
export async function rebuildLedgers(
  ex: Executor,
  householdId: string,
  { fromDate = "0000-01-01", today, actor }: { fromDate?: string; today: string; actor: Actor },
): Promise<RebuildResult> {
  const { maaser, reserve } = await computeLedgers(ex, householdId, { fromDate, today });
  const now = nowIso();
  const batchId = `ledger-rebuild:${newId()}`;
  const ctx = { actor, reason: "Rebuilt automatic ledger entries", batchId, householdId };

  const liveAuto = <T extends typeof maaserLedger | typeof reserveMovements>(table: T) =>
    and(eq(table.householdId, householdId), eq(table.origin, "auto"), isNull(table.deletedAt), gte(table.date, fromDate));

  const existingMaaser = await ex.select().from(maaserLedger).where(liveAuto(maaserLedger));
  const maaserChanged = !sameMultiset(existingMaaser.map(maaserKey), maaser.map(maaserKey));
  if (maaserChanged) {
    await updateBatchAudited(ex, maaserLedger, { householdId, ids: existingMaaser.map((e) => e.id) }, { deletedAt: now }, ctx);
    if (maaser.length > 0) {
      await insertBatchAudited(
        ex,
        maaserLedger,
        maaser.map((e) => ({ id: newId(), householdId, ...e, origin: "auto" as const, createdAt: now })),
        ctx,
      );
    }
  }

  const existingReserve = await ex.select().from(reserveMovements).where(liveAuto(reserveMovements));
  const reserveChanged = !sameMultiset(existingReserve.map(reserveKey), reserve.map(reserveKey));
  if (reserveChanged) {
    await updateBatchAudited(ex, reserveMovements, { householdId, ids: existingReserve.map((e) => e.id) }, { deletedAt: now }, ctx);
    if (reserve.length > 0) {
      await insertBatchAudited(
        ex,
        reserveMovements,
        reserve.map((e) => ({ id: newId(), householdId, ...e, origin: "auto" as const, createdAt: now })),
        ctx,
      );
    }
  }
  return { maaserChanged, reserveChanged };
}
