import { createDb, type Db } from "./client";

export { createDb } from "./client";
export type { Db, Executor, Tx } from "./client";
export * as schema from "./schema";

const globalForDb = globalThis as unknown as { ffccDb?: Promise<Db> };

/** Shared app connection, reused across hot reloads in development. */
export function getDb(): Promise<Db> {
  globalForDb.ffccDb ??= createDb().catch((error: unknown) => {
    globalForDb.ffccDb = undefined; // let the next request try again
    throw error;
  });
  return globalForDb.ffccDb;
}
