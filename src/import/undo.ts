import { and, eq, inArray, isNull, notInArray, or } from "drizzle-orm";
import { type Actor, insertAudited, updateAudited, updateBatchAudited } from "@/audit";
import type { Db, Executor } from "@/db";
import {
  accounts,
  auditLog,
  balanceCheckpoints,
  importBatches,
  maaserLedger,
  questions,
  receipts,
  reserveMovements,
  transactionSplits,
  transactions,
} from "@/db/schema";
import { enqueue } from "@/jobs/queue";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";

export type UndoWarning = { transactionCount: number; confirmedOrEdited: number; alreadyUndone: boolean };

async function batchRows(ex: Executor, householdId: string, batchId: string) {
  return ex
    .select()
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), eq(transactions.importBatchId, batchId), isNull(transactions.deletedAt)));
}

async function getBatch(ex: Executor, householdId: string, batchId: string) {
  const [batch] = await ex
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.id, batchId), eq(importBatches.householdId, householdId)));
  return batch ?? null;
}

/** What the family is told before undoing: how many rows go, and how many they have already touched. */
export async function undoWarning(ex: Executor, householdId: string, batchId: string): Promise<UndoWarning | null> {
  const batch = await getBatch(ex, householdId, batchId);
  if (!batch) return null;
  const rows = await batchRows(ex, householdId, batchId);
  return {
    transactionCount: rows.length,
    confirmedOrEdited: rows.filter((r) => r.status === "confirmed" || r.updatedAt !== r.createdAt).length,
    alreadyUndone: batch.status === "undone",
  };
}

export type UndoResult = {
  transactionsRemoved: number;
  receiptsReleased: number;
  questionsClosed: number;
  transfersUnpaired: number;
  refundsUnlinked: number;
  ledgerEntriesRemoved: number;
};

/**
 * Undoes an import (BUILD_PLAN section 5, D9). Always allowed, in one database
 * transaction: the batch's transactions, splits and bank balances are
 * soft-deleted; receipts go back to unmatched; open questions about them are
 * closed; a transfer's surviving side becomes an unpaired transfer (a side the
 * system posted is removed too); refunds of removed purchases are unlinked and
 * get a question; automatic ma'aser and reserve entries from them are removed
 * and a ledger rebuild is queued. Manual ledger entries and rules stay.
 */
export async function undoImport(db: Db, { householdId, batchId, actor }: { householdId: string; batchId: string; actor: Actor }): Promise<UndoResult> {
  return db.transaction(async (tx) => {
    const batch = await getBatch(tx, householdId, batchId);
    if (!batch) throw new Error("That import doesn’t exist in this household.");
    if (batch.status === "undone") throw new Error("This import has already been undone.");

    const now = nowIso();
    const ctx = { actor, reason: "Undid an import", importBatchId: batchId };
    const own = { actor, reason: "Undid an import" };
    const rows = await batchRows(tx, householdId, batchId);
    const ids = rows.map((r) => r.id);
    const result: UndoResult = {
      transactionsRemoved: ids.length,
      receiptsReleased: 0,
      questionsClosed: 0,
      transfersUnpaired: 0,
      refundsUnlinked: 0,
      ledgerEntriesRemoved: 0,
    };
    const scope = { householdId, ids };

    if (ids.length > 0) {
      const splits = await tx
        .select({ id: transactionSplits.id })
        .from(transactionSplits)
        .where(and(eq(transactionSplits.householdId, householdId), inArray(transactionSplits.transactionId, ids), isNull(transactionSplits.deletedAt)));
      const splitIds = splits.map((s) => s.id);

      // Transfers: the surviving other side becomes unpaired; a system-posted side goes too.
      const groups = [...new Set(rows.map((r) => r.transferGroupId).filter((g): g is string => !!g))];
      const partners = groups.length
        ? await tx
            .select()
            .from(transactions)
            .where(
              and(
                eq(transactions.householdId, householdId),
                inArray(transactions.transferGroupId, groups),
                notInArray(transactions.id, ids),
                isNull(transactions.deletedAt),
              ),
            )
        : [];
      const systemSides = partners.filter((p) => p.source === "system").map((p) => p.id);
      await updateBatchAudited(
        tx,
        transactions,
        { householdId, ids: systemSides },
        { deletedAt: now, transferGroupId: null, updatedAt: now },
        { ...ctx, reason: "Undid an import: removed the transfer side the system had posted" },
      );
      for (const partner of partners.filter((p) => p.source !== "system")) {
        await updateAudited(tx, transactions, { id: partner.id, householdId }, { transferGroupId: null, updatedAt: now }, { ...own, reason: "Undid an import: the other side of this transfer was removed" });
        result.transfersUnpaired++;
      }
      const removedIds = [...ids, ...systemSides];

      // Refunds of removed purchases are unlinked and get a question.
      const orphanedRefunds = await tx
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.householdId, householdId),
            inArray(transactions.refundOfId, removedIds),
            notInArray(transactions.id, removedIds),
            isNull(transactions.deletedAt),
          ),
        );
      for (const refund of orphanedRefunds) {
        await updateAudited(tx, transactions, { id: refund.id, householdId }, { refundOfId: null, status: "unconfirmed", updatedAt: now }, { ...own, reason: "Undid an import: the refunded purchase was removed" });
        await insertAudited(
          tx,
          questions,
          {
            id: newId(),
            householdId,
            subjectType: "transaction",
            subjectId: refund.id,
            type: "refund",
            options: [
              { key: "find_purchase", label: "Find the purchase" },
              { key: "not_a_refund", label: "It isn’t a refund" },
            ],
            createdAt: now,
            updatedAt: now,
          },
          { ...own, reason: "Undid an import: the refunded purchase was removed" },
        );
        result.refundsUnlinked++;
      }

      // Receipts go back to unmatched.
      const matched = await tx
        .select({ id: receipts.id })
        .from(receipts)
        .where(and(eq(receipts.householdId, householdId), inArray(receipts.matchedTransactionId, removedIds), isNull(receipts.deletedAt)));
      for (const receipt of matched) {
        await updateAudited(tx, receipts, { id: receipt.id, householdId }, { matchedTransactionId: null, matchConfidence: null, updatedAt: now }, { ...own, reason: "Undid an import: the matched payment was removed" });
      }
      result.receiptsReleased = matched.length;

      // Open questions about removed rows or their transfer pairs are closed.
      const open = await tx
        .select({ id: questions.id })
        .from(questions)
        .where(
          and(
            eq(questions.householdId, householdId),
            or(eq(questions.status, "open"), eq(questions.status, "sent")),
            or(
              and(eq(questions.subjectType, "transaction"), inArray(questions.subjectId, removedIds)),
              groups.length ? and(eq(questions.subjectType, "transfer_pair"), inArray(questions.subjectId, groups)) : undefined,
            ),
          ),
        );
      // "Is this the same payment as …?" questions on other rows whose match is being removed.
      const removed = new Set(removedIds);
      const duplicateQuestions = await tx
        .select({ id: questions.id, options: questions.options })
        .from(questions)
        .where(and(eq(questions.householdId, householdId), eq(questions.type, "duplicate"), or(eq(questions.status, "open"), eq(questions.status, "sent"))));
      const pointingHere = duplicateQuestions.filter((q) => q.options.some((o) => o.key.startsWith("same_as:") && removed.has(o.key.slice("same_as:".length))));
      const toClose = [...new Set([...open.map((q) => q.id), ...pointingHere.map((q) => q.id)])];
      result.questionsClosed = await updateBatchAudited(tx, questions, { householdId, ids: toClose }, { status: "expired", updatedAt: now }, ctx);

      // Automatic ledger entries from these rows go; manual ones stay.
      const sourced = (table: typeof maaserLedger | typeof reserveMovements) =>
        and(
          eq(table.householdId, householdId),
          eq(table.origin, "auto"),
          isNull(table.deletedAt),
          or(inArray(table.sourceTransactionId, removedIds), splitIds.length ? inArray(table.sourceSplitId, splitIds) : undefined),
        );
      const maaser = await tx.select({ id: maaserLedger.id }).from(maaserLedger).where(sourced(maaserLedger));
      const reserve = await tx.select({ id: reserveMovements.id }).from(reserveMovements).where(sourced(reserveMovements));
      result.ledgerEntriesRemoved =
        (await updateBatchAudited(tx, maaserLedger, { householdId, ids: maaser.map((m) => m.id) }, { deletedAt: now }, ctx)) +
        (await updateBatchAudited(tx, reserveMovements, { householdId, ids: reserve.map((m) => m.id) }, { deletedAt: now }, ctx));

      await updateBatchAudited(tx, transactionSplits, { householdId, ids: splitIds }, { deletedAt: now, updatedAt: now }, ctx);
      await updateBatchAudited(tx, transactions, scope, { deletedAt: now, transferGroupId: null, refundOfId: null, updatedAt: now }, ctx);

      const earliest = rows.reduce((min, r) => (r.date < min ? r.date : min), rows[0]!.date);
      await enqueue(tx, { type: "ledger_rebuild", householdId, payload: { fromDate: earliest } });
    }

    const checkpoints = await tx
      .select({ id: balanceCheckpoints.id })
      .from(balanceCheckpoints)
      .where(and(eq(balanceCheckpoints.householdId, householdId), eq(balanceCheckpoints.importBatchId, batchId), isNull(balanceCheckpoints.deletedAt)));
    await updateBatchAudited(tx, balanceCheckpoints, { householdId, ids: checkpoints.map((c) => c.id) }, { deletedAt: now }, ctx);

    // If this import set the account's opening balance, put back what it was (unless it has since been changed).
    const [openingEntry] = await tx
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.householdId, householdId), eq(auditLog.importBatchId, batchId), eq(auditLog.entity, "accounts"), eq(auditLog.entityId, batch.accountId)));
    if (openingEntry) {
      const before = openingEntry.before as { openingBalance: number; openingBalanceDate: string } | null;
      const after = openingEntry.after as { openingBalance: number; openingBalanceDate: string } | null;
      const [account] = await tx.select().from(accounts).where(and(eq(accounts.id, batch.accountId), eq(accounts.householdId, householdId)));
      if (before && after && account && account.openingBalance === after.openingBalance && account.openingBalanceDate === after.openingBalanceDate) {
        await updateAudited(
          tx,
          accounts,
          { id: account.id, householdId },
          { openingBalance: before.openingBalance, openingBalanceDate: before.openingBalanceDate, updatedAt: now },
          { ...ctx, reason: "Undid an import: restored the opening balance it had set" },
        );
      }
    }

    await updateAudited(tx, importBatches, { id: batchId, householdId }, { status: "undone", undoneAt: now, updatedAt: now }, ctx);
    return result;
  });
}

