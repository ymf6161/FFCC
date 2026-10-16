import { index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt, householdId, id, updatedAt } from "./_columns";
import { transactions } from "./money";
import { households } from "./people";

/** Tags, events and people are entered by the user only. Never inferred or suggested. */
export const tags = sqliteTable(
  "tags",
  {
    id: id(),
    householdId: householdId().references(() => households.id),
    name: text("name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tags_household_idx").on(t.householdId)],
);

export const transactionTags = sqliteTable(
  "transaction_tags",
  {
    householdId: householdId().references(() => households.id),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.transactionId, t.tagId] })],
);

export const events = sqliteTable(
  "events",
  {
    id: id(),
    householdId: householdId().references(() => households.id),
    name: text("name").notNull(),
    startDate: text("start_date"),
    endDate: text("end_date"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("events_household_idx").on(t.householdId)],
);

export const transactionEvents = sqliteTable(
  "transaction_events",
  {
    householdId: householdId().references(() => households.id),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.transactionId, t.eventId] })],
);

export const persons = sqliteTable(
  "persons",
  {
    id: id(),
    householdId: householdId().references(() => households.id),
    name: text("name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("persons_household_idx").on(t.householdId)],
);

export const transactionPersons = sqliteTable(
  "transaction_persons",
  {
    householdId: householdId().references(() => households.id),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id),
    personId: text("person_id")
      .notNull()
      .references(() => persons.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.transactionId, t.personId] })],
);
