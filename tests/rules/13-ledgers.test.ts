import { and, eq, isNull } from "drizzle-orm";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { maaserLedger, transactions } from "@/db/schema";
import { rebuildLedgers } from "@/engine/ledgers";
import { maaserOwed } from "@/engine/totals";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { createTestDb } from "../helpers";
import { addTx, engineHousehold, run } from "./helpers";

/** Rule 13: automatic ledger entries follow their source transactions; manual entries are never touched. */
let db: Db;
let cleanup: () => void;
beforeAll(async () => ({ db, cleanup } = await createTestDb()));
afterAll(() => cleanup());

const snapshot = async (householdId: string) =>
  (await db.select().from(maaserLedger).where(and(eq(maaserLedger.householdId, householdId), isNull(maaserLedger.deletedAt))))
    .map((e) => `${e.date}|${e.kind}|${e.amount}|${e.origin}|${e.sourceTransactionId ?? ""}`)
    .sort();

describe("rule 13: ledgers follow their source", () => {
  it("corrects ma'aser owed when income is recategorised, keeping manual entries (Hebrew)", async () => {
    const h = await engineHousehold(db, ["current"], { maaserBp: 1000 });
    await db.insert(maaserLedger).values({ id: newId(), householdId: h.householdId, date: "2026-01-01", kind: "adjustment", amount: 7_000, origin: "manual", createdAt: nowIso() });
    const gift = await addTx(db, h, { date: "2026-03-10", amount: 50_000, description: "מתנה מסבא SALARY" });
    await run(db, h);
    expect(await maaserOwed(db, h.householdId)).toBe(12_000);
    // The family says it was a transfer from their own savings, not income.
    await db.update(transactions).set({ categoryId: h.cat("Transfer"), status: "confirmed" }).where(eq(transactions.id, gift));
    await rebuildLedgers(db, h.householdId, { fromDate: "2026-03-10", today: "2026-06-30", actor: h.actor });
    expect(await maaserOwed(db, h.householdId)).toBe(7_000);
  });

  it("property: rebuilding from any date gives the same ledger as a full rebuild", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ day: fc.integer({ min: 1, max: 28 }), pence: fc.integer({ min: 100, max: 500_000 }), charity: fc.boolean() }), { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 0, max: 9 }),
        fc.integer({ min: 1, max: 28 }),
        async (rows, changeIndex, fromDay) => {
          const h = await engineHousehold(db, ["current"], { maaserBp: 1000 });
          const ids: string[] = [];
          for (const r of rows) {
            const date = `2026-05-${String(r.day).padStart(2, "0")}`;
            ids.push(await addTx(db, h, r.charity
              ? { date, amount: -r.pence, description: "תרומה", categoryId: h.cat("Charity"), status: "confirmed" }
              : { date, amount: r.pence, description: "SALARY", categoryId: h.cat("Salary"), status: "confirmed" }));
          }
          await rebuildLedgers(db, h.householdId, { today: "2026-06-30", actor: h.actor });
          // Change one row, then rebuild only from its date (or an earlier one).
          const target = ids[changeIndex % ids.length]!;
          const [row] = await db.select().from(transactions).where(eq(transactions.id, target));
          await db.update(transactions).set({ categoryId: h.cat("Household") }).where(eq(transactions.id, target));
          const from = `2026-05-${String(Math.min(fromDay, Number(row!.date.slice(8)))).padStart(2, "0")}`;
          await rebuildLedgers(db, h.householdId, { fromDate: from, today: "2026-06-30", actor: h.actor });
          const incremental = await snapshot(h.householdId);
          await rebuildLedgers(db, h.householdId, { today: "2026-06-30", actor: h.actor });
          expect(await snapshot(h.householdId)).toEqual(incremental);
        },
      ),
      { numRuns: 25 },
    );
  });
});
