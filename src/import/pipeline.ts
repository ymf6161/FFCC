import { and, count, eq, gte, isNull, lte } from "drizzle-orm";
import { type Actor, insertAudited, insertBatchAudited, updateAudited } from "@/audit";
import type { Db, Executor } from "@/db";
import { accounts, balanceCheckpoints, bankProfiles, importBatches, questions, transactions } from "@/db/schema";
import { enqueue } from "@/jobs/queue";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { addDays } from "@/seed/dates";
import { parseCsv } from "./csv";
import { classifyRows, type DedupeStatus, type ExistingRow } from "./dedupe";
import { headerSignature, type Mapping } from "./mapping";
import { endOfDayBalances, type NormalisedRow, normaliseRows, type RowError } from "./normalise";

export type ClassifiedRow = NormalisedRow & {
  dedupeKey: string;
  dedupeOccurrence: number;
  status: DedupeStatus;
  nearMatchId?: string;
};

export type ImportCounts = { total: number; new: number; duplicate: number; nearDuplicate: number; error: number };

export type PreparedImport = {
  rows: ClassifiedRow[];
  errors: RowError[];
  counts: ImportCounts;
  signature: string;
  fileOrder: "oldest_first" | "newest_first";
  firstDate: string | null;
  lastDate: string | null;
};

/** Rows already stored for this account around the file's dates, for dedupe. */
async function loadExisting(ex: Executor, householdId: string, accountId: string, from: string, to: string): Promise<ExistingRow[]> {
  return ex
    .select({
      id: transactions.id,
      date: transactions.date,
      amount: transactions.amount,
      rawDescription: transactions.rawDescription,
      dedupeKey: transactions.dedupeKey,
      dedupeOccurrence: transactions.dedupeOccurrence,
      externalId: transactions.externalId,
      source: transactions.source,
      profileSignature: bankProfiles.headerSignature,
    })
    .from(transactions)
    .leftJoin(importBatches, eq(importBatches.id, transactions.importBatchId))
    .leftJoin(bankProfiles, eq(bankProfiles.id, importBatches.bankProfileId))
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.accountId, accountId),
        isNull(transactions.deletedAt),
        gte(transactions.date, from),
        lte(transactions.date, to),
      ),
    );
}

/** Parses, validates and classifies a file against one account. Writes nothing. */
export async function prepareImport(
  ex: Executor,
  { householdId, accountId, csvText, mapping }: { householdId: string; accountId: string | null; csvText: string; mapping: Mapping },
): Promise<PreparedImport> {
  const table = parseCsv(csvText);
  const signature = headerSignature(table[mapping.headerRow] ?? []);
  const { rows, errors, fileOrder } = normaliseRows(table, mapping);
  const firstDate = rows[0]?.date ?? null;
  const lastDate = rows.at(-1)?.date ?? null;
  // A new account (not created yet) has nothing to compare against.
  const existing = accountId && firstDate && lastDate ? await loadExisting(ex, householdId, accountId, addDays(firstDate, -3), addDays(lastDate, 3)) : [];
  const classified = classifyRows(rows, existing, signature);
  const tally = (s: DedupeStatus) => classified.filter((r) => r.status === s).length;
  const dataRows = Math.max(0, table.length - mapping.headerRow - 1);
  return {
    rows: classified,
    errors,
    counts: { total: dataRows, new: tally("new"), duplicate: tally("duplicate"), nearDuplicate: tally("near_duplicate"), error: errors.length },
    signature,
    fileOrder,
    firstDate,
    lastDate,
  };
}

export type ImportInput = {
  householdId: string;
  accountId: string;
  fileName: string;
  csvText: string;
  mapping: Mapping;
  profileName: string;
  actor: Actor;
};

export type ImportResult = { batchId: string; counts: ImportCounts };

/**
 * Imports a file in one database transaction: the batch, its new rows (one
 * audit entry), "duplicate?" questions for near matches, bank balances as
 * checkpoints, the account's opening balance if the account is new, and the
 * saved bank profile. Then queues categorisation. Importing the same data
 * again adds no transactions or checkpoints.
 */
export async function runImport(ex: Executor, input: ImportInput): Promise<ImportResult> {
  const { householdId, accountId, actor } = input;
  // Inside an open transaction (e.g. after creating the account) this becomes a savepoint.
  return (ex as Db).transaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId), isNull(accounts.deletedAt)));
    if (!account) throw new Error("That account doesn’t exist in this household.");
    // Loans and mortgages hold no transactions; their value comes from manual valuations (BUILD_PLAN section 5).
    if (account.type === "loan" || account.type === "mortgage") throw new Error("That account can’t hold transactions.");

    const prepared = await prepareImport(tx, input);
    const now = nowIso();
    const ctx = (reason: string, importBatchId?: string) => ({ actor, reason, importBatchId });

    const profile = await saveProfile(tx, { householdId, name: input.profileName, signature: prepared.signature, mapping: input.mapping, actor });

    const [{ n: priorRows } = { n: 0 }] = await tx
      .select({ n: count() })
      .from(transactions)
      .where(and(eq(transactions.accountId, accountId), eq(transactions.householdId, householdId), isNull(transactions.deletedAt)));

    const batch = await insertAudited(
      tx,
      importBatches,
      {
        id: newId(),
        householdId,
        accountId,
        bankProfileId: profile.id,
        fileName: input.fileName.slice(0, 200),
        newCount: prepared.counts.new + prepared.counts.nearDuplicate,
        duplicateCount: prepared.counts.duplicate,
        nearDuplicateCount: prepared.counts.nearDuplicate,
        errorCount: prepared.counts.error,
        status: "complete",
        createdAt: now,
        updatedAt: now,
      },
      ctx("Imported a CSV file"),
    );

    const toStore = prepared.rows.filter((r) => r.status !== "duplicate").map((r) => ({ ...r, id: newId() }));
    if (toStore.length > 0) {
      await insertBatchAudited(
        tx,
        transactions,
        toStore.map((r) => ({
          id: r.id,
          householdId,
          accountId,
          date: r.date,
          amount: r.amount,
          rawDescription: r.description,
          source: "csv" as const,
          bookingStatus: "booked" as const,
          externalId: r.externalId ?? null,
          dedupeKey: r.dedupeKey,
          dedupeOccurrence: r.dedupeOccurrence,
          importBatchId: batch.id,
          status: "unconfirmed" as const,
          createdAt: now,
          updatedAt: now,
        })),
        { ...ctx("Imported transactions", batch.id), batchId: batch.id, importBatchId: batch.id, householdId },
      );
    }

    for (const row of toStore.filter((r) => r.status === "near_duplicate")) {
      await insertAudited(
        tx,
        questions,
        {
          id: newId(),
          householdId,
          subjectType: "transaction",
          subjectId: row.id,
          type: "duplicate",
          options: [
            { key: "keep_both", label: "Keep both" },
            { key: `same_as:${row.nearMatchId}`, label: "It’s the same payment" },
          ],
          createdAt: now,
          updatedAt: now,
        },
        ctx("Possible duplicate found during import", batch.id),
      );
    }

    // Bank balances become checkpoints, once per day, never twice.
    const balances = endOfDayBalances(prepared.rows);
    if (balances.length > 0) {
      const existing = await tx
        .select({ date: balanceCheckpoints.date })
        .from(balanceCheckpoints)
        .where(
          and(
            eq(balanceCheckpoints.accountId, accountId),
            eq(balanceCheckpoints.source, "csv_running_balance"),
            isNull(balanceCheckpoints.deletedAt),
          ),
        );
      const seen = new Set(existing.map((e) => e.date));
      const fresh = balances.filter((b) => !seen.has(b.date));
      if (fresh.length > 0) {
        await insertBatchAudited(
          tx,
          balanceCheckpoints,
          fresh.map((b) => ({
            id: newId(),
            householdId,
            accountId,
            date: b.date,
            balance: b.balance,
            source: "csv_running_balance" as const,
            importBatchId: batch.id,
            createdAt: now,
          })),
          { ...ctx("Stored bank balances from the file", batch.id), batchId: batch.id, importBatchId: batch.id, householdId },
        );
      }

      // A brand-new account starts from the bank's own figure.
      const opening = openingFromBalances(prepared.rows);
      if (priorRows === 0 && opening) {
        await updateAudited(
          tx,
          accounts,
          { id: accountId, householdId },
          { openingBalance: opening.balance, openingBalanceDate: opening.date, updatedAt: now },
          ctx("Opening balance taken from the first imported row", batch.id),
        );
      }
    }

    if (toStore.length > 0) {
      await enqueue(tx, { type: "categorise_batch", householdId, payload: { batchId: batch.id } });
    }

    return { batchId: batch.id, counts: prepared.counts };
  });
}

/** The balance the day before the file starts: first reported balance minus the rows up to it. */
export function openingFromBalances(rows: NormalisedRow[]): { balance: number; date: string } | null {
  let running = 0;
  for (const row of rows) {
    running += row.amount;
    if (row.balance !== undefined) return { balance: row.balance - running, date: addDays(rows[0]!.date, -1) };
  }
  return null;
}

async function saveProfile(
  tx: Executor,
  p: { householdId: string; name: string; signature: string; mapping: Mapping; actor: Actor },
) {
  const now = nowIso();
  const [existing] = await tx
    .select()
    .from(bankProfiles)
    .where(and(eq(bankProfiles.householdId, p.householdId), eq(bankProfiles.headerSignature, p.signature)));
  const name = p.name.trim().slice(0, 80) || "My bank";
  if (existing) {
    if (existing.name === name && JSON.stringify(existing.mapping) === JSON.stringify(p.mapping)) return existing;
    return updateAudited(
      tx,
      bankProfiles,
      { id: existing.id, householdId: p.householdId },
      { name, mapping: p.mapping, updatedAt: now },
      { actor: p.actor, reason: "Updated saved bank format" },
    );
  }
  return insertAudited(
    tx,
    bankProfiles,
    { id: newId(), householdId: p.householdId, name, mapping: p.mapping, headerSignature: p.signature, createdAt: now, updatedAt: now },
    { actor: p.actor, reason: "Saved bank format" },
  );
}
