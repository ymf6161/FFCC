import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import {
  accounts,
  auditLog,
  balanceCheckpoints,
  importBatches,
  jobs,
  maaserLedger,
  questions,
  receipts,
  reserveMovements,
  reserves,
  rules,
  transactionSplits,
  transactions,
} from "@/db/schema";
import type { Mapping } from "@/import/mapping";
import { runImport } from "@/import/pipeline";
import { undoImport, undoWarning } from "@/import/undo";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { createTestDb, makeHousehold } from "./helpers";

let db: Db;
let cleanup: () => void;
beforeAll(async () => ({ db, cleanup } = await createTestDb()));
afterAll(() => cleanup());

const SIGNED: Mapping = { headerRow: 0, dateColumn: "Date", dateFormat: "dd/mm/yyyy", amountColumn: "Amount", signConvention: "money_in_positive", descriptionColumns: ["Description"] };
const BALANCED: Mapping = { ...SIGNED, runningBalanceColumn: "Balance" };

type H = Awaited<ReturnType<typeof makeHousehold>>;
const importText = (h: H, accountId: string, text: string, mapping: Mapping = SIGNED) =>
  runImport(db, { householdId: h.householdId, accountId, fileName: "test.csv", csvText: text, mapping, profileName: "Test", actor: h.actor });

const row = async (id: string) => (await db.select().from(transactions).where(eq(transactions.id, id)))[0]!;
const byDescription = async (accountId: string, description: string) =>
  (await db.select().from(transactions).where(and(eq(transactions.accountId, accountId), eq(transactions.rawDescription, description))))[0]!;

describe("undo after confirmations (done when: no orphaned receipts, pairs or ledger entries)", () => {
  it("cleans up every link and keeps what the family entered by hand", async () => {
    const h = await makeHousehold(db, ["current", "savings", "current"]);
    const [current, savings, manualAccount] = h.accountIds as [string, string, string];
    await db.update(accounts).set({ isManual: true }).where(eq(accounts.id, manualAccount));
    const now = nowIso();

    // Batch A (the one we undo) on the current account.
    const a = await importText(
      h,
      current,
      "Date,Description,Amount,Balance\n01/03/2026,SALARY,1000.00,1000.00\n02/03/2026,SHOP,-50.00,950.00\n03/03/2026,TO SAVINGS,-100.00,850.00\n04/03/2026,TO PENSION,-25.00,825.00\n",
      BALANCED,
    );
    // Batch B on savings: the other side of the transfer. Batch C on current: a refund of SHOP.
    await importText(h, savings, "Date,Description,Amount\n03/03/2026,FROM CURRENT,100.00\n");
    await importText(h, current, "Date,Description,Amount\n09/03/2026,REFUND SHOP,20.00\n");

    const salary = await byDescription(current, "SALARY");
    const shop = await byDescription(current, "SHOP");
    const toSavings = await byDescription(current, "TO SAVINGS");
    const toPension = await byDescription(current, "TO PENSION");
    const fromCurrent = await byDescription(savings, "FROM CURRENT");
    const refund = await byDescription(current, "REFUND SHOP");

    // What the engine and the family would have done since (set directly for the test).
    await db.update(transactions).set({ status: "confirmed", updatedAt: "2099-01-01T00:00:00.000Z" }).where(eq(transactions.id, salary.id));
    await db.update(transactions).set({ transferGroupId: "pair-1" }).where(eq(transactions.id, toSavings.id));
    await db.update(transactions).set({ transferGroupId: "pair-1" }).where(eq(transactions.id, fromCurrent.id));
    await db.update(transactions).set({ transferGroupId: "pair-2" }).where(eq(transactions.id, toPension.id));
    const systemSide = newId();
    await db.insert(transactions).values({
      id: systemSide, householdId: h.householdId, accountId: manualAccount, date: "2026-03-04", amount: 2500, rawDescription: "Transfer in",
      source: "system", dedupeKey: "system", transferGroupId: "pair-2", createdAt: now, updatedAt: now,
    });
    await db.update(transactions).set({ refundOfId: shop.id }).where(eq(transactions.id, refund.id));
    const split = newId();
    await db.insert(transactionSplits).values({ id: split, householdId: h.householdId, transactionId: shop.id, amount: -5000, createdAt: now, updatedAt: now });
    const receipt = newId();
    await db.insert(receipts).values({ id: receipt, householdId: h.householdId, filePath: "r.jpg", source: "upload", matchedTransactionId: shop.id, matchConfidence: 90, createdAt: now, updatedAt: now });
    const reserve = newId();
    await db.insert(reserves).values({ id: reserve, householdId: h.householdId, name: "Tax", type: "tax", createdAt: now, updatedAt: now });
    const autoMaaser = newId();
    const manualMaaser = newId();
    await db.insert(maaserLedger).values([
      { id: autoMaaser, householdId: h.householdId, date: "2026-03-01", kind: "accrual", amount: 10000, origin: "auto", sourceTransactionId: salary.id, createdAt: now },
      { id: manualMaaser, householdId: h.householdId, date: "2026-03-01", kind: "adjustment", amount: 5000, origin: "manual", createdAt: now },
    ]);
    const autoReserve = newId();
    const manualReserve = newId();
    await db.insert(reserveMovements).values([
      { id: autoReserve, householdId: h.householdId, reserveId: reserve, date: "2026-03-02", kind: "release", amount: -5000, origin: "auto", sourceSplitId: split, createdAt: now },
      { id: manualReserve, householdId: h.householdId, reserveId: reserve, date: "2026-03-02", kind: "allocation", amount: 20000, origin: "manual", createdAt: now },
    ]);
    const shopQuestion = newId();
    const pairQuestion = newId();
    const answered = newId();
    await db.insert(questions).values([
      { id: shopQuestion, householdId: h.householdId, subjectType: "transaction", subjectId: shop.id, type: "category", options: [], createdAt: now, updatedAt: now },
      { id: pairQuestion, householdId: h.householdId, subjectType: "transfer_pair", subjectId: "pair-1", type: "transfer", options: [], status: "sent", createdAt: now, updatedAt: now },
      { id: answered, householdId: h.householdId, subjectType: "transaction", subjectId: salary.id, type: "category", options: [], status: "answered", answer: "1", createdAt: now, updatedAt: now },
    ]);
    const rule = newId();
    await db.insert(rules).values({ id: rule, householdId: h.householdId, conditions: { merchant: "SHOP" }, actions: {}, origin: "answer", createdAt: now, updatedAt: now });

    // The warning lists what will go and what the family has touched.
    expect(await undoWarning(db, h.householdId, a.batchId)).toEqual({ transactionCount: 4, confirmedOrEdited: 1, alreadyUndone: false });

    const result = await undoImport(db, { householdId: h.householdId, batchId: a.batchId, actor: h.actor });
    expect(result).toEqual({ transactionsRemoved: 4, receiptsReleased: 1, questionsClosed: 2, transfersUnpaired: 1, refundsUnlinked: 1, ledgerEntriesRemoved: 2 });

    // The batch's rows, their split and bank balances are soft-deleted, never removed.
    for (const t of [salary, shop, toSavings, toPension]) expect((await row(t.id)).deletedAt).not.toBeNull();
    expect((await db.select().from(transactionSplits).where(eq(transactionSplits.id, split)))[0]!.deletedAt).not.toBeNull();
    expect(await db.select().from(balanceCheckpoints).where(and(eq(balanceCheckpoints.importBatchId, a.batchId), isNull(balanceCheckpoints.deletedAt)))).toHaveLength(0);

    // No orphaned receipts.
    expect((await db.select().from(receipts).where(eq(receipts.id, receipt)))[0]).toMatchObject({ matchedTransactionId: null, matchConfidence: null });
    // No orphaned pairs: the surviving side is an unpaired transfer; the system-posted side is gone.
    expect((await row(fromCurrent.id))).toMatchObject({ transferGroupId: null, deletedAt: null });
    expect((await row(systemSide)).deletedAt).not.toBeNull();
    const stillPaired = await db.select().from(transactions).where(and(eq(transactions.householdId, h.householdId), isNull(transactions.deletedAt)));
    expect(stillPaired.filter((t) => t.transferGroupId !== null)).toHaveLength(0);
    // The refund is unlinked and gets a question.
    expect(await row(refund.id)).toMatchObject({ refundOfId: null, status: "unconfirmed", deletedAt: null });
    const [refundQuestion] = await db.select().from(questions).where(and(eq(questions.subjectId, refund.id), eq(questions.type, "refund")));
    expect(refundQuestion?.status).toBe("open");
    // No orphaned ledger entries: automatic ones go, manual ones stay.
    const liveMaaser = await db.select().from(maaserLedger).where(and(eq(maaserLedger.householdId, h.householdId), isNull(maaserLedger.deletedAt)));
    expect(liveMaaser.map((m) => m.id)).toEqual([manualMaaser]);
    const liveReserve = await db.select().from(reserveMovements).where(and(eq(reserveMovements.householdId, h.householdId), isNull(reserveMovements.deletedAt)));
    expect(liveReserve.map((m) => m.id)).toEqual([manualReserve]);
    // Open questions about removed rows are closed; answered ones are left alone; rules stay.
    const qs = new Map((await db.select().from(questions).where(eq(questions.householdId, h.householdId))).map((q) => [q.id, q.status]));
    expect([qs.get(shopQuestion), qs.get(pairQuestion), qs.get(answered)]).toEqual(["expired", "expired", "answered"]);
    expect(await db.select().from(rules).where(eq(rules.id, rule))).toHaveLength(1);

    // The batch is marked undone, a ledger rebuild is queued, and the change is audited.
    expect((await db.select().from(importBatches).where(eq(importBatches.id, a.batchId)))[0]).toMatchObject({ status: "undone" });
    const queued = await db.select().from(jobs).where(and(eq(jobs.householdId, h.householdId), eq(jobs.type, "ledger_rebuild")));
    expect(queued.map((j) => j.payload)).toEqual([{ fromDate: "2026-03-01" }]);
    const entries = await db.select().from(auditLog).where(and(eq(auditLog.importBatchId, a.batchId), eq(auditLog.reason, "Undid an import")));
    expect(entries.find((e) => e.entity === "transactions")?.after).toMatchObject({ rowCount: 4 });
  });

  it("refuses a second undo and another household's undo", async () => {
    const h = await makeHousehold(db);
    const other = await makeHousehold(db);
    const a = await importText(h, h.accountIds[0]!, "Date,Description,Amount\n01/03/2026,SHOP,-5.00\n");
    await expect(undoImport(db, { householdId: other.householdId, batchId: a.batchId, actor: other.actor })).rejects.toThrow(/doesn’t exist in this household/);
    expect(await undoWarning(db, other.householdId, a.batchId)).toBeNull();
    await undoImport(db, { householdId: h.householdId, batchId: a.batchId, actor: h.actor });
    await expect(undoImport(db, { householdId: h.householdId, batchId: a.batchId, actor: h.actor })).rejects.toThrow(/already been undone/);
    expect((await undoWarning(db, h.householdId, a.batchId))?.alreadyUndone).toBe(true);
  });

  it("lets the same file be imported again after an undo", async () => {
    const h = await makeHousehold(db);
    const accountId = h.accountIds[0]!;
    const text = "Date,Description,Amount,Balance\n01/03/2026,COFFEE,-3.20,96.80\n01/03/2026,COFFEE,-3.20,93.60\n";
    const first = await importText(h, accountId, text, BALANCED);
    await undoImport(db, { householdId: h.householdId, batchId: first.batchId, actor: h.actor });
    const again = await importText(h, accountId, text, BALANCED);
    expect(again.counts).toMatchObject({ new: 2, duplicate: 0 });
    const live = await db.select().from(transactions).where(and(eq(transactions.accountId, accountId), isNull(transactions.deletedAt)));
    expect(live).toHaveLength(2);
    const checkpoints = await db.select().from(balanceCheckpoints).where(and(eq(balanceCheckpoints.accountId, accountId), isNull(balanceCheckpoints.deletedAt)));
    expect(checkpoints).toHaveLength(1);
  });
});

describe("undo, review fixes", () => {
  it("closes “same payment?” questions on other rows that point at a removed row", async () => {
    const h = await makeHousehold(db);
    const accountId = h.accountIds[0]!;
    const first = await importText(h, accountId, "Date,Description,Amount\n01/03/2026,CARD PAYMENT TO FRESHWAYS,-42.10\n");
    // Another layout of the same account: stored as a near duplicate with a question pointing at the first row.
    await runImport(db, {
      householdId: h.householdId,
      accountId,
      fileName: "other.csv",
      csvText: "Number,Date,Account,Amount,Subcategory,Memo\n,03/03/2026,99-99-99 12345678,-42.10,Debit,FRESHWAYS SUPERMARKET\n",
      mapping: { headerRow: 0, dateColumn: "Date", dateFormat: "dd/mm/yyyy", amountColumn: "Amount", signConvention: "money_in_positive", descriptionColumns: ["Memo"] },
      profileName: "Other",
      actor: h.actor,
    });
    const [question] = await db.select().from(questions).where(and(eq(questions.householdId, h.householdId), eq(questions.type, "duplicate")));
    expect(question?.status).toBe("open");

    await undoImport(db, { householdId: h.householdId, batchId: first.batchId, actor: h.actor });
    const [after] = await db.select().from(questions).where(eq(questions.id, question!.id));
    expect(after?.status).toBe("expired");
  });

  it("puts back the opening balance the import had set", async () => {
    const h = await makeHousehold(db);
    const accountId = h.accountIds[0]!;
    const [before] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    const a = await importText(h, accountId, "Date,Description,Amount,Balance\n02/03/2026,SHOP,-5.00,95.00\n", BALANCED);
    const [during] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    expect(during).toMatchObject({ openingBalance: 10000, openingBalanceDate: "2026-03-01" });

    await undoImport(db, { householdId: h.householdId, batchId: a.batchId, actor: h.actor });
    const [after] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    expect(after).toMatchObject({ openingBalance: before!.openingBalance, openingBalanceDate: before!.openingBalanceDate });
  });

  it("leaves an opening balance alone if the family changed it after the import", async () => {
    const h = await makeHousehold(db);
    const accountId = h.accountIds[0]!;
    const a = await importText(h, accountId, "Date,Description,Amount,Balance\n02/03/2026,SHOP,-5.00,95.00\n", BALANCED);
    await db.update(accounts).set({ openingBalance: 12345 }).where(eq(accounts.id, accountId));
    await undoImport(db, { householdId: h.householdId, batchId: a.batchId, actor: h.actor });
    const [after] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    expect(after?.openingBalance).toBe(12345);
  });
});
