import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt, householdId, id, updatedAt } from "./_columns";
import { actorTypes, importBatchStatuses, jobStatuses } from "./enums";
import { accounts } from "./money";
import { households } from "./people";

export type BankProfileMapping = {
  dateColumn: string;
  dateFormat: string;
  amountColumn?: string;
  debitColumn?: string;
  creditColumn?: string;
  signConvention: "money_in_positive" | "money_out_positive";
  descriptionColumns: string[];
  runningBalanceColumn?: string;
  externalIdColumn?: string;
  headerRow: number;
};

export const bankProfiles = sqliteTable(
  "bank_profiles",
  {
    id: id(),
    householdId: householdId().references(() => households.id),
    name: text("name").notNull(),
    mapping: text("mapping", { mode: "json" }).$type<BankProfileMapping>().notNull(),
    /** Header signature used to auto-detect a known format. */
    headerSignature: text("header_signature"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("bank_profiles_household_idx").on(t.householdId)],
);

export const importBatches = sqliteTable(
  "import_batches",
  {
    id: id(),
    householdId: householdId().references(() => households.id),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    bankProfileId: text("bank_profile_id").references(() => bankProfiles.id),
    fileName: text("file_name").notNull(),
    newCount: integer("new_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    nearDuplicateCount: integer("near_duplicate_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    status: text("status", { enum: importBatchStatuses }).notNull(),
    undoneAt: text("undone_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("import_batches_household_idx").on(t.householdId)],
);

/**
 * Background work. `household_id` is null for global jobs (e.g. the scheduler tick);
 * household jobs always carry it.
 */
export const jobs = sqliteTable(
  "jobs",
  {
    id: id(),
    householdId: text("household_id").references(() => households.id),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: jobStatuses }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    /** ISO UTC. The job is due from this time. */
    runAfter: text("run_after").notNull(),
    lockedAt: text("locked_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("jobs_status_run_after_idx").on(t.status, t.runAfter),
    index("jobs_household_status_idx").on(t.householdId, t.status),
  ],
);

/** Append-only. Written only through `src/audit`. */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: id(),
    /** Null only for entries about shared (non-household) rows. */
    householdId: text("household_id"),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    before: text("before", { mode: "json" }),
    after: text("after", { mode: "json" }),
    actorType: text("actor_type", { enum: actorTypes }).notNull(),
    actorId: text("actor_id"),
    reason: text("reason").notNull(),
    importBatchId: text("import_batch_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entity, t.entityId),
    index("audit_log_household_created_idx").on(t.householdId, t.createdAt),
  ],
);
