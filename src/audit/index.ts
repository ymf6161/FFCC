import { and, eq, getTableName, inArray, type InferInsertModel, type InferSelectModel } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Executor, Tx } from "@/db";
import { auditLog } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";

/**
 * The audit log helper (CLAUDE.md money rule 7, BUILD_PLAN rule 9).
 *
 * Every write to financial or household data goes through these functions.
 * Each one writes the change and its audit entry in the same database
 * transaction, so either both are saved or neither is. The audit log is
 * append-only: this module has no way to change or remove an entry.
 */

export type Actor = { type: "user"; id: string } | { type: "system"; id?: string };

export type AuditContext = {
  actor: Actor;
  /** Plain words: why this changed ("Seeded demo data", "Answered question"). */
  reason: string;
  importBatchId?: string;
};

type AuditableTable = SQLiteTable & { id: SQLiteColumn };
type HouseholdTable = AuditableTable & { householdId: SQLiteColumn };

function householdOf(table: AuditableTable, row: Record<string, unknown>): string | null {
  if (getTableName(table) === "households") return String(row.id);
  const value = row.householdId;
  return typeof value === "string" ? value : null;
}

async function appendEntry(
  tx: Executor,
  entry: {
    householdId: string | null;
    entity: string;
    entityId: string;
    before: unknown;
    after: unknown;
    ctx: AuditContext;
  },
): Promise<void> {
  await tx.insert(auditLog).values({
    id: newId(),
    householdId: entry.householdId,
    entity: entry.entity,
    entityId: entry.entityId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    actorType: entry.ctx.actor.type,
    actorId: entry.ctx.actor.id ?? null,
    reason: entry.ctx.reason,
    importBatchId: entry.ctx.importBatchId ?? null,
    createdAt: nowIso(),
  });
}

/** Runs `fn` atomically. Inside an open transaction this becomes a savepoint. */
function atomically<T>(ex: Executor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (ex as Tx).transaction(fn);
}

/** Insert one row and audit it. */
export async function insertAudited<T extends AuditableTable>(
  ex: Executor,
  table: T,
  values: InferInsertModel<T>,
  ctx: AuditContext,
): Promise<InferSelectModel<T>> {
  return atomically(ex, async (tx) => {
    const [row] = (await tx.insert(table).values(values as never).returning()) as InferSelectModel<T>[];
    if (!row) throw new Error(`Insert into ${getTableName(table)} returned nothing`);
    const r = row as Record<string, unknown>;
    await appendEntry(tx, {
      householdId: householdOf(table, r),
      entity: getTableName(table),
      entityId: String(r.id),
      before: null,
      after: row,
      ctx,
    });
    return row;
  });
}

const INSERT_CHUNK = 200;

/**
 * Insert many rows as one batch with a single audit entry, as imports and
 * ledger rebuilds do (BUILD_PLAN rule 9: "An import is logged once per batch,
 * not per row"). `ctx.batchId` is the entry's entity id; set `importBatchId`
 * too when the batch is an import.
 */
export async function insertBatchAudited<T extends HouseholdTable>(
  ex: Executor,
  table: T,
  rows: InferInsertModel<T>[],
  ctx: AuditContext & { batchId: string; householdId: string },
): Promise<number> {
  const stray = rows.find((row) => (row as { householdId?: unknown }).householdId !== ctx.householdId);
  if (stray) {
    throw new Error(`Every row in a ${getTableName(table)} batch must belong to household ${ctx.householdId}`);
  }
  return atomically(ex, async (tx) => {
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await tx.insert(table).values(rows.slice(i, i + INSERT_CHUNK) as never);
    }
    await appendEntry(tx, {
      householdId: ctx.householdId,
      entity: getTableName(table),
      entityId: ctx.batchId,
      before: null,
      after: { rowCount: rows.length },
      ctx,
    });
    return rows.length;
  });
}

/**
 * Update one row, scoped to its household, and audit before and after.
 * For the `households` table pass the household's own id as `householdId`.
 */
export async function updateAudited<T extends AuditableTable>(
  ex: Executor,
  table: T,
  key: { id: string; householdId: string | null },
  patch: Partial<InferInsertModel<T>>,
  ctx: AuditContext,
): Promise<InferSelectModel<T>> {
  // A row's identity and owner never change through an update.
  for (const field of ["id", "householdId"]) {
    if (field in patch) throw new Error(`${getTableName(table)}.${field} cannot be changed by an update`);
  }
  return atomically(ex, async (tx) => {
    const where = scopedWhere(table, key);
    const [before] = (await tx.select().from(table as SQLiteTable).where(where)) as InferSelectModel<T>[];
    if (!before) throw new Error(`${getTableName(table)} ${key.id} not found in this household`);
    const [after] = (await tx
      .update(table)
      .set(patch as never)
      .where(where)
      .returning()) as InferSelectModel<T>[];
    await appendEntry(tx, {
      householdId: key.householdId,
      entity: getTableName(table),
      entityId: key.id,
      before,
      after,
      ctx,
    });
    return after as InferSelectModel<T>;
  });
}

/**
 * Apply the same change to many rows of one household as a single batch, with
 * one audit entry listing the ids (used by import undo). Rows outside the
 * household are never touched.
 */
export async function updateBatchAudited<T extends HouseholdTable>(
  ex: Executor,
  table: T,
  key: { householdId: string; ids: string[] },
  patch: Partial<InferInsertModel<T>>,
  ctx: AuditContext,
): Promise<number> {
  for (const field of ["id", "householdId"]) {
    if (field in patch) throw new Error(`${getTableName(table)}.${field} cannot be changed by an update`);
  }
  if (key.ids.length === 0) return 0;
  return atomically(ex, async (tx) => {
    let changed = 0;
    for (let i = 0; i < key.ids.length; i += INSERT_CHUNK) {
      const ids = key.ids.slice(i, i + INSERT_CHUNK);
      const rows = await tx
        .update(table)
        .set(patch as never)
        .where(and(inArray(table.id, ids), eq(table.householdId, key.householdId)))
        .returning({ id: table.id });
      changed += rows.length;
    }
    await appendEntry(tx, {
      householdId: key.householdId,
      entity: getTableName(table),
      entityId: ctx.importBatchId ?? key.ids[0]!,
      before: null,
      after: { ids: key.ids, rowCount: changed, patch },
      ctx,
    });
    return changed;
  });
}

/** Financial rows are never removed; they get `deleted_at` (BUILD_PLAN rule 9). */
export async function softDeleteAudited<T extends HouseholdTable & { deletedAt: SQLiteColumn }>(
  ex: Executor,
  table: T,
  key: { id: string; householdId: string },
  ctx: AuditContext,
): Promise<InferSelectModel<T>> {
  return updateAudited(ex, table, key, { deletedAt: nowIso() } as Partial<InferInsertModel<T>>, ctx);
}

function scopedWhere(table: AuditableTable, key: { id: string; householdId: string | null }) {
  const byId = eq(table.id, key.id);
  const householdCol = (table as Partial<HouseholdTable>).householdId;
  if (getTableName(table) === "households" || !householdCol) return byId;
  if (key.householdId === null) throw new Error(`${getTableName(table)} writes must be scoped to a household`);
  return and(byId, eq(householdCol, key.householdId));
}
