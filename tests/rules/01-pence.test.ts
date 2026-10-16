import { and, eq, isNull } from "drizzle-orm";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { maaserLedger, transactions } from "@/db/schema";
import { createTestDb } from "../helpers";
import { addTx, engineHousehold, run } from "./helpers";

/** Rule 1: money is integer pence; percentages go through one rounding helper, per posting, half away from zero. */
let db: Db;
let cleanup: () => void;
beforeAll(async () => ({ db, cleanup } = await createTestDb()));
afterAll(() => cleanup());

const liveMaaser = (householdId: string) =>
  db.select().from(maaserLedger).where(and(eq(maaserLedger.householdId, householdId), isNull(maaserLedger.deletedAt)));

describe("rule 1: integer pence and per-posting rounding", () => {
  it("rounds each ma'aser posting on its own, half away from zero", async () => {
    const h = await engineHousehold(db, ["current"], { maaserBp: 1000 });
    // 10% of £333.35 is 3,333.5p: each posting rounds to 3,334p.
    await addTx(db, h, { date: "2026-01-28", amount: 33_335, description: "משכורת חודשית SALARY" });
    await addTx(db, h, { date: "2026-02-28", amount: 33_335, description: "משכורת חודשית SALARY" });
    await run(db, h);
    const entries = await liveMaaser(h.householdId);
    expect(entries.map((e) => e.amount)).toEqual([3_334, 3_334]);
    // Not round(10% of the total) = 6,667p: rounding happens per posting.
    expect(entries.reduce((s, e) => s + e.amount, 0)).toBe(6_668);
  });

  it("stores only whole pence everywhere the engine writes", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.integer({ min: 1, max: 999_999 }), { minLength: 1, maxLength: 6 }), fc.integer({ min: 1, max: 2_500 }), async (salaries, bp) => {
        const h = await engineHousehold(db, ["current"], { maaserBp: bp });
        for (const [i, amount] of salaries.entries()) await addTx(db, h, { date: `2026-03-${String(i + 1).padStart(2, "0")}`, amount, description: "ACME HOLDINGS SALARY" });
        await addTx(db, h, { date: "2026-03-20", amount: -1_234, description: "תרומה לקופת צדקה" });
        await run(db, h);
        for (const e of await liveMaaser(h.householdId)) expect(Number.isSafeInteger(e.amount)).toBe(true);
        for (const t of await db.select().from(transactions).where(eq(transactions.householdId, h.householdId))) expect(Number.isSafeInteger(t.amount)).toBe(true);
      }),
      { numRuns: 15 },
    );
  });
});
