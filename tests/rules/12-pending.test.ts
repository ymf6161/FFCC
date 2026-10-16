import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { maaserLedger } from "@/db/schema";
import { accountBalances, periodTotals } from "@/engine/totals";
import { createTestDb } from "../helpers";
import { addTx, engineHousehold, run, tx } from "./helpers";

/** Rule 12: pending rows show in Activity but never count in balances, totals or ledgers. */
let db: Db;
let cleanup: () => void;
beforeAll(async () => ({ db, cleanup } = await createTestDb()));
afterAll(() => cleanup());

describe("rule 12: pending rows don't count", () => {
  it("leaves pending rows out of balances, totals, ledgers and transfer pairing (Hebrew)", async () => {
    const h = await engineHousehold(db, ["current", "savings"], { maaserBp: 1000 });
    await addTx(db, h, { date: "2026-03-25", amount: 100_000, description: "ACME HOLDINGS SALARY" });
    const pendingSalary = await addTx(db, h, { date: "2026-03-28", amount: 500_000, description: "משכורת SALARY", bookingStatus: "pending" });
    const pendingSpend = await addTx(db, h, { date: "2026-03-28", amount: -40_000, description: "העברה לחיסכון", bookingStatus: "pending" });
    await addTx(db, h, { account: 1, date: "2026-03-28", amount: 40_000, description: "העברה מהחשבון" });
    await run(db, h);
    const [current] = await accountBalances(db, h.householdId, "2026-03-31");
    expect(current!.balance).toBe(100_000);
    const totals = await periodTotals(db, h.householdId, { from: "2026-03-01", to: "2026-03-31" });
    expect(totals.income).toBe(100_000);
    const entries = await db.select().from(maaserLedger).where(and(eq(maaserLedger.householdId, h.householdId), isNull(maaserLedger.deletedAt)));
    expect(entries.map((e) => e.amount)).toEqual([10_000]);
    expect((await tx(db, pendingSpend)).transferGroupId).toBeNull();
    expect((await tx(db, pendingSalary)).bookingStatus).toBe("pending");
  });
});
