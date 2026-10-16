import { eq } from "drizzle-orm";
import { type AuditContext, insertAudited, insertBatchAudited } from "@/audit";
import type { Db } from "@/db";
import {
  accounts,
  balanceCheckpoints,
  categories,
  householdMembers,
  households,
  importBatches,
  maaserSettings,
  transactions,
  users,
} from "@/db/schema";
import { withOccurrences } from "@/import/dedupe";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { SYSTEM_CATEGORIES } from "./categories";
import { generateSeedData, monthEndBalances, type SeedAccountKey } from "./generate";

export const DEMO_USER_EMAIL = "demo@example.com";
export const DEMO_HOUSEHOLD_NAME = "The Demo household";

const SYSTEM: AuditContext["actor"] = { type: "system", id: "seed" };

export type SeedResult = {
  householdId: string;
  userId: string;
  transactionCount: number;
  startDate: string;
  endDate: string;
};

/**
 * Writes the demo household. Every write goes through the audit helper.
 * Transactions are stored as a bank import would leave them: booked,
 * uncategorised and unconfirmed, with no transfer or refund links. Sorting
 * them is the engine's job (Phase 3).
 */
export async function seedDatabase(
  db: Db,
  { endDate, householdName = DEMO_HOUSEHOLD_NAME, userEmail = DEMO_USER_EMAIL }: {
    endDate: string;
    householdName?: string;
    userEmail?: string;
  },
): Promise<SeedResult> {
  const data = generateSeedData({ endDate });
  const ctx = (reason: string): AuditContext => ({ actor: SYSTEM, reason });

  return db.transaction(async (tx) => {
    const now = nowIso();
    const stamps = { createdAt: now, updatedAt: now };

    const household = await insertAudited(
      tx,
      households,
      { id: newId(), name: householdName, currency: "GBP", financialYearStartMonth: 4, financialYearStartDay: 6, onboardingProgress: {}, ...stamps },
      ctx("Created demo household"),
    );
    const householdId = household.id;

    const user = await insertAudited(tx, users, { id: newId(), email: userEmail, displayName: "Demo user", ...stamps }, ctx("Created demo user"));
    await insertAudited(
      tx,
      householdMembers,
      { id: newId(), householdId, userId: user.id, role: "owner", notifyEmail: userEmail, notifyPhone: null, ...stamps },
      ctx("Added demo user as owner"),
    );

    for (const c of SYSTEM_CATEGORIES) {
      await insertAudited(
        tx,
        categories,
        { id: newId(), householdId, name: c.name, kind: c.kind, maaserEffect: c.maaserEffect, isSystem: true, ...stamps },
        ctx("Added system category"),
      );
    }

    await insertAudited(
      tx,
      maaserSettings,
      { id: newId(), householdId, percentageBp: 1000, effectiveFrom: data.startDate, createdAt: now },
      ctx("Default ma'aser setting"),
    );

    const accountIds = new Map<SeedAccountKey, string>();
    for (const a of data.accounts) {
      const row = await insertAudited(
        tx,
        accounts,
        {
          id: newId(),
          householdId,
          type: a.type,
          name: a.name,
          institution: a.institution,
          openingBalance: a.openingBalance,
          openingBalanceDate: data.openingBalanceDate,
          isLiquid: a.isLiquid,
          includeInNetWorth: true,
          isManual: false,
          ...stamps,
        },
        ctx("Added demo account"),
      );
      accountIds.set(a.key, row.id);
    }

    const checkpoints = monthEndBalances(data);
    let transactionCount = 0;

    // One import batch per account, as if each had a 12-month CSV uploaded.
    for (const a of data.accounts) {
      const accountId = accountIds.get(a.key)!;
      const accountRows = withOccurrences(data.rows.filter((r) => r.account === a.key));
      const batch = await insertAudited(
        tx,
        importBatches,
        {
          id: newId(),
          householdId,
          accountId,
          fileName: `seed-${a.key}.csv`,
          newCount: accountRows.length,
          status: "complete",
          ...stamps,
        },
        ctx("Seed import batch"),
      );
      const batchCtx = { ...ctx("Seeded demo transactions"), batchId: batch.id, importBatchId: batch.id, householdId };

      transactionCount += await insertBatchAudited(
        tx,
        transactions,
        accountRows.map((r) => ({
          id: newId(),
          householdId,
          accountId,
          date: r.date,
          amount: r.amount,
          rawDescription: r.description,
          source: "csv" as const,
          bookingStatus: "booked" as const,
          dedupeKey: r.dedupeKey,
          dedupeOccurrence: r.dedupeOccurrence,
          importBatchId: batch.id,
          status: "unconfirmed" as const,
          ...stamps,
        })),
        batchCtx,
      );

      await insertBatchAudited(
        tx,
        balanceCheckpoints,
        checkpoints
          .filter((c) => c.account === a.key)
          .map((c) => ({
            id: newId(),
            householdId,
            accountId,
            date: c.date,
            balance: c.balance,
            source: "statement" as const,
            importBatchId: batch.id,
            createdAt: now,
          })),
        { ...ctx("Seeded statement balances"), batchId: batch.id, importBatchId: batch.id, householdId },
      );
    }

    return { householdId, userId: user.id, transactionCount, startDate: data.startDate, endDate: data.endDate };
  });
}

/** Finds the demo login's household. */
export async function findDemoMembership(db: Db, email: string = DEMO_USER_EMAIL) {
  const [row] = await db
    .select({ userId: users.id, householdId: householdMembers.householdId })
    .from(users)
    .innerJoin(householdMembers, eq(householdMembers.userId, users.id))
    .where(eq(users.email, email))
    .limit(1);
  return row ?? null;
}
