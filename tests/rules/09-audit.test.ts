import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { auditLog, maaserLedger, transactions } from "@/db/schema";
import { createTestDb } from "../helpers";
import { addTx, engineHousehold, run, tx } from "./helpers";

/** Rule 9: nothing is silently overwritten; every engine change is audited; nothing is hard-deleted. */
let db: Db;
let cleanup: () => void;
beforeAll(async () => ({ db, cleanup } = await createTestDb()));
afterAll(() => cleanup());

describe("rule 9: audit", () => {
  it("writes a before/after entry for every transaction the engine changes (Hebrew)", async () => {
    const h = await engineHousehold(db, ["current"], { maaserBp: 1000 });
    const id = await addTx(db, h, { date: "2026-03-26", amount: -5_000, description: "תרומה לקופת צדקה" });
    await run(db, h);
    const [entry] = await db.select().from(auditLog).where(and(eq(auditLog.entityId, id), eq(auditLog.reason, "Sorted by the engine")));
    expect(entry).toMatchObject({ entity: "transactions", actorType: "user", householdId: h.householdId });
    expect(entry!.before).toMatchObject({ categoryId: null, status: "unconfirmed" });
    expect(entry!.after).toMatchObject({ categoryId: h.cat("Charity"), status: "auto" });
  });

  it("logs a ledger rebuild once per batch, not per entry", async () => {
    const h = await engineHousehold(db, ["current"], { maaserBp: 1000 });
    for (let d = 1; d <= 5; d++) await addTx(db, h, { date: `2026-03-0${d}`, amount: 10_000, description: "ACME HOLDINGS SALARY" });
    await run(db, h);
    const entries = await db.select().from(auditLog).where(and(eq(auditLog.householdId, h.householdId), eq(auditLog.entity, "maaser_ledger")));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.after).toMatchObject({ rowCount: 5 });
  });

  it("never hard-deletes: rebuilt ledger entries and changed rows are kept, soft-deleted", async () => {
    const h = await engineHousehold(db, ["current"], { maaserBp: 1000 });
    const salary = await addTx(db, h, { date: "2026-03-28", amount: 100_000, description: "ACME HOLDINGS SALARY" });
    await run(db, h);
    await db.update(transactions).set({ amount: 120_000 }).where(eq(transactions.id, salary));
    await run(db, h);
    const all = (await db.select({ n: count() }).from(maaserLedger).where(eq(maaserLedger.householdId, h.householdId)))[0]!.n;
    expect(all).toBe(2); // the old entry is still there, soft-deleted
    expect((await tx(db, salary)).deletedAt).toBeNull();
  });

  it("never changes a row the family has confirmed", async () => {
    const h = await engineHousehold(db, ["current"]);
    const id = await addTx(db, h, { date: "2026-03-05", amount: -2_000, description: "FRESHWAYS SUPERMARKET", categoryId: h.cat("Household"), status: "confirmed" });
    await run(db, h);
    expect(await tx(db, id)).toMatchObject({ categoryId: h.cat("Household"), status: "confirmed", merchant: null });
  });
});

describe("rule 9: no silent overwrite while sorting", () => {
  it("writes nothing if the family confirms a row while the engine is waiting on the AI, and the job retries", async () => {
    const { MockAiProvider } = await import("@/ai");
    const { EngineConflictError } = await import("@/engine/run");
    const h = await engineHousehold(db, ["current", "savings"]);
    const unknown = await addTx(db, h, { date: "2026-03-01", amount: -1_000, description: "SEFORIM CENTRE" });
    const out = await addTx(db, h, { account: 0, date: "2026-03-02", amount: -5_000, description: "TRANSFER TO SAVINGS" });
    const into = await addTx(db, h, { account: 1, date: "2026-03-02", amount: 5_000, description: "TRANSFER FROM CURRENT ACCOUNT" });
    const provider = new MockAiProvider();
    const answer = provider.categoriseMerchants.bind(provider);
    provider.categoriseMerchants = async (items, cats) => {
      // Meanwhile, in the app: the family confirms the payment as Household.
      await db.update(transactions).set({ categoryId: h.cat("Household"), status: "confirmed", updatedAt: "2099-01-01T00:00:00.000Z" }).where(eq(transactions.id, unknown));
      return answer(items, cats);
    };
    await expect(run(db, h, "2026-03-10", provider)).rejects.toBeInstanceOf(EngineConflictError);
    expect(await tx(db, unknown)).toMatchObject({ categoryId: h.cat("Household"), status: "confirmed" });
    // All or nothing: the transfer pair planned in the same run was not half-written.
    expect((await tx(db, out)).transferGroupId).toBeNull();
    expect((await tx(db, into)).transferGroupId).toBeNull();
    // Next run (nothing changing underneath) completes and leaves the confirmed row alone.
    await run(db, h, "2026-03-10");
    expect(await tx(db, unknown)).toMatchObject({ categoryId: h.cat("Household"), status: "confirmed" });
    expect((await tx(db, out)).transferGroupId).not.toBeNull();
  });
});
