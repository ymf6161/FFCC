import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import * as queries from "@/db/queries";
import { questions } from "@/db/schema";
import { enqueue, PAUSED_AFTER_MS } from "@/jobs/queue";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { seedDatabase } from "@/seed";
import { createTestDb, FIXED_END_DATE } from "./helpers";

/**
 * Two households in one database. Every household-scoped query must return
 * only its own household's rows (CLAUDE.md: every query is scoped by household_id).
 */
let db: Db;
let cleanup: () => void;
let a: string;
let b: string;

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
  a = (await seedDatabase(db, { endDate: FIXED_END_DATE, householdName: "Household A", userEmail: "a@example.com" })).householdId;
  b = (await seedDatabase(db, { endDate: "2026-03-31", householdName: "Household B", userEmail: "b@example.com" })).householdId;
  const now = nowIso();
  await db.insert(questions).values({
    id: newId(), householdId: a, subjectType: "transaction", subjectId: "x", type: "category", options: [], createdAt: now, updatedAt: now,
  });
  await enqueue(db, { type: "noop", householdId: a, runAfter: new Date(Date.now() - 2 * PAUSED_AFTER_MS) });
});
afterAll(() => cleanup());

describe("household scoping", () => {
  it("getHousehold returns only the requested household", async () => {
    expect((await queries.getHousehold(db, a))?.name).toBe("Household A");
    expect((await queries.getHousehold(db, b))?.name).toBe("Household B");
  });

  it("listAccounts returns only the household's own accounts", async () => {
    const accountsA = await queries.listAccounts(db, a);
    const accountsB = await queries.listAccounts(db, b);
    expect(accountsA).toHaveLength(4);
    expect(accountsB).toHaveLength(4);
    expect(accountsA.every((x) => x.householdId === a)).toBe(true);
    expect(accountsB.every((x) => x.householdId === b)).toBe(true);
  });

  it("countTransactions counts only the household's own rows", async () => {
    const total = await db.$count((await import("@/db/schema")).transactions);
    const countA = await queries.countTransactions(db, a);
    const countB = await queries.countTransactions(db, b);
    expect(countA).toBeGreaterThan(0);
    expect(countB).toBeGreaterThan(0);
    // If either query ignored the household, it would return the total.
    expect(countA).toBeLessThan(total);
    expect(countB).toBeLessThan(total);
    expect(countA + countB).toBe(total);
  });

  it("countOpenQuestions counts only the household's own questions", async () => {
    expect(await queries.countOpenQuestions(db, a)).toBe(1);
    expect(await queries.countOpenQuestions(db, b)).toBe(0);
  });

  it("isSortingPaused looks only at the household's own jobs", async () => {
    expect(await queries.isSortingPaused(db, a)).toBe(true);
    expect(await queries.isSortingPaused(db, b)).toBe(false);
  });

  it("covers every exported query", () => {
    // If a query is added to src/db/queries, add a scoping check above too.
    expect(Object.keys(queries).sort()).toEqual(
      ["countOpenQuestions", "countTransactions", "getHousehold", "isSortingPaused", "listAccounts"].sort(),
    );
  });
});
