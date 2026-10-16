import { and, eq, isNull } from "drizzle-orm";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { rules, transactionSplits, transactions } from "@/db/schema";
import { allocateProRata, setSplits } from "@/engine/splits";
import { periodTotals } from "@/engine/totals";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { createTestDb } from "../helpers";
import { addTx, engineHousehold, run } from "./helpers";

/** Rule 5: split lines always sum exactly to the transaction amount; totals read both shapes the same way. */
let db: Db;
let cleanup: () => void;
beforeAll(async () => ({ db, cleanup } = await createTestDb()));
afterAll(() => cleanup());

describe("rule 5: splits", () => {
  it("rejects split lines that don't add up, and accepts ones that do", async () => {
    const h = await engineHousehold(db);
    const id = await addTx(db, h, { date: "2026-03-01", amount: -10_000, description: "מכולת השכונה", categoryId: h.cat("Groceries") });
    const ctx = { actor: h.actor, reason: "test" };
    await expect(setSplits(db, { householdId: h.householdId, transactionId: id }, [{ categoryId: h.cat("Groceries"), amount: -7_000 }, { categoryId: h.cat("Clothing"), amount: -2_999 }], ctx)).rejects.toThrow(/add up to -9999 pence/);
    await setSplits(db, { householdId: h.householdId, transactionId: id }, [{ categoryId: h.cat("Groceries"), amount: -7_000 }, { categoryId: h.cat("Clothing"), amount: -3_000 }], ctx);
    const lines = await db.select().from(transactionSplits).where(and(eq(transactionSplits.transactionId, id), isNull(transactionSplits.deletedAt)));
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(-10_000);
  });

  it("gives the same totals for an unsplit payment and the same payment split into one line", async () => {
    const a = await engineHousehold(db);
    const b = await engineHousehold(db);
    await addTx(db, a, { date: "2026-03-01", amount: -4_321, description: "מכולת", categoryId: a.cat("Groceries"), status: "confirmed" });
    const id = await addTx(db, b, { date: "2026-03-01", amount: -4_321, description: "מכולת", categoryId: b.cat("Groceries"), status: "confirmed" });
    await setSplits(db, { householdId: b.householdId, transactionId: id }, [{ categoryId: b.cat("Groceries"), amount: -4_321 }], { actor: b.actor, reason: "test" });
    const range = { from: "2026-03-01", to: "2026-03-31" };
    const [ta, tb] = [await periodTotals(db, a.householdId, range), await periodTotals(db, b.householdId, range)];
    expect(ta.spending).toBe(tb.spending);
    expect([...ta.byCategory]).toEqual([...tb.byCategory]);
  });

  it("property: dividing pro-rata always sums exactly and keeps the sign", () => {
    fc.assert(
      fc.property(fc.integer({ min: -10_000_000, max: 10_000_000 }), fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 1, maxLength: 8 }), (total, weights) => {
        const parts = allocateProRata(total, weights);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        expect(parts).toHaveLength(weights.length);
        for (const p of parts) {
          expect(Number.isSafeInteger(p)).toBe(true);
          if (total > 0) expect(p).toBeGreaterThanOrEqual(0);
          if (total < 0) expect(p).toBeLessThanOrEqual(0);
        }
      }),
    );
  });

  it("applies a rule's split template exactly", async () => {
    const h = await engineHousehold(db);
    const now = nowIso();
    await db.insert(rules).values({
      id: newId(), householdId: h.householdId, priority: 10, origin: "manual", createdAt: now, updatedAt: now,
      conditions: { descriptionPattern: "שוק" },
      actions: { categoryId: h.cat("Groceries"), splitTemplate: [{ categoryId: h.cat("Groceries"), share: 2 }, { categoryId: h.cat("Household"), share: 1 }] },
    });
    const id = await addTx(db, h, { date: "2026-03-02", amount: -10_001, description: "שוק מחנה יהודה" });
    await run(db, h);
    const lines = await db.select().from(transactionSplits).where(and(eq(transactionSplits.transactionId, id), isNull(transactionSplits.deletedAt)));
    expect(lines.map((l) => l.amount).sort((x, y) => x - y)).toEqual([-6_667, -3_334]);
    const [row] = await db.select().from(transactions).where(eq(transactions.id, id));
    expect(row!.amount).toBe(lines.reduce((s, l) => s + l.amount, 0));
  });
});
