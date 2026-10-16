import { and, eq } from "drizzle-orm";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { accounts, categories, questions, rules, transactions } from "@/db/schema";
import { periodTotals } from "@/engine/totals";
import { confirmTransferToOwnAccount } from "@/engine/transfers";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { createTestDb } from "../helpers";
import { addTx, engineHousehold, run, tx } from "./helpers";

/** Rule 3: transfers between own accounts (and card repayments) are never income or spending. */
let db: Db;
let cleanup: () => void;
beforeAll(async () => ({ db, cleanup } = await createTestDb()));
afterAll(() => cleanup());

const categoryName = async (id: string | null) => (id ? (await db.select().from(categories).where(eq(categories.id, id)))[0]?.name : null);
const openQs = (householdId: string, type?: string) =>
  db
    .select()
    .from(questions)
    .where(and(eq(questions.householdId, householdId), eq(questions.status, "open")))
    .then((qs) => qs.filter((q) => !type || q.type === type));

describe("rule 3: transfers", () => {
  it("pairs a move between own accounts: different accounts, same group, sums to zero, not income or spending (Hebrew)", async () => {
    const h = await engineHousehold(db, ["current", "savings"]);
    const out = await addTx(db, h, { account: 0, date: "2026-03-26", amount: -40_000, description: "העברה לחיסכון" });
    const into = await addTx(db, h, { account: 1, date: "2026-03-26", amount: 40_000, description: "העברה מהחשבון" });
    await run(db, h);
    const [a, b] = [await tx(db, out), await tx(db, into)];
    expect(a.transferGroupId).not.toBeNull();
    expect(a.transferGroupId).toBe(b.transferGroupId);
    expect(a.accountId).not.toBe(b.accountId);
    expect(a.amount + b.amount).toBe(0);
    expect(await categoryName(a.categoryId)).toBe("Transfer");
    expect(a.status).toBe("auto");
    const totals = await periodTotals(db, h.householdId, { from: "2026-03-01", to: "2026-03-31" });
    expect(totals).toMatchObject({ income: 0, spending: 0, uncategorised: 0 });
  });

  it("files a card repayment as a transfer, never spending", async () => {
    const h = await engineHousehold(db, ["current", "credit_card"]);
    const pay = await addTx(db, h, { account: 0, date: "2026-03-20", amount: -31_240, description: "MERIDIAN CARD PAYMENT" });
    await addTx(db, h, { account: 1, date: "2026-03-20", amount: 31_240, description: "PAYMENT RECEIVED THANK YOU" });
    await run(db, h);
    expect(await categoryName((await tx(db, pay)).categoryId)).toBe("Credit card repayment");
    expect((await periodTotals(db, h.householdId, { from: "2026-03-01", to: "2026-03-31" })).spending).toBe(0);
  });

  it("property: every pair it makes sits on two accounts and sums to exactly zero", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.record({ day: fc.integer({ min: 1, max: 25 }), pence: fc.integer({ min: 1, max: 500_000 }) }), { minLength: 1, maxLength: 8 }), async (moves) => {
        const h = await engineHousehold(db, ["current", "savings"]);
        for (const m of moves) {
          const date = `2026-04-${String(m.day).padStart(2, "0")}`;
          await addTx(db, h, { account: 0, date, amount: -m.pence, description: "TRANSFER TO SAVINGS" });
          await addTx(db, h, { account: 1, date, amount: m.pence, description: "TRANSFER FROM CURRENT ACCOUNT" });
        }
        await run(db, h);
        const rows = await db.select().from(transactions).where(eq(transactions.householdId, h.householdId));
        const groups = new Map<string, typeof rows>();
        for (const r of rows) if (r.transferGroupId) groups.set(r.transferGroupId, [...(groups.get(r.transferGroupId) ?? []), r]);
        for (const sides of groups.values()) {
          expect(sides).toHaveLength(2);
          expect(sides[0]!.amount + sides[1]!.amount).toBe(0);
          expect(sides[0]!.accountId).not.toBe(sides[1]!.accountId);
        }
      }),
      { numRuns: 20 },
    );
  });

  it("keeps an unpaired transfer out of totals, and asks about it only after 10 days", async () => {
    const h = await engineHousehold(db, ["current"]);
    const lonely = await addTx(db, h, { date: "2026-05-01", amount: -25_000, description: "TRANSFER TO ISA" });
    await run(db, h, "2026-05-10");
    expect(await categoryName((await tx(db, lonely)).categoryId)).toBe("Transfer");
    expect((await tx(db, lonely)).transferGroupId).toBeNull();
    expect(await openQs(h.householdId, "transfer")).toHaveLength(0);
    expect((await periodTotals(db, h.householdId, { from: "2026-05-01", to: "2026-05-31" })).spending).toBe(0);
    await run(db, h, "2026-05-11");
    const qs = await openQs(h.householdId, "transfer");
    expect(qs.map((q) => q.subjectId)).toEqual([lonely]);
  });

  it("pairs a transfer to an own account we don't import with a manual account", async () => {
    const h = await engineHousehold(db, ["current"]);
    const id = await addTx(db, h, { date: "2026-05-01", amount: -25_000, description: "TRANSFER TO PENSION" });
    await run(db, h, "2026-05-02");
    const result = await confirmTransferToOwnAccount(db, { householdId: h.householdId, transactionId: id, accountName: "קרן פנסיה", actor: h.actor });
    const other = await tx(db, result.otherSideId);
    const [manual] = await db.select().from(accounts).where(eq(accounts.id, result.accountId));
    expect(manual).toMatchObject({ isManual: true, name: "קרן פנסיה", isLiquid: false });
    expect(other).toMatchObject({ source: "system", amount: 25_000, transferGroupId: result.groupId });
    expect((await tx(db, id)).transferGroupId).toBe(result.groupId);
    // Reused next time, not duplicated.
    const second = await addTx(db, h, { date: "2026-06-01", amount: -25_000, description: "TRANSFER TO PENSION" });
    const again = await confirmTransferToOwnAccount(db, { householdId: h.householdId, transactionId: second, accountName: "קרן פנסיה", actor: h.actor });
    expect(again.accountId).toBe(result.accountId);
  });

  it("never pairs a mortgage payment, even with a matching amount elsewhere", async () => {
    const h = await engineHousehold(db, ["current", "savings"]);
    const now = nowIso();
    await db.insert(rules).values({ id: newId(), householdId: h.householdId, conditions: { descriptionPattern: "HALSTEAD" }, actions: { categoryId: h.cat("Mortgage") }, priority: 10, origin: "manual", createdAt: now, updatedAt: now });
    const mortgage = await addTx(db, h, { account: 0, date: "2026-03-01", amount: -142_500, description: "HALSTEAD BUILDING SOC MORTGAGE" });
    await addTx(db, h, { account: 1, date: "2026-03-01", amount: 142_500, description: "TRANSFER FROM CURRENT ACCOUNT" });
    await run(db, h);
    const m = await tx(db, mortgage);
    expect(m.transferGroupId).toBeNull();
    expect(await categoryName(m.categoryId)).toBe("Mortgage");
    expect((await periodTotals(db, h.householdId, { from: "2026-03-01", to: "2026-03-31" })).spending).toBe(142_500);
  });

  it("asks rather than guesses when two partners fit equally well", async () => {
    const h = await engineHousehold(db, ["current", "savings", "savings"]);
    const out = await addTx(db, h, { account: 0, date: "2026-03-10", amount: -10_000, description: "TRANSFER OUT" });
    await addTx(db, h, { account: 1, date: "2026-03-10", amount: 10_000, description: "TRANSFER IN" });
    await addTx(db, h, { account: 2, date: "2026-03-10", amount: 10_000, description: "TRANSFER IN" });
    await run(db, h);
    expect((await tx(db, out)).transferGroupId).toBeNull();
    const qs = await openQs(h.householdId, "transfer");
    expect(qs.find((q) => q.subjectId === out)?.options.filter((o) => o.key.startsWith("pair_with:"))).toHaveLength(2);
  });

  it("pairs an uncertain match as unconfirmed and asks Y/N", async () => {
    const h = await engineHousehold(db, ["current", "savings"]);
    const a = await addTx(db, h, { account: 0, date: "2026-03-10", amount: -12_345, description: "J COHEN" });
    await addTx(db, h, { account: 1, date: "2026-03-12", amount: 12_345, description: "י. כהן" });
    await run(db, h);
    const row = await tx(db, a);
    expect(row.transferGroupId).not.toBeNull();
    expect(row.status).toBe("unconfirmed");
    const qs = await openQs(h.householdId, "transfer");
    expect(qs.find((q) => q.subjectType === "transfer_pair" && q.subjectId === row.transferGroupId)).toBeDefined();
  });

  it("posts the wallet side of a cash withdrawal when there is no wallet row", async () => {
    const h = await engineHousehold(db, ["current"]);
    const atm = await addTx(db, h, { date: "2026-03-07", amount: -4_000, description: "CASH HIGH STREET ATM" });
    await run(db, h, "2026-03-08");
    const row = await tx(db, atm);
    expect(await categoryName(row.categoryId)).toBe("Cash withdrawal");
    const sides = await db.select().from(transactions).where(eq(transactions.transferGroupId, row.transferGroupId!));
    expect(sides.map((s) => s.amount).sort((x, y) => x - y)).toEqual([-4_000, 4_000]);
    const [wallet] = await db.select().from(accounts).where(and(eq(accounts.householdId, h.householdId), eq(accounts.type, "cash_wallet")));
    expect(wallet).toBeDefined();
  });
});
