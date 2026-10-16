import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { Executor } from "@/db";
import { accounts, bankProfiles, importBatches, transactions } from "@/db/schema";
import { bankProfileMappingSchema } from "@/import/mapping";

/** Household-scoped reads for imports and the Activity list. */

export async function listTransactions(
  ex: Executor,
  householdId: string,
  { batchId, limit = 50, offset = 0 }: { batchId?: string; limit?: number; offset?: number } = {},
) {
  const where = and(
    eq(transactions.householdId, householdId),
    isNull(transactions.deletedAt),
    batchId ? eq(transactions.importBatchId, batchId) : undefined,
  );
  const rows = await ex
    .select({
      id: transactions.id,
      date: transactions.date,
      amount: transactions.amount,
      description: transactions.rawDescription,
      accountName: accounts.name,
      bookingStatus: transactions.bookingStatus,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(where)
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(limit)
    .offset(offset);
  const [total] = await ex.select({ n: count() }).from(transactions).where(where);
  return { rows, total: total?.n ?? 0 };
}

export async function listImportBatches(ex: Executor, householdId: string) {
  return ex
    .select({
      id: importBatches.id,
      fileName: importBatches.fileName,
      accountName: accounts.name,
      status: importBatches.status,
      newCount: importBatches.newCount,
      duplicateCount: importBatches.duplicateCount,
      nearDuplicateCount: importBatches.nearDuplicateCount,
      errorCount: importBatches.errorCount,
      createdAt: importBatches.createdAt,
      undoneAt: importBatches.undoneAt,
    })
    .from(importBatches)
    .innerJoin(accounts, eq(accounts.id, importBatches.accountId))
    .where(eq(importBatches.householdId, householdId))
    .orderBy(desc(importBatches.createdAt), desc(importBatches.id));
}

export async function getImportBatch(ex: Executor, householdId: string, batchId: string) {
  const [row] = await ex
    .select({ batch: importBatches, accountName: accounts.name, profileName: bankProfiles.name })
    .from(importBatches)
    .innerJoin(accounts, eq(accounts.id, importBatches.accountId))
    .leftJoin(bankProfiles, eq(bankProfiles.id, importBatches.bankProfileId))
    .where(and(eq(importBatches.id, batchId), eq(importBatches.householdId, householdId)));
  return row ?? null;
}

export async function listBankProfiles(ex: Executor, householdId: string) {
  const rows = await ex.select().from(bankProfiles).where(eq(bankProfiles.householdId, householdId));
  // Stored JSON is checked on the way out; a profile that no longer validates is ignored.
  return rows.flatMap((r) => {
    const mapping = bankProfileMappingSchema.safeParse(r.mapping);
    return mapping.success ? [{ ...r, mapping: mapping.data }] : [];
  });
}
