import { and, asc, count, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { merchantKey as keyOf } from "@/engine/merchant";
import {
  accounts,
  auditLog,
  categories,
  events,
  householdMerchants,
  persons,
  questions,
  receipts,
  rules,
  tags,
  transactionEvents,
  transactionPersons,
  transactionSplits,
  transactionTags,
  transactions,
  type categorisationStatuses,
} from "@/db/schema";

/** Household-scoped reads for Activity. */

export type TransactionFilters = {
  batchId?: string;
  /** Searches the bank description and merchant name (any script). */
  q?: string;
  accountId?: string;
  /** A category id, or "none" for not yet sorted. */
  categoryId?: string;
  status?: (typeof categorisationStatuses)[number];
  from?: string;
  to?: string;
  tagId?: string;
  eventId?: string;
  personId?: string;
};

function filterWhere(householdId: string, f: TransactionFilters) {
  const like = f.q?.trim() ? `%${f.q.trim().toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%` : undefined;
  return and(
    eq(transactions.householdId, householdId),
    isNull(transactions.deletedAt),
    f.batchId ? eq(transactions.importBatchId, f.batchId) : undefined,
    like
      ? or(
          sql`lower(${transactions.rawDescription}) like ${like} escape '\\'`,
          sql`lower(coalesce(${transactions.merchant}, '')) like ${like} escape '\\'`,
          sql`lower(coalesce(${transactions.notes}, '')) like ${like} escape '\\'`,
        )
      : undefined,
    f.accountId ? eq(transactions.accountId, f.accountId) : undefined,
    f.categoryId === "none" ? isNull(transactions.categoryId) : f.categoryId ? eq(transactions.categoryId, f.categoryId) : undefined,
    f.status ? eq(transactions.status, f.status) : undefined,
    f.from ? gte(transactions.date, f.from) : undefined,
    f.to ? lte(transactions.date, f.to) : undefined,
    f.tagId
      ? sql`exists (select 1 from ${transactionTags} where ${transactionTags.transactionId} = ${transactions.id} and ${transactionTags.tagId} = ${f.tagId} and ${transactionTags.householdId} = ${householdId})`
      : undefined,
    f.eventId
      ? sql`exists (select 1 from ${transactionEvents} where ${transactionEvents.transactionId} = ${transactions.id} and ${transactionEvents.eventId} = ${f.eventId} and ${transactionEvents.householdId} = ${householdId})`
      : undefined,
    f.personId
      ? sql`exists (select 1 from ${transactionPersons} where ${transactionPersons.transactionId} = ${transactions.id} and ${transactionPersons.personId} = ${f.personId} and ${transactionPersons.householdId} = ${householdId})`
      : undefined,
  );
}

export async function listTransactions(
  ex: Executor,
  householdId: string,
  { limit = 50, offset = 0, ...filters }: TransactionFilters & { limit?: number; offset?: number } = {},
) {
  const where = filterWhere(householdId, filters);
  const rows = await ex
    .select({
      id: transactions.id,
      date: transactions.date,
      amount: transactions.amount,
      description: transactions.rawDescription,
      merchant: transactions.merchant,
      accountName: accounts.name,
      bookingStatus: transactions.bookingStatus,
      status: transactions.status,
      categoryName: categories.name,
      categoryKind: categories.kind,
      transferGroupId: transactions.transferGroupId,
      refundOfId: transactions.refundOfId,
      isSplit: sql<number>`exists (select 1 from ${transactionSplits} where ${transactionSplits.transactionId} = ${transactions.id} and ${transactionSplits.householdId} = ${householdId} and ${transactionSplits.deletedAt} is null)`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, and(eq(categories.id, transactions.categoryId), eq(categories.householdId, householdId)))
    .where(where)
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(limit)
    .offset(offset);
  const [total] = await ex.select({ n: count() }).from(transactions).where(where);
  // Which of these purchases have a refund linked to them.
  const refunded = rows.length
    ? new Set(
        (
          await ex
            .select({ id: transactions.refundOfId })
            .from(transactions)
            .where(and(eq(transactions.householdId, householdId), isNull(transactions.deletedAt), inArray(transactions.refundOfId, rows.map((r) => r.id))))
        ).map((r) => r.id),
      )
    : new Set<string | null>();
  // A split row's single category no longer applies: its lines do (rule 5).
  return {
    rows: rows.map(({ isSplit, ...r }) => ({ ...r, categoryName: isSplit ? "Split" : r.categoryName, refunded: refunded.has(r.id) })),
    total: total?.n ?? 0,
  };
}

/** Everything the transaction page shows, scoped to the household. */
export async function getTransactionDetail(ex: Executor, householdId: string, id: string) {
  const [row] = await ex
    .select({ tx: transactions, account: accounts, category: categories })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, and(eq(categories.id, transactions.categoryId), eq(categories.householdId, householdId)))
    .where(and(eq(transactions.id, id), eq(transactions.householdId, householdId), isNull(transactions.deletedAt)));
  if (!row) return null;
  const tx = row.tx;
  const scoped = <T extends { householdId: unknown }>(t: T) => eq((t as unknown as typeof transactions).householdId, householdId);

  const [splits, tagRows, eventRows, personRows, history, openQuestions, receiptRows, related] = await Promise.all([
    ex
      .select({ split: transactionSplits, categoryName: categories.name })
      .from(transactionSplits)
      .leftJoin(categories, eq(categories.id, transactionSplits.categoryId))
      .where(and(eq(transactionSplits.transactionId, id), scoped(transactionSplits), isNull(transactionSplits.deletedAt))),
    ex.select({ id: tags.id, name: tags.name }).from(transactionTags).innerJoin(tags, eq(tags.id, transactionTags.tagId)).where(and(eq(transactionTags.transactionId, id), scoped(transactionTags))),
    ex.select({ id: events.id, name: events.name }).from(transactionEvents).innerJoin(events, eq(events.id, transactionEvents.eventId)).where(and(eq(transactionEvents.transactionId, id), scoped(transactionEvents))),
    ex.select({ id: persons.id, name: persons.name }).from(transactionPersons).innerJoin(persons, eq(persons.id, transactionPersons.personId)).where(and(eq(transactionPersons.transactionId, id), scoped(transactionPersons))),
    ex
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.householdId, householdId),
          or(eq(auditLog.entityId, id), tx.importBatchId ? and(eq(auditLog.entity, "transactions"), eq(auditLog.entityId, tx.importBatchId)) : undefined),
        ),
      )
      .orderBy(asc(auditLog.createdAt)),
    ex.select().from(questions).where(and(eq(questions.householdId, householdId), eq(questions.subjectType, "transaction"), eq(questions.subjectId, id), inArray(questions.status, ["open", "sent"]))),
    ex.select().from(receipts).where(and(eq(receipts.householdId, householdId), eq(receipts.matchedTransactionId, id), isNull(receipts.deletedAt))),
    ex
      .select({ id: transactions.id, date: transactions.date, amount: transactions.amount, description: transactions.rawDescription, refundOfId: transactions.refundOfId, transferGroupId: transactions.transferGroupId, accountName: accounts.name })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(
        and(
          eq(transactions.householdId, householdId),
          isNull(transactions.deletedAt),
          sql`${transactions.id} <> ${id}`,
          or(
            tx.transferGroupId ? eq(transactions.transferGroupId, tx.transferGroupId) : undefined,
            tx.refundOfId ? eq(transactions.id, tx.refundOfId) : undefined,
            eq(transactions.refundOfId, id),
          ),
        ),
      ),
  ]);

  const merchantKey = tx.merchant ? keyOf(tx.merchant) : null;
  const [matchingRules, hm] = await Promise.all([
    ex.select().from(rules).where(and(eq(rules.householdId, householdId), eq(rules.enabled, true))).orderBy(asc(rules.priority)),
    merchantKey
      ? ex.select().from(householdMerchants).where(and(eq(householdMerchants.householdId, householdId), eq(householdMerchants.name, merchantKey)))
      : Promise.resolve([]),
  ]);
  return {
    tx,
    account: row.account,
    category: row.category,
    splits: splits.map((s) => ({ ...s.split, categoryName: s.categoryName })),
    tags: tagRows,
    events: eventRows,
    persons: personRows,
    history,
    questions: openQuestions,
    receipts: receiptRows,
    transferPartner: tx.transferGroupId ? (related.find((r) => r.transferGroupId === tx.transferGroupId) ?? null) : null,
    refundOf: tx.refundOfId ? (related.find((r) => r.id === tx.refundOfId) ?? null) : null,
    refunds: related.filter((r) => r.refundOfId === id),
    merchantKey,
    rules: matchingRules.filter((r) => merchantKey && r.conditions.merchant && keyOf(r.conditions.merchant) === merchantKey),
    householdMerchant: hm[0] ?? null,
  };
}

export async function listCategories(ex: Executor, householdId: string) {
  return ex.select().from(categories).where(and(eq(categories.householdId, householdId), isNull(categories.deletedAt))).orderBy(asc(categories.kind), asc(categories.name));
}

export async function listTagsEventsPersons(ex: Executor, householdId: string) {
  const [t, e, p] = await Promise.all([
    ex.select().from(tags).where(eq(tags.householdId, householdId)).orderBy(asc(tags.name)),
    ex.select().from(events).where(eq(events.householdId, householdId)).orderBy(asc(events.name)),
    ex.select().from(persons).where(eq(persons.householdId, householdId)).orderBy(asc(persons.name)),
  ]);
  return { tags: t, events: e, persons: p };
}

/** Open questions, newest first, with what they are about. */
export async function listOpenQuestions(ex: Executor, householdId: string) {
  const qs = await ex
    .select()
    .from(questions)
    .where(and(eq(questions.householdId, householdId), inArray(questions.status, ["open", "sent"])))
    .orderBy(desc(questions.createdAt));
  const txIds = qs.filter((q) => q.subjectType === "transaction").map((q) => q.subjectId);
  const hmIds = qs.filter((q) => q.subjectType === "household_merchant").map((q) => q.subjectId);
  const groupIds = qs.filter((q) => q.subjectType === "transfer_pair").map((q) => q.subjectId);
  const [txs, hms, pairs] = await Promise.all([
    txIds.length ? ex.select().from(transactions).where(and(eq(transactions.householdId, householdId), inArray(transactions.id, txIds))) : Promise.resolve([]),
    hmIds.length ? ex.select().from(householdMerchants).where(and(eq(householdMerchants.householdId, householdId), inArray(householdMerchants.id, hmIds))) : Promise.resolve([]),
    groupIds.length ? ex.select().from(transactions).where(and(eq(transactions.householdId, householdId), inArray(transactions.transferGroupId, groupIds))) : Promise.resolve([]),
  ]);
  return { questions: qs, transactions: txs, householdMerchants: hms, pairSides: pairs };
}
