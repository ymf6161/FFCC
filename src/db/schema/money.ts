import { type AnySQLiteColumn, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, deletedAt, householdId, id, updatedAt } from "./_columns";
import {
  accountTypes,
  bookingStatuses,
  categorisationStatuses,
  categoryKinds,
  checkpointSources,
  maaserEffects,
  transactionSources,
  valuationKinds,
} from "./enums";
import { households } from "./people";

export const accounts = sqliteTable(
  "accounts",
  {
    id: id(),
    householdId: householdId().references(() => households.id),
    type: text("type", { enum: accountTypes }).notNull(),
    name: text("name").notNull(),
    institution: text("institution"),
    /** Integer pence, as at `openingBalanceDate`. */
    openingBalance: integer("opening_balance").notNull().default(0),
    /** YYYY-MM-DD. Balance on a date = opening balance + booked transactions after this date. */
    openingBalanceDate: text("opening_balance_date").notNull(),
    isLiquid: integer("is_liquid", { mode: "boolean" }).notNull(),
    includeInNetWorth: integer("include_in_net_worth", { mode: "boolean" }).notNull().default(true),
    /** Accounts we don't import (a pension or ISA elsewhere). */
    isManual: integer("is_manual", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("accounts_household_idx").on(t.householdId)],
);

export const categories = sqliteTable(
  "categories",
  {
    id: id(),
    householdId: householdId().references(() => households.id),
    name: text("name").notNull(),
    parentId: text("parent_id").references((): AnySQLiteColumn => categories.id),
    kind: text("kind", { enum: categoryKinds }).notNull(),
    maaserEffect: text("maaser_effect", { enum: maaserEffects }).notNull().default("none"),
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("categories_household_idx").on(t.householdId)],
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: id(),
    householdId: householdId().references(() => households.id),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    /** Bank booking date, YYYY-MM-DD, UK local. */
    date: text("date").notNull(),
    /** Integer pence. Money in positive, money out negative, from the account's point of view. */
    amount: integer("amount").notNull(),
    rawDescription: text("raw_description").notNull(),
    merchant: text("merchant"),
    /** Used only when the transaction has no split lines. */
    categoryId: text("category_id").references(() => categories.id),
    source: text("source", { enum: transactionSources }).notNull(),
    bookingStatus: text("booking_status", { enum: bookingStatuses }).notNull().default("booked"),
    externalId: text("external_id"),
    dedupeKey: text("dedupe_key").notNull(),
    dedupeOccurrence: integer("dedupe_occurrence").notNull().default(1),
    importBatchId: text("import_batch_id"),
    status: text("status", { enum: categorisationStatuses }).notNull().default("unconfirmed"),
    /** 0–100. */
    confidence: integer("confidence"),
    transferGroupId: text("transfer_group_id"),
    refundOfId: text("refund_of_id").references((): AnySQLiteColumn => transactions.id),
    reserveId: text("reserve_id"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("transactions_household_date_idx").on(t.householdId, t.date),
    index("transactions_account_date_idx").on(t.accountId, t.date),
    index("transactions_transfer_group_idx").on(t.transferGroupId),
    index("transactions_refund_of_idx").on(t.refundOfId),
    index("transactions_import_batch_idx").on(t.importBatchId),
    uniqueIndex("transactions_dedupe_unique").on(t.accountId, t.dedupeKey, t.dedupeOccurrence),
  ],
);

export const transactionSplits = sqliteTable(
  "transaction_splits",
  {
    id: id(),
    householdId: householdId().references(() => households.id),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id),
    categoryId: text("category_id").references(() => categories.id),
    amount: integer("amount").notNull(),
    reserveId: text("reserve_id"),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("transaction_splits_transaction_idx").on(t.transactionId)],
);

export const balanceCheckpoints = sqliteTable(
  "balance_checkpoints",
  {
    id: id(),
    householdId: householdId().references(() => households.id),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    date: text("date").notNull(),
    balance: integer("balance").notNull(),
    source: text("source", { enum: checkpointSources }).notNull(),
    importBatchId: text("import_batch_id"),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("balance_checkpoints_account_date_idx").on(t.accountId, t.date)],
);

export const manualValuations = sqliteTable(
  "manual_valuations",
  {
    id: id(),
    householdId: householdId().references(() => households.id),
    accountId: text("account_id").references(() => accounts.id),
    name: text("name").notNull(),
    kind: text("kind", { enum: valuationKinds }).notNull(),
    date: text("date").notNull(),
    /** Integer pence. Liabilities are negative. */
    value: integer("value").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("manual_valuations_household_date_idx").on(t.householdId, t.date)],
);
