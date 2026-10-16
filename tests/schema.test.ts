import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { createTestDb } from "./helpers";

const SHARED_TABLES = new Set(["households", "users", "merchants", "audit_log", "jobs"]);

let db: Db;
let cleanup: () => void;
beforeAll(async () => ({ db, cleanup } = await createTestDb()));
afterAll(() => cleanup());

const tables = (Object.values(schema) as unknown[]).filter((v): v is SQLiteTable => is(v, SQLiteTable));

describe("schema", () => {
  it("has every table in the data model", async () => {
    const result = await db.$client.execute("select name from sqlite_master where type = 'table' and name not like '\\_%' escape '\\' and name not like 'sqlite%'");
    const names = result.rows.map((r) => String(r.name)).sort();
    expect(names).toEqual(
      [
        "accounts", "audit_log", "balance_checkpoints", "bank_profiles", "cash_notes", "categories", "digests",
        "events", "goals", "household_members", "household_merchants", "households", "import_batches", "jobs",
        "maaser_ledger", "maaser_settings", "manual_valuations", "merchants", "persons", "questions", "receipts",
        "reserve_movements", "reserves", "rules", "tags", "transaction_events", "transaction_persons",
        "transaction_splits", "transaction_tags", "transactions", "users",
      ].sort(),
    );
  });

  it("puts household_id on every household-owned table", () => {
    for (const table of tables) {
      const { name, columns } = getTableConfig(table);
      if (SHARED_TABLES.has(name)) continue;
      const col = columns.find((c) => c.name === "household_id");
      expect(col, `${name}.household_id`).toBeDefined();
      expect(col?.notNull, `${name}.household_id not null`).toBe(true);
    }
  });

  it("uses text ids everywhere (ULIDs), never auto-increment", () => {
    for (const table of tables) {
      const { name, columns } = getTableConfig(table);
      const idCol = columns.find((c) => c.name === "id");
      if (!idCol) continue; // link tables use composite keys
      expect(idCol.getSQLType(), `${name}.id`).toBe("text");
    }
  });

  it("stores money and dates in portable column types", () => {
    const { columns } = getTableConfig(schema.transactions);
    expect(columns.find((c) => c.name === "amount")?.getSQLType()).toBe("integer");
    expect(columns.find((c) => c.name === "date")?.getSQLType()).toBe("text");
  });

  it("runs SQLite in WAL mode with a busy timeout", async () => {
    const mode = await db.$client.execute("PRAGMA journal_mode");
    expect(String(mode.rows[0]?.journal_mode)).toBe("wal");
    const timeout = await db.$client.execute("PRAGMA busy_timeout");
    expect(Number(Object.values(timeout.rows[0] ?? {})[0])).toBe(5000);
  });

  it("has the indexes the build plan asks for", async () => {
    const result = await db.$client.execute("select name from sqlite_master where type = 'index'");
    const names = new Set(result.rows.map((r) => String(r.name)));
    for (const index of [
      "transactions_household_date_idx",
      "transactions_account_date_idx",
      "transactions_transfer_group_idx",
      "transactions_refund_of_idx",
      "transactions_dedupe_unique",
      "questions_household_status_idx",
      "jobs_status_run_after_idx",
    ]) {
      expect(names.has(index), index).toBe(true);
    }
  });

  it("rejects a second transaction with the same account, dedupe key and occurrence", async () => {
    const now = nowIso();
    const householdId = newId();
    await db.insert(schema.households).values({ id: householdId, name: "H", createdAt: now, updatedAt: now });
    const accountId = newId();
    await db.insert(schema.accounts).values({
      id: accountId, householdId, type: "current", name: "A", openingBalanceDate: "2026-01-01", isLiquid: true, createdAt: now, updatedAt: now,
    });
    const row = {
      householdId, accountId, date: "2026-02-01", amount: -320, rawDescription: "COFFEE", source: "csv" as const,
      dedupeKey: "2026-02-01|-320|coffee", createdAt: now, updatedAt: now,
    };
    await db.insert(schema.transactions).values({ ...row, id: newId(), dedupeOccurrence: 1 });
    // A genuine second identical coffee gets occurrence 2 and is allowed.
    await db.insert(schema.transactions).values({ ...row, id: newId(), dedupeOccurrence: 2 });
    await expect(db.insert(schema.transactions).values({ ...row, id: newId(), dedupeOccurrence: 1 })).rejects.toThrow();
  });

  it("enforces foreign keys", async () => {
    const now = nowIso();
    await expect(
      db.insert(schema.accounts).values({
        id: newId(), householdId: "missing", type: "current", name: "A", openingBalanceDate: "2026-01-01", isLiquid: true, createdAt: now, updatedAt: now,
      }),
    ).rejects.toThrow();
  });
});
