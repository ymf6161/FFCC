import { and, count, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockAiProvider } from "@/ai";
import { addDetail, confirmTransaction, countFiledAs, createRuleFromCorrection, removeDetail, saveSplits, setCategory } from "@/activity/edits";
import type { Db } from "@/db";
import { getTransactionDetail, listOpenQuestions, listTransactions } from "@/db/queries";
import { auditLog, householdMerchants, maaserLedger, questions, rules, transactionEvents, transactionPersons, transactionSplits, transactionTags } from "@/db/schema";
import { runEngine } from "@/engine/run";
import { openQuestionsWithContext } from "@/questions/context";
import { questionText } from "@/questions/describe";
import { createTestDb } from "./helpers";
import { addTx, engineHousehold, run, tx } from "./rules/helpers";

let db: Db;
let cleanup: () => void;
beforeAll(async () => ({ db, cleanup } = await createTestDb()));
afterAll(() => cleanup());

const ids = async (householdId: string, filters: Parameters<typeof listTransactions>[2]) => (await listTransactions(db, householdId, { limit: 500, ...filters })).rows.map((r) => r.id).sort();

describe("Phase 4 done when: find any transaction, fix it, see the rule it created", () => {
  it("finds a payment by search, fixes its category, makes a rule, and the rule shows on the payment and applies to its other payments", async () => {
    const h = await engineHousehold(db, ["current"], { maaserBp: 1000 });
    const first = await addTx(db, h, { date: "2026-03-02", amount: -1_850, description: "SEFORIM CENTRE" });
    const second = await addTx(db, h, { date: "2026-03-09", amount: -2_400, description: "SEFORIM CENTRE" });
    await run(db, h);
    expect((await tx(db, first)).status).toBe("unconfirmed"); // the mock didn't know it

    // Find it.
    const found = await listTransactions(db, h.householdId, { q: "seforim" });
    expect(found.rows.map((r) => r.id)).toContain(first);

    // Fix it.
    const change = await setCategory(db, { householdId: h.householdId, transactionId: first, categoryId: h.cat("Household"), actor: h.actor });
    expect(change).toMatchObject({ categoryName: "Household", offerRule: true, merchant: "SEFORIM CENTRE" });
    expect(await tx(db, first)).toMatchObject({ categoryId: h.cat("Household"), status: "confirmed" });

    // "Always do this?" → a rule.
    const rule = await createRuleFromCorrection(db, { householdId: h.householdId, transactionId: first, actor: h.actor });
    expect(rule).toMatchObject({ merchant: "SEFORIM CENTRE", categoryName: "Household", questionsAnswered: 1 });
    const [saved] = await db.select().from(rules).where(eq(rules.id, rule.ruleId));
    expect(saved).toMatchObject({ origin: "correction", enabled: true, conditions: { merchant: "seforim centre" }, actions: { categoryId: h.cat("Household") } });

    // See it on the payment.
    const detail = await getTransactionDetail(db, h.householdId, first);
    expect(detail?.rules.map((r) => r.id)).toEqual([rule.ruleId]);
    expect(detail?.householdMerchant).toMatchObject({ confirmed: true, categoryId: h.cat("Household") });

    // It applies to the merchant's other payment on the next run, and no question is left about the merchant.
    await runEngine(db, h.householdId, { today: "2026-06-30", provider: new MockAiProvider(), actor: h.actor });
    expect(await tx(db, second)).toMatchObject({ categoryId: h.cat("Household"), status: "auto" });
    expect((await listOpenQuestions(db, h.householdId)).questions).toHaveLength(0);

    // A second "always" for the same merchant and category doesn't duplicate the rule.
    expect((await createRuleFromCorrection(db, { householdId: h.householdId, transactionId: first, actor: h.actor })).ruleId).toBe(rule.ruleId);
    expect((await setCategory(db, { householdId: h.householdId, transactionId: second, categoryId: h.cat("Household"), actor: h.actor })).offerRule).toBe(false);
  });

  it("replaces an older rule for the same merchant instead of keeping two that disagree", async () => {
    const h = await engineHousehold(db);
    const id = await addTx(db, h, { date: "2026-03-02", amount: -1_850, description: "מכולת השכונה" });
    await setCategory(db, { householdId: h.householdId, transactionId: id, categoryId: h.cat("Groceries"), actor: h.actor });
    const a = await createRuleFromCorrection(db, { householdId: h.householdId, transactionId: id, actor: h.actor });
    await setCategory(db, { householdId: h.householdId, transactionId: id, categoryId: h.cat("Household"), actor: h.actor });
    const b = await createRuleFromCorrection(db, { householdId: h.householdId, transactionId: id, actor: h.actor });
    const all = await db.select().from(rules).where(eq(rules.householdId, h.householdId));
    expect(all.find((r) => r.id === a.ruleId)?.enabled).toBe(false);
    expect(all.find((r) => r.id === b.ruleId)?.enabled).toBe(true);
  });
});

describe("search and filters", () => {
  it("searches descriptions, merchants and notes, in English (any case) and Hebrew, treating % and _ literally", async () => {
    const h = await engineHousehold(db, ["current"]);
    const a = await addTx(db, h, { date: "2026-03-01", amount: -1_000, description: "Freshways SUPERMARKET" });
    const b = await addTx(db, h, { date: "2026-03-02", amount: -2_000, description: "תרומה לקופת צדקה" });
    const c = await addTx(db, h, { date: "2026-03-03", amount: -3_000, description: "CASH 100% OFF", notes: "for the simcha" });
    expect(await ids(h.householdId, { q: "freshways" })).toEqual([a]);
    expect(await ids(h.householdId, { q: "צדקה" })).toEqual([b]);
    expect(await ids(h.householdId, { q: "simcha" })).toEqual([c]);
    expect(await ids(h.householdId, { q: "100%" })).toEqual([c]);
    expect(await ids(h.householdId, { q: "%" })).toEqual([c]);
    expect(await ids(h.householdId, { q: "_" })).toEqual([]);
  });

  it("filters by account, category (or not sorted), status and dates", async () => {
    const h = await engineHousehold(db, ["current", "credit_card"]);
    const a = await addTx(db, h, { account: 0, date: "2026-03-01", amount: -1_000, description: "A", categoryId: h.cat("Groceries"), status: "confirmed" });
    const b = await addTx(db, h, { account: 1, date: "2026-03-15", amount: -2_000, description: "B", status: "unconfirmed" });
    const c = await addTx(db, h, { account: 1, date: "2026-04-01", amount: -3_000, description: "C", categoryId: h.cat("Fuel"), status: "auto" });
    expect(await ids(h.householdId, { accountId: h.account(1) })).toEqual([b, c].sort());
    expect(await ids(h.householdId, { categoryId: h.cat("Groceries") })).toEqual([a]);
    expect(await ids(h.householdId, { categoryId: "none" })).toEqual([b]);
    expect(await ids(h.householdId, { status: "unconfirmed" })).toEqual([b]);
    expect(await ids(h.householdId, { from: "2026-03-10", to: "2026-03-31" })).toEqual([b]);
  });

  it("filters by tag, event and person, and never shows another household's rows", async () => {
    const h = await engineHousehold(db);
    const other = await engineHousehold(db);
    const a = await addTx(db, h, { date: "2026-03-01", amount: -1_000, description: "HALL HIRE" });
    const b = await addTx(db, h, { date: "2026-03-02", amount: -2_000, description: "CATERER" });
    const theirs = await addTx(db, other, { date: "2026-03-02", amount: -2_000, description: "CATERER" });
    await addDetail(db, { householdId: h.householdId, kind: "event", name: "בר מצווה", transactionIds: [a, b], actor: h.actor });
    await addDetail(db, { householdId: h.householdId, kind: "person", name: "Sarah", transactionIds: [b], actor: h.actor });
    await addDetail(db, { householdId: h.householdId, kind: "tag", name: "simcha", transactionIds: [a], actor: h.actor });
    const detail = await getTransactionDetail(db, h.householdId, b);
    const eventId = detail!.events[0]!.id;
    const personId = detail!.persons[0]!.id;
    expect(await ids(h.householdId, { eventId })).toEqual([a, b].sort());
    expect(await ids(h.householdId, { personId })).toEqual([b]);
    expect(await ids(h.householdId, { tagId: (await getTransactionDetail(db, h.householdId, a))!.tags[0]!.id })).toEqual([a]);
    expect(await ids(other.householdId, { eventId })).toEqual([]);
    expect(await ids(other.householdId, { q: "caterer" })).toEqual([theirs]);
    expect(await getTransactionDetail(db, other.householdId, a)).toBeNull();
  });
});

describe("edits", () => {
  it("audits a category change, rebuilds ma'aser, drops a split and moves linked refunds with it", async () => {
    const h = await engineHousehold(db, ["current"], { maaserBp: 1000 });
    const pay = await addTx(db, h, { date: "2026-03-05", amount: -5_000, description: "קרן ידידים", categoryId: h.cat("Household"), status: "auto" });
    const refund = await addTx(db, h, { date: "2026-03-08", amount: 1_000, description: "REFUND קרן ידידים", categoryId: h.cat("Household"), status: "auto", refundOfId: pay });
    await saveSplits(db, { householdId: h.householdId, transactionId: pay, lines: [{ categoryId: h.cat("Household"), amount: -3_000 }, { categoryId: h.cat("Groceries"), amount: -2_000 }], actor: h.actor });
    await setCategory(db, { householdId: h.householdId, transactionId: pay, categoryId: h.cat("Charity"), actor: h.actor });
    expect(await db.select().from(transactionSplits).where(and(eq(transactionSplits.transactionId, pay), isNull(transactionSplits.deletedAt)))).toHaveLength(0);
    expect((await tx(db, refund)).categoryId).toBe(h.cat("Charity"));
    const ledger = await db.select().from(maaserLedger).where(and(eq(maaserLedger.householdId, h.householdId), isNull(maaserLedger.deletedAt)));
    expect(ledger.reduce((s, e) => s + e.amount, 0)).toBe(-4_000); // £50 given, £10 back
    const entries = await db.select().from(auditLog).where(and(eq(auditLog.entityId, pay), eq(auditLog.reason, "Changed the category")));
    expect(entries.length).toBeGreaterThan(0);
  });

  it("only saves a split that adds up exactly, and confirms the payment", async () => {
    const h = await engineHousehold(db);
    const id = await addTx(db, h, { date: "2026-03-05", amount: -10_000, description: "FRESHWAYS SUPERMARKET", categoryId: h.cat("Groceries"), status: "auto" });
    await expect(saveSplits(db, { householdId: h.householdId, transactionId: id, lines: [{ categoryId: h.cat("Groceries"), amount: -9_000 }], actor: h.actor })).rejects.toThrow(/add up to/);
    await saveSplits(db, { householdId: h.householdId, transactionId: id, lines: [{ categoryId: h.cat("Groceries"), amount: -7_000 }, { categoryId: h.cat("Clothing"), amount: -3_000 }], actor: h.actor });
    expect((await tx(db, id)).status).toBe("confirmed");
  });

  it("refuses to edit another household's transaction or use its category", async () => {
    const h = await engineHousehold(db);
    const other = await engineHousehold(db);
    const theirs = await addTx(db, other, { date: "2026-03-05", amount: -1_000, description: "X" });
    const mine = await addTx(db, h, { date: "2026-03-05", amount: -1_000, description: "Y" });
    await expect(setCategory(db, { householdId: h.householdId, transactionId: theirs, categoryId: h.cat("Groceries"), actor: h.actor })).rejects.toThrow(/doesn’t exist in this household/);
    await expect(setCategory(db, { householdId: h.householdId, transactionId: mine, categoryId: other.cat("Groceries"), actor: h.actor })).rejects.toThrow(/doesn’t exist in this household/);
    await expect(addDetail(db, { householdId: h.householdId, kind: "tag", name: "x", transactionIds: [theirs], actor: h.actor })).rejects.toThrow(/don’t exist in this household/);
    await expect(confirmTransaction(db, { householdId: h.householdId, transactionId: theirs, actor: h.actor })).rejects.toThrow();
  });

  it("tags many rows at once, idempotently, with an audit entry per link, and can remove one", async () => {
    const h = await engineHousehold(db);
    const a = await addTx(db, h, { date: "2026-03-01", amount: -1_000, description: "A" });
    const b = await addTx(db, h, { date: "2026-03-02", amount: -1_000, description: "B" });
    expect(await addDetail(db, { householdId: h.householdId, kind: "tag", name: "  Pesach  ", transactionIds: [a, b], actor: h.actor })).toBe(2);
    expect(await addDetail(db, { householdId: h.householdId, kind: "tag", name: "Pesach", transactionIds: [a, b], actor: h.actor })).toBe(0);
    const tagId = (await getTransactionDetail(db, h.householdId, a))!.tags[0]!.id;
    await removeDetail(db, { householdId: h.householdId, kind: "tag", detailId: tagId, transactionId: a, actor: h.actor });
    expect((await getTransactionDetail(db, h.householdId, a))!.tags).toEqual([]);
    const linkEntries = await db.select().from(auditLog).where(and(eq(auditLog.householdId, h.householdId), eq(auditLog.entity, "transaction_tags")));
    expect(linkEntries).toHaveLength(3);
  });

  it("never adds tags, events or people by itself (CLAUDE.md)", async () => {
    const h = await engineHousehold(db, ["current"], { maaserBp: 1000 });
    await addTx(db, h, { date: "2026-03-01", amount: -1_000, description: "SIMCHA HALL BAR MITZVAH" });
    await run(db, h);
    for (const table of [transactionTags, transactionEvents, transactionPersons]) {
      expect((await db.select({ n: count() }).from(table).where(eq(table.householdId, h.householdId)))[0]!.n).toBe(0);
    }
  });
});

describe("transaction detail and questions", () => {
  it("shows the import entry, changes, transfer partner and refund links", async () => {
    const h = await engineHousehold(db, ["current", "savings"]);
    const out = await addTx(db, h, { account: 0, date: "2026-03-01", amount: -5_000, description: "TRANSFER TO SAVINGS" });
    const into = await addTx(db, h, { account: 1, date: "2026-03-01", amount: 5_000, description: "TRANSFER FROM CURRENT ACCOUNT" });
    const buy = await addTx(db, h, { date: "2026-03-02", amount: -2_000, description: "LITTLE STEPS KIDSWEAR" });
    const back = await addTx(db, h, { date: "2026-03-05", amount: 2_000, description: "REFUND LITTLE STEPS KIDSWEAR" });
    await run(db, h);
    expect((await getTransactionDetail(db, h.householdId, out))!.transferPartner?.id).toBe(into);
    expect((await getTransactionDetail(db, h.householdId, back))!.refundOf?.id).toBe(buy);
    expect((await getTransactionDetail(db, h.householdId, buy))!.refunds.map((r) => r.id)).toEqual([back]);
    const history = (await getTransactionDetail(db, h.householdId, out))!.history;
    expect(history.map((e) => e.reason)).toContain("Sorted by the engine");
  });

  it("words merchant questions with the number of payments and the latest one (Hebrew)", async () => {
    const h = await engineHousehold(db, ["current"]);
    await addTx(db, h, { date: "2026-03-01", amount: -1_200, description: "פיצה ירושלים" });
    await addTx(db, h, { date: "2026-03-08", amount: -1_800, description: "פיצה ירושלים" });
    await run(db, h);
    const [item] = await openQuestionsWithContext(db, h.householdId);
    expect(item!.ctx).toMatchObject({ payee: "פיצה ירושלים", count: 2, amount: -1_800, date: "2026-03-08" });
    expect(questionText(item!.ctx)).toBe("What is פיצה ירושלים?");
    const qs = await db.select().from(questions).where(eq(questions.householdId, h.householdId));
    expect(qs).toHaveLength(1);
    expect(await db.select().from(householdMerchants).where(eq(householdMerchants.householdId, h.householdId))).toHaveLength(1);
  });
});

describe("edits keep transfers, refunds and FFCC's own rows intact (rules 3 and 4)", () => {
  it("keeps a paired transfer in a transfer category and refuses to split it", async () => {
    const h = await engineHousehold(db, ["current", "savings"]);
    const out = await addTx(db, h, { account: 0, date: "2026-03-01", amount: -5_000, description: "TRANSFER TO SAVINGS" });
    await addTx(db, h, { account: 1, date: "2026-03-01", amount: 5_000, description: "TRANSFER FROM CURRENT ACCOUNT" });
    await run(db, h);
    expect((await tx(db, out)).transferGroupId).not.toBeNull();
    const base = { householdId: h.householdId, transactionId: out, actor: h.actor };
    await expect(setCategory(db, { ...base, categoryId: h.cat("Groceries") })).rejects.toThrow(/stays in a transfer category/);
    await expect(saveSplits(db, { ...base, lines: [{ categoryId: h.cat("Groceries"), amount: -5_000 }] })).rejects.toThrow(/can’t be split/);
    expect((await tx(db, out)).categoryId).toBe(h.cat("Transfer"));
  });

  it("keeps a refund in spending, and a purchase moved to income leaves its refund where it was", async () => {
    const h = await engineHousehold(db);
    const buy = await addTx(db, h, { date: "2026-03-02", amount: -2_000, description: "LITTLE STEPS KIDSWEAR", categoryId: h.cat("Clothing"), status: "auto" });
    const back = await addTx(db, h, { date: "2026-03-05", amount: 2_000, description: "REFUND LITTLE STEPS KIDSWEAR", categoryId: h.cat("Clothing"), status: "auto", refundOfId: buy });
    await expect(setCategory(db, { householdId: h.householdId, transactionId: back, categoryId: h.cat("Salary"), actor: h.actor })).rejects.toThrow(/refund/);
    await expect(
      saveSplits(db, { householdId: h.householdId, transactionId: back, lines: [{ categoryId: h.cat("Salary"), amount: 2_000 }], actor: h.actor }),
    ).rejects.toThrow(/refund/);
    await setCategory(db, { householdId: h.householdId, transactionId: buy, categoryId: h.cat("Salary"), actor: h.actor });
    expect((await tx(db, back)).categoryId).toBe(h.cat("Clothing"));
  });

  it("refuses to change or split a row FFCC added itself", async () => {
    const h = await engineHousehold(db);
    const sys = await addTx(db, h, { date: "2026-03-31", amount: -1_000, description: "Cash spent in March", source: "system", categoryId: h.cat("Groceries"), status: "auto" });
    await expect(setCategory(db, { householdId: h.householdId, transactionId: sys, categoryId: h.cat("Clothing"), actor: h.actor })).rejects.toThrow(/FFCC added/);
    await expect(
      saveSplits(db, { householdId: h.householdId, transactionId: sys, lines: [{ categoryId: h.cat("Clothing"), amount: -1_000 }], actor: h.actor }),
    ).rejects.toThrow(/FFCC added/);
  });

  it("refuses transfer categories on split lines and explains a split that doesn't add up in plain words", async () => {
    const h = await engineHousehold(db);
    const id = await addTx(db, h, { date: "2026-03-05", amount: -10_000, description: "FRESHWAYS SUPERMARKET", categoryId: h.cat("Groceries"), status: "auto" });
    const base = { householdId: h.householdId, transactionId: id, actor: h.actor };
    await expect(saveSplits(db, { ...base, lines: [{ categoryId: h.cat("Groceries"), amount: -5_000 }, { categoryId: h.cat("Transfer"), amount: -5_000 }] })).rejects.toThrow(/not transfers/);
    await expect(saveSplits(db, { ...base, lines: [{ categoryId: h.cat("Groceries"), amount: -9_000 }] })).rejects.toThrow("The lines need to add up to the payment.");
  });

  it("counts only the merchant's own payments that a new rule changed", async () => {
    const h = await engineHousehold(db);
    const first = await addTx(db, h, { date: "2026-03-02", amount: -1_850, description: "SEFORIM CENTRE" });
    await addTx(db, h, { date: "2026-03-09", amount: -2_400, description: "SEFORIM CENTRE" });
    await addTx(db, h, { date: "2026-03-10", amount: -900, description: "SOMEWHERE ELSE ENTIRELY" });
    await setCategory(db, { householdId: h.householdId, transactionId: first, categoryId: h.cat("Household"), actor: h.actor });
    const rule = await createRuleFromCorrection(db, { householdId: h.householdId, transactionId: first, actor: h.actor });
    expect(rule.candidateIds).toHaveLength(1);
    const summary = await run(db, h);
    expect(summary.rowsChanged).toBeGreaterThan(1); // the engine also sorted the other merchant
    expect(await countFiledAs(db, h.householdId, rule.candidateIds, rule.categoryId)).toBe(1);
  });

  it("shows a split payment as Split in the list", async () => {
    const h = await engineHousehold(db);
    const id = await addTx(db, h, { date: "2026-03-05", amount: -10_000, description: "FRESHWAYS SUPERMARKET", categoryId: h.cat("Groceries"), status: "auto" });
    await saveSplits(db, { householdId: h.householdId, transactionId: id, lines: [{ categoryId: h.cat("Groceries"), amount: -7_000 }, { categoryId: h.cat("Clothing"), amount: -3_000 }], actor: h.actor });
    const [row] = (await listTransactions(db, h.householdId, {})).rows;
    expect(row!.categoryName).toBe("Split");
  });
});
