import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertAudited, insertBatchAudited, softDeleteAudited, updateAudited } from "@/audit";
import * as auditModule from "@/audit";
import type { Db } from "@/db";
import { accounts, auditLog, households, transactions } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { createTestDb } from "./helpers";

let db: Db;
let cleanup: () => void;
beforeAll(async () => ({ db, cleanup } = await createTestDb()));
afterAll(() => cleanup());

const system = { type: "system" as const };

async function makeHousehold(name = "Test") {
  const now = nowIso();
  return insertAudited(db, households, { id: newId(), name, createdAt: now, updatedAt: now }, { actor: system, reason: "test" });
}

async function makeAccount(householdId: string) {
  const now = nowIso();
  return insertAudited(
    db,
    accounts,
    { id: newId(), householdId, type: "current", name: "Current", openingBalanceDate: "2026-01-01", isLiquid: true, createdAt: now, updatedAt: now },
    { actor: { type: "user", id: "u1" }, reason: "Added account" },
  );
}

const entriesFor = (entityId: string) => db.select().from(auditLog).where(eq(auditLog.entityId, entityId));

describe("audit helper", () => {
  it("writes an entry with after, actor and reason when inserting", async () => {
    const h = await makeHousehold();
    const account = await makeAccount(h.id);
    const [entry] = await entriesFor(account.id);
    expect(entry).toMatchObject({
      householdId: h.id,
      entity: "accounts",
      actorType: "user",
      actorId: "u1",
      reason: "Added account",
      before: null,
    });
    expect(entry?.after).toMatchObject({ id: account.id, name: "Current" });
  });

  it("records before and after on update", async () => {
    const h = await makeHousehold();
    const account = await makeAccount(h.id);
    await updateAudited(db, accounts, { id: account.id, householdId: h.id }, { name: "Joint current" }, { actor: system, reason: "Renamed" });
    const entries = await entriesFor(account.id);
    const update = entries.find((e) => e.reason === "Renamed");
    expect(update?.before).toMatchObject({ name: "Current" });
    expect(update?.after).toMatchObject({ name: "Joint current" });
  });

  it("refuses to update a row in another household", async () => {
    const a = await makeHousehold("A");
    const b = await makeHousehold("B");
    const account = await makeAccount(a.id);
    await expect(
      updateAudited(db, accounts, { id: account.id, householdId: b.id }, { name: "Hijacked" }, { actor: system, reason: "x" }),
    ).rejects.toThrow(/not found in this household/);
    const [row] = await db.select().from(accounts).where(eq(accounts.id, account.id));
    expect(row?.name).toBe("Current");
  });

  it("soft-deletes and never removes the row", async () => {
    const h = await makeHousehold();
    const account = await makeAccount(h.id);
    await softDeleteAudited(db, accounts, { id: account.id, householdId: h.id }, { actor: system, reason: "Closed" });
    const [row] = await db.select().from(accounts).where(eq(accounts.id, account.id));
    expect(row?.deletedAt).not.toBeNull();
  });

  it("saves neither the change nor its entry when the write fails", async () => {
    const h = await makeHousehold();
    const before = (await db.select().from(auditLog)).length;
    const id = newId();
    const now = nowIso();
    await expect(
      insertAudited(
        db,
        accounts,
        // household does not exist: the foreign key fails
        { id, householdId: "no-such-household", type: "current", name: "X", openingBalanceDate: "2026-01-01", isLiquid: true, createdAt: now, updatedAt: now },
        { actor: system, reason: "should not appear" },
      ),
    ).rejects.toThrow();
    expect((await db.select().from(auditLog)).length).toBe(before);
    expect(await db.select().from(accounts).where(eq(accounts.id, id))).toHaveLength(0);
    expect(h).toBeDefined();
  });

  it("rolls back the change and its entry when a later step in the same transaction fails", async () => {
    const h = await makeHousehold();
    const id = newId();
    const now = nowIso();
    await expect(
      db.transaction(async (tx) => {
        await insertAudited(
          tx,
          accounts,
          { id, householdId: h.id, type: "savings", name: "Savings", openingBalanceDate: "2026-01-01", isLiquid: true, createdAt: now, updatedAt: now },
          { actor: system, reason: "rolled back" },
        );
        throw new Error("something later went wrong");
      }),
    ).rejects.toThrow("something later went wrong");
    expect(await db.select().from(accounts).where(eq(accounts.id, id))).toHaveLength(0);
    expect(await entriesFor(id)).toHaveLength(0);
  });

  it("logs a batch insert once, not per row", async () => {
    const h = await makeHousehold();
    const account = await makeAccount(h.id);
    const now = nowIso();
    const batchId = newId();
    const rows = Array.from({ length: 450 }, (_, i) => ({
      id: newId(), householdId: h.id, accountId: account.id, date: "2026-03-01", amount: -(i + 1), rawDescription: "SHOP",
      source: "csv" as const, dedupeKey: `2026-03-01|${-(i + 1)}|shop`, createdAt: now, updatedAt: now,
    }));
    const count = await insertBatchAudited(db, transactions, rows, { actor: system, reason: "Imported", batchId, importBatchId: batchId, householdId: h.id });
    expect(count).toBe(450);
    const entries = await entriesFor(batchId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entity: "transactions", importBatchId: batchId, after: { rowCount: 450 } });
  });

  it("refuses a batch containing a row for another household, writing nothing", async () => {
    const a = await makeHousehold("A");
    const b = await makeHousehold("B");
    const accountA = await makeAccount(a.id);
    const accountB = await makeAccount(b.id);
    const now = nowIso();
    const batchId = newId();
    const row = (householdId: string, accountId: string, n: number) => ({
      id: newId(), householdId, accountId, date: "2026-04-01", amount: -n, rawDescription: "SHOP",
      source: "csv" as const, dedupeKey: `2026-04-01|${-n}|shop`, createdAt: now, updatedAt: now,
    });
    const auditBefore = (await db.select().from(auditLog)).length;
    await expect(
      insertBatchAudited(db, transactions, [row(a.id, accountA.id, 1), row(b.id, accountB.id, 2)], {
        actor: system, reason: "Imported", batchId, importBatchId: batchId, householdId: a.id,
      }),
    ).rejects.toThrow(/must belong to household/);
    expect(await db.select().from(transactions).where(eq(transactions.householdId, b.id))).toHaveLength(0);
    expect(await db.select().from(transactions).where(eq(transactions.householdId, a.id))).toHaveLength(0);
    expect(await entriesFor(batchId)).toHaveLength(0);
    expect((await db.select().from(auditLog)).length).toBe(auditBefore);
  });

  it("refuses an update that would move a row to another household or change its id", async () => {
    const a = await makeHousehold("A");
    const b = await makeHousehold("B");
    const account = await makeAccount(a.id);
    const auditBefore = (await entriesFor(account.id)).length;
    await expect(
      updateAudited(db, accounts, { id: account.id, householdId: a.id }, { name: "Moved", householdId: b.id }, { actor: system, reason: "x" }),
    ).rejects.toThrow(/householdId cannot be changed/);
    await expect(
      updateAudited(db, accounts, { id: account.id, householdId: a.id }, { id: newId() }, { actor: system, reason: "x" }),
    ).rejects.toThrow(/id cannot be changed/);
    const [row] = await db.select().from(accounts).where(eq(accounts.id, account.id));
    expect(row).toMatchObject({ householdId: a.id, name: "Current" });
    expect(await entriesFor(account.id)).toHaveLength(auditBefore);
  });

  it("offers no way to change or remove audit entries", () => {
    expect(Object.keys(auditModule).sort()).toEqual(["insertAudited", "insertBatchAudited", "softDeleteAudited", "updateAudited", "updateBatchAudited"]);
    // Nothing in the app updates or deletes audit rows.
    const offenders = sourceFiles("src").filter((file) => /\.(update|delete)\(\s*auditLog\b/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : /\.tsx?$/.test(name) ? [full] : [];
  });
}
