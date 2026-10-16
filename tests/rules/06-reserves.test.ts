import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { maaserLedger, reserveMovements, reserves } from "@/db/schema";
import { availableCash } from "@/engine/totals";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { createTestDb } from "../helpers";
import { addTx, engineHousehold, run } from "./helpers";

/** Rule 6: reserves are virtual; available cash = liquid balances − reserves − ma'aser owed. */
let db: Db;
let cleanup: () => void;
beforeAll(async () => ({ db, cleanup } = await createTestDb()));
afterAll(() => cleanup());

async function addReserve(h: { householdId: string }, values: Partial<typeof reserves.$inferInsert> = {}) {
  const id = newId();
  const now = nowIso();
  await db.insert(reserves).values({ id, householdId: h.householdId, name: "מס", type: "tax", fundingRule: "manual", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: now, ...values });
  return id;
}

describe("rule 6: reserves and available cash", () => {
  it("subtracts reserves and ma'aser owed from liquid balances, but not credit card balances", async () => {
    const h = await engineHousehold(db, ["current", "savings", "credit_card", "cash_wallet"], { maaserBp: 1000 });
    await addTx(db, h, { account: 0, date: "2026-03-28", amount: 300_000, description: "ACME HOLDINGS SALARY" });
    await addTx(db, h, { account: 1, date: "2026-03-01", amount: 500_000, description: "חיסכון OPENING" , categoryId: h.cat("Other income"), status: "confirmed" });
    await addTx(db, h, { account: 2, date: "2026-03-05", amount: -80_000, description: "HOMEWARE HOUSE LONDON" });
    const reserve = await addReserve(h);
    await db.insert(reserveMovements).values({ id: newId(), householdId: h.householdId, reserveId: reserve, date: "2026-03-02", kind: "allocation", amount: 100_000, origin: "manual", createdAt: nowIso() });
    await run(db, h);
    const cash = await availableCash(db, h.householdId, "2026-03-31");
    // ma'aser: 10% of 3,000 + 10% of 5,000 (both accrue) = 800
    expect(cash).toEqual({ liquid: 800_000, reserved: 100_000, maaserOwed: 80_000, available: 620_000 });
  });

  it("can go negative", async () => {
    const h = await engineHousehold(db, ["current"]);
    await addTx(db, h, { date: "2026-03-01", amount: 10_000, description: "x", categoryId: h.cat("Other income"), status: "confirmed" });
    const reserve = await addReserve(h);
    await db.insert(reserveMovements).values({ id: newId(), householdId: h.householdId, reserveId: reserve, date: "2026-03-02", kind: "allocation", amount: 50_000, origin: "manual", createdAt: nowIso() });
    expect((await availableCash(db, h.householdId, "2026-03-31")).available).toBe(-40_000);
  });

  it("releases a reserve by spending marked against it, and funds it from income", async () => {
    const h = await engineHousehold(db, ["current"]);
    const reserve = await addReserve(h, { fundingRule: "percent_of_income", fundingValue: 2_000 });
    await addTx(db, h, { date: "2026-03-28", amount: 200_000, description: "ACME HOLDINGS SALARY" });
    await addTx(db, h, { date: "2026-04-10", amount: -15_000, description: "רואה חשבון ACCOUNTANT", categoryId: h.cat("Household"), status: "confirmed", reserveId: reserve });
    await run(db, h);
    const moves = await db.select().from(reserveMovements).where(and(eq(reserveMovements.reserveId, reserve), isNull(reserveMovements.deletedAt)));
    expect(moves.map((m) => [m.kind, m.amount]).sort()).toEqual([["allocation", 40_000], ["release", -15_000]]);
    expect((await availableCash(db, h.householdId, "2026-04-30")).reserved).toBe(25_000);
    expect(await db.select().from(maaserLedger).where(eq(maaserLedger.householdId, h.householdId))).toHaveLength(0); // no ma'aser setting
  });

  it("allocates a fixed monthly amount from the month the reserve was set up", async () => {
    const h = await engineHousehold(db, ["current"]);
    const reserve = await addReserve(h, { fundingRule: "fixed_monthly", fundingValue: 5_000, createdAt: "2026-02-10T09:00:00.000Z" });
    await run(db, h, "2026-04-15");
    const moves = await db.select().from(reserveMovements).where(and(eq(reserveMovements.reserveId, reserve), isNull(reserveMovements.deletedAt)));
    expect(moves.map((m) => m.date).sort()).toEqual(["2026-02-01", "2026-03-01", "2026-04-01"]);
  });
});
