import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type Db = ReturnType<typeof drizzle<typeof schema>>;
/** A transaction handle; same query API as `Db`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything queries can run against: the database or an open transaction. */
export type Executor = Db | Tx;

export const DEFAULT_DB_URL = "file:data/ffcc.db";
export const BUSY_TIMEOUT_MS = 5000;

/**
 * The only place a database connection is made (BUILD_PLAN section 3).
 * SQLite runs in WAL mode with a 5s busy timeout because the web app and the
 * worker both write. WAL is stored in the file, so setting it once is enough;
 * the busy timeout is applied to every pooled connection by the client.
 */
export async function createDb(url: string = process.env.DATABASE_URL ?? DEFAULT_DB_URL): Promise<Db> {
  const client = createClient({ url, timeout: BUSY_TIMEOUT_MS });
  await client.execute("PRAGMA journal_mode = WAL");
  return drizzle(client, { schema });
}
