import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { accountBalances, periodTotals } from "@/engine/totals";
import { createTestDb } from "../helpers";
import { addTx, engineHousehold, run, tx } from "./helpers";

/** Rule 2: money in positive, money out negative, from the account's point of view; liabilities negative. */
let db: Db;
let cleanup: () => void;
beforeAll(async () => ({ db, cleanup } = await createTestDb()));
afterAll(() => cleanup());

describe("rule 2: signs", () => {
  it("a card purchase is negative on the card, a repayment positive, and the card balance is a negative liability", async () => {
    const h = await engineHousehold(db, ["current", "credit_card"]);
    await addTx(db, h, { account: 1, date: "2026-03-03", amount: -7_999, description: "חנות צעצועים" });
    await addTx(db, h, { account: 1, date: "2026-03-05", amount: -2_001, description: "FRESHWAYS SUPERMARKET" });
    const repayment = await addTx(db, h, { account: 1, date: "2026-03-22", amount: 6_000, description: "PAYMENT RECEIVED THANK YOU" });
    await addTx(db, h, { account: 0, date: "2026-03-22", amount: -6_000, description: "CARD PAYMENT" });
    await run(db, h);

    const balances = await accountBalances(db, h.householdId, "2026-03-31");
    const card = balances.find((b) => b.account.type === "credit_card")!;
    expect(card.balance).toBe(-4_000); // £40.00 still owed: a liability, negative
    expect((await tx(db, repayment)).amount).toBeGreaterThan(0);
    // Spending counts the purchases (money out), not the repayment.
    const totals = await periodTotals(db, h.householdId, { from: "2026-03-01", to: "2026-03-31" });
    expect(totals.spending).toBe(10_000);
    expect(totals.income).toBe(0);
  });

  it("money in is positive and counts as income when it is income", async () => {
    const h = await engineHousehold(db);
    await addTx(db, h, { date: "2026-03-28", amount: 210_000, description: "ACME HOLDINGS PAYROLL" });
    await run(db, h);
    const totals = await periodTotals(db, h.householdId, { from: "2026-03-01", to: "2026-03-31" });
    expect(totals.income).toBe(210_000);
  });
});
