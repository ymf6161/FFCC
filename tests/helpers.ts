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
