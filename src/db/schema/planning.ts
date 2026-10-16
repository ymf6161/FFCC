import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt, deletedAt, householdId, id, updatedAt } from "./_columns";
import {
  goalProgressMethods,
  ledgerOrigins,
  maaserEntryKinds,
  reserveFundingRules,
  reserveMovementKinds,
  reserveTypes,
} from "./enums";
import { accounts, transactionSplits, transactions } from "./money";
import { households } from "./people";

export const reserves = sqliteTable(
  "reserves",
  {
    id: id(),
    householdId: householdId().references(() => households.id),
    name: text("name").notNull(),
    type: text("type", { enum: reserveTypes }).notNull(),
    target: integer("target"),
    fundingRule: text("funding_rule", { enum: reserveFundingRules }).notNull().default("manual"),
    /** Basis points for percent_of_income (1000 = 10%), or pence for fixed_monthly. */
    fundingValue: integer("funding_value"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("reserves_household_idx").on(t.householdId)],
);

export const reserveMovements = sqliteTable(
  "reserve_movements",
  {
    id: id(),
    householdId: householdId().references(() => households.id),
    reserveId: text("reserve_id")
      .notNull()
      .references(() => reserves.id),
    date: text("date").notNull(),
    kind: text("kind", { enum: reserveMovementKinds }).notNull(),
    /** Integer pence. Allocations positive, releases negative. */
    amount: integer("amount").notNull(),
    origin: text("origin", { enum: ledgerOrigins }).notNull(),
    sourceTransactionId: text("source_transaction_id").references(() => transactions.id),
    sourceSplitId: text("source_split_id").references(() => transactionSplits.id),
    note: text("note"),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("reserve_movements_household_date_idx").on(t.householdId, t.date)],
);

export const maaserSettings = sqliteTable(
  "maaser_settings",
  {
    id: id(),
    householdId: householdId().references(() => households.id),
    /** Basis points: 1000 = 10%. */
    percentageBp: integer("percentage_bp").notNull(),
    /** YYYY-MM-DD. Applies from this date forward; never rewrites earlier entries. */
    effectiveFrom: text("effective_from").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("maaser_settings_household_from_idx").on(t.householdId, t.effectiveFrom)],
);

export const maaserLedger = sqliteTable(
  "maaser_ledger",
  {
    id: id(),
    householdId: householdId().references(() => households.id),
    date: text("date").notNull(),
    kind: text("kind", { enum: maaserEntryKinds }).notNull(),
    /** Integer pence. Positive increases ma'aser owed, negative reduces it. */
    amount: integer("amount").notNull(),
    origin: text("origin", { enum: ledgerOrigins }).notNull(),
    sourceTransactionId: text("source_transaction_id").references(() => transactions.id),
    sourceSplitId: text("source_split_id").references(() => transactionSplits.id),
    note: text("note"),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("maaser_ledger_household_date_idx").on(t.householdId, t.date)],
);

export const goals = sqliteTable(
  "goals",
  {
    id: id(),
    householdId: householdId().references(() => households.id),
    name: text("name").notNull(),
    targetAmount: integer("target_amount").notNull(),
    targetDate: text("target_date"),
    reserveId: text("reserve_id").references(() => reserves.id),
    accountId: text("account_id").references(() => accounts.id),
    progressMethod: text("progress_method", { enum: goalProgressMethods }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("goals_household_idx").on(t.householdId)],
);
