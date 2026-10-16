import { mkdirSync } from "node:fs";
import { createDb } from "@/db";
import { runMigrations } from "@/db/migrate";

mkdirSync("data", { recursive: true });
const db = await createDb();
await runMigrations(db);
console.log("Migrations applied.");
