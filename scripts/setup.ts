/**
 * `bun run setup`: rebuilds the local database from migrations and the seed.
 * Deletes data/ffcc.db first, so it gives the same result on any machine.
 */
import { mkdirSync, rmSync } from "node:fs";
import { createDb } from "@/db";
import { runMigrations } from "@/db/migrate";
import { ukDate } from "@/lib/time";
import { seedDatabase } from "@/seed";

const url = process.env.DATABASE_URL ?? "file:data/ffcc.db";
if (!url.startsWith("file:")) {
  console.error("Setup only rebuilds a local SQLite file. DATABASE_URL must start with file:");
  process.exit(1);
}
const file = url.slice("file:".length);
for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(`${file}${suffix}`, { force: true });
mkdirSync("data", { recursive: true });

const db = await createDb(url);
await runMigrations(db);
console.log("Database created from migrations.");
const result = await seedDatabase(db, { endDate: ukDate() });
console.log(
  `Seeded the demo household: ${result.transactionCount} transactions from ${result.startDate} to ${result.endDate}.`,
);
console.log("Done. Start the app with `bun run dev` and the worker with `bun run worker`.");
