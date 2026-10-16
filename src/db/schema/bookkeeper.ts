import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt, householdId, id, updatedAt } from "./_columns";
import { cashNoteStatuses, channels, questionStatuses, questionSubjects, questionTypes, receiptSources } from "./enums";
import { transactions } from "./money";
import { households, users } from "./people";

export const digests = sqliteTable(
  "digests",
  {
    id: id(),
    householdId: householdId().references(() => households.id),
    channel: text("channel", { enum: channels }).notNull(),
    recipient: text("recipient").notNull(),
    sentAt: text("sent_at"),
    replyRawText: text("reply_raw_text"),
    createdAt: createdAt(),
  },
  (t) => [index("digests_household_idx").on(t.householdId)],
);

export const questions = sqliteTable(
  "questions",
  {
    id: id(),
    householdId: householdId().references(() => households.id),
    subjectType: text("subject_type", { enum: questionSubjects }).notNull(),
    /** Transaction id, household merchant id, or transfer group id. */
    subjectId: text("subject_id").notNull(),
    type: text("type", { enum: questionTypes }).notNull(),
    options: text("options", { mode: "json" }).$type<{ key: string; label: string }[]>().notNull(),
    status: text("status", { enum: questionStatuses }).notNull().default("open"),
    answer: text("answer"),
    answeredBy: text("answered_by").references(() => users.id),
    channel: text("channel", { enum: channels }),
    digestId: text("digest_id").references(() => digests.id),
    answeredAt: text("answered_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("questions_household_status_idx").on(t.householdId, t.status),
    index("questions_subject_idx").on(t.subjectType, t.subjectId),
  ],
);

export type ReceiptLineItem = { description: string; amount: number };

export const receipts = sqliteTable(
  "receipts",
  {
    id: id(),
    householdId: householdId().references(() => households.id),
    filePath: text("file_path").notNull(),
    source: text("source", { enum: receiptSources }).notNull(),
    parsedMerchant: text("parsed_merchant"),
    parsedDate: text("parsed_date"),
    parsedTotal: integer("parsed_total"),
    lineItems: text("line_items", { mode: "json" }).$type<ReceiptLineItem[]>(),
    matchedTransactionId: text("matched_transaction_id").references(() => transactions.id),
    matchConfidence: integer("match_confidence"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("receipts_household_idx").on(t.householdId)],
);

export const cashNotes = sqliteTable(
  "cash_notes",
  {
    id: id(),
    householdId: householdId().references(() => households.id),
    rawText: text("raw_text"),
    voiceFilePath: text("voice_file_path"),
    transcript: text("transcript"),
    parsedExpenses: text("parsed_expenses", { mode: "json" }).$type<{ description: string; amount: number }[]>(),
    status: text("status", { enum: cashNoteStatuses }).notNull().default("new"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("cash_notes_household_idx").on(t.householdId)],
);
