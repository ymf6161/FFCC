import { and, count, eq, isNull, ne } from "drizzle-orm";
import type { Executor } from "@/db";
import { accounts, households, questions, transactions } from "@/db/schema";

/**
 * Household-scoped reads. Every function takes `householdId` first and
 * filters by it; the scoping test runs each one against two households.
 */

export async function getHousehold(ex: Executor, householdId: string) {
  const [row] = await ex.select().from(households).where(eq(households.id, householdId)).limit(1);
  return row ?? null;
}

export async function listAccounts(ex: Executor, householdId: string) {
  return ex
    .select()
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), isNull(accounts.deletedAt)))
    .orderBy(accounts.createdAt);
}

export async function countTransactions(ex: Executor, householdId: string): Promise<number> {
  const [row] = await ex
    .select({ n: count() })
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), isNull(transactions.deletedAt)));
  return row?.n ?? 0;
}

/** Open questions waiting on the family (open or sent, not yet answered). */
export async function countOpenQuestions(ex: Executor, householdId: string): Promise<number> {
  const [row] = await ex
    .select({ n: count() })
    .from(questions)
    .where(
      and(
        eq(questions.householdId, householdId),
        ne(questions.status, "answered"),
        ne(questions.status, "expired"),
        ne(questions.status, "fallback"),
      ),
    );
  return row?.n ?? 0;
}
