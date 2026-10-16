import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { categories, questions, transactionSplits } from "@/db/schema";
import { setSplits } from "@/engine/splits";
import { periodTotals } from "@/engine/totals";
import { createTestDb } from "../helpers";
import { addTx, engineHousehold, run, tx } from "./helpers";

/** Rule 4: refunds reduce the original expense, in the month the refund arrives; never income. */
let db: Db;
let cleanup: () => void;
beforeAll(async () => ({ db, cleanup } = await createTestDb()));
afterAll(() => cleanup());

const nameOf = async (id: string | null) => (id ? (await db.select().from(categories).where(eq(categories.id, id)))[0]?.name : null);
const refundQuestions = (householdId: string) =>
  db.select().from(questions).where(and(eq(questions.householdId, householdId), eq(questions.type, "refund"), eq(questions.status, "open")));

describe("rule 4: refunds", () => {
  it("links a refund to its purchase, takes its category, and reduces spending in the month it arrives", async () => {
    const h = await engineHousehold(db, ["credit_card"]);
    const purchase = await addTx(db, h, { date: "2026-03-14", amount: -6_499, description: "LITTLE STEPS KIDSWEAR" });
    const refund = await addTx(db, h, { date: "2026-04-02", amount: 6_499, description: "REFUND LITTLE STEPS KIDSWEAR" });
    await run(db, h);
    const r = await tx(db, refund);
    expect(r.refundOfId).toBe(purchase);
    expect(await nameOf(r.categoryId)).toBe("Clothing");
    const march = await periodTotals(db, h.householdId, { from: "2026-03-01", to: "2026-03-31" });
    const april = await periodTotals(db, h.householdId, { from: "2026-04-01", to: "2026-04-30" });
    expect(march.spending).toBe(6_499); // past month unchanged
    expect(april.spending).toBe(-6_499); // the refund lands in April, as less spending
    expect(april.income).toBe(0); // never income
  });

  it("matches Hebrew merchants", async () => {
    const h = await engineHousehold(db, ["credit_card"]);
    const purchase = await addTx(db, h, { date: "2026-03-01", amount: -7_992, description: "חנות צעצועים" });
    const refund = await addTx(db, h, { date: "2026-03-09", amount: 7_992, description: "החזר חנות צעצועים" });
    await run(db, h);
    expect((await tx(db, refund)).refundOfId).toBe(purchase);
  });

  it("allows partial refunds, and asks when refunds would exceed the purchase", async () => {
    const h = await engineHousehold(db, ["credit_card"]);
    const purchase = await addTx(db, h, { date: "2026-03-01", amount: -10_000, description: "HOMEWARE HOUSE LONDON" });
    const first = await addTx(db, h, { date: "2026-03-05", amount: 4_000, description: "REFUND HOMEWARE HOUSE LONDON" });
    const second = await addTx(db, h, { date: "2026-03-06", amount: 6_000, description: "REFUND HOMEWARE HOUSE LONDON" });
    const third = await addTx(db, h, { date: "2026-03-07", amount: 1_000, description: "REFUND HOMEWARE HOUSE LONDON" });
    await run(db, h);
    expect((await tx(db, first)).refundOfId).toBe(purchase);
    expect((await tx(db, second)).refundOfId).toBe(purchase);
    const t = await tx(db, third);
    expect(t.refundOfId).toBeNull();
    expect(t.status).toBe("unconfirmed");
    expect((await refundQuestions(h.householdId)).map((q) => q.subjectId)).toEqual([third]);
  });

  it("splits a refund of a split purchase in the same proportions, summing exactly", async () => {
    const h = await engineHousehold(db, ["credit_card"]);
    const purchase = await addTx(db, h, { date: "2026-03-01", amount: -10_000, description: "FRESHWAYS SUPERMARKET" });
    await setSplits(db, { householdId: h.householdId, transactionId: purchase }, [
      { categoryId: h.cat("Groceries"), amount: -7_000 },
      { categoryId: h.cat("Clothing"), amount: -3_000 },
    ], { actor: h.actor, reason: "test" });
    const refund = await addTx(db, h, { date: "2026-03-08", amount: 3_333, description: "REFUND FRESHWAYS SUPERMARKET" });
    await run(db, h);
    expect((await tx(db, refund)).refundOfId).toBe(purchase);
    const lines = await db.select().from(transactionSplits).where(and(eq(transactionSplits.transactionId, refund), isNull(transactionSplits.deletedAt)));
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(3_333);
    expect(lines.map((l) => l.amount).sort((a, b) => b - a)).toEqual([2_333, 1_000]);
  });

  it("gives an unmatched refund a best-guess expense category and a question, never income (Hebrew)", async () => {
    const h = await engineHousehold(db, ["current"]);
    const refund = await addTx(db, h, { date: "2026-03-08", amount: 1_500, description: "החזר ספרי קודש" });
    await run(db, h);
    const r = await tx(db, refund);
    expect(r.refundOfId).toBeNull();
    expect(r.status).toBe("unconfirmed");
    const cat = (await db.select().from(categories).where(eq(categories.id, r.categoryId!)))[0]!;
    expect(cat.kind).toBe("expense");
    expect((await refundQuestions(h.householdId)).map((q) => q.subjectId)).toEqual([refund]);
    expect((await periodTotals(db, h.householdId, { from: "2026-03-01", to: "2026-03-31" })).income).toBe(0);
  });
});
