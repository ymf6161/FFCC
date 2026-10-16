import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDb, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";

/** A fresh, migrated SQLite database in a temp folder. Call `cleanup` when done. */
export async function createTestDb(): Promise<{ db: Db; url: string; cleanup: () => void }> {
  const dir = mkdtempSync(path.join(tmpdir(), "ffcc-test-"));
  const url = `file:${path.join(dir, "test.db")}`;
  const db = await createDb(url);
  await runMigrations(db);
  return {
    db,
    url,
    cleanup: () => {
      db.$client.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const FIXED_END_DATE = "2026-10-16";

import { accounts, households, users } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";

/** A household with one user and accounts of the given types, inserted directly (test set-up only). */
export async function makeHousehold(db: Db, accountTypes: ("current" | "savings" | "credit_card" | "cash_wallet")[] = ["current"]) {
  const now = nowIso();
  const householdId = newId();
  const userId = newId();
  await db.insert(households).values({ id: householdId, name: "Test household", createdAt: now, updatedAt: now });
  await db.insert(users).values({ id: userId, email: `${userId}@example.com`, displayName: "Test", createdAt: now, updatedAt: now });
  const accountIds: string[] = [];
  for (const type of accountTypes) {
    const id = newId();
    await db.insert(accounts).values({
      id, householdId, type, name: type, openingBalanceDate: "2025-12-31", isLiquid: type !== "credit_card", createdAt: now, updatedAt: now,
    });
    accountIds.push(id);
  }
  return { householdId, userId, accountIds, actor: { type: "user" as const, id: userId } };
}
