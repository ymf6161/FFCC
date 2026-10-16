import { migrate } from "drizzle-orm/libsql/migrator";
import path from "node:path";
import type { Db } from "./client";

export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "drizzle");

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
