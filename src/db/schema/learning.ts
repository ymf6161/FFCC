import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, householdId, id, updatedAt } from "./_columns";
import { ruleOrigins } from "./enums";
import { categories } from "./money";
import { households } from "./people";

/**
 * Shared across all households, so it has no household_id. Rows only for
 * businesses confirmed by web lookup; never from a household's answers (BUILD_PLAN R3).
 */
export const merchants = sqliteTable(
  "merchants",
  {
    id: id(),
    canonicalName: text("canonical_name").notNull(),
    /** JSON array of normalised merchant-name patterns. */
    matchPatterns: text("match_patterns", { mode: "json" }).$type<string[]>().notNull(),
    lookupResult: text("lookup_result", { mode: "json" }).$type<Record<string, unknown>>(),
    /** Name of a suggested system category; households map it to their own. */
    suggestedCategory: text("suggested_category"),
    lookedUpAt: text("looked_up_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("merchants_canonical_name_unique").on(t.canonicalName)],
);

export const householdMerchants = sqliteTable(
  "household_merchants",
  {
    id: id(),
    householdId: householdId().references(() => households.id),
    merchantId: text("merchant_id").references(() => merchants.id),
    /** Normalised merchant name as seen in this household's data. */
    name: text("name").notNull(),
    categoryId: text("category_id").references(() => categories.id),
    confirmed: integer("confirmed", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("household_merchants_household_name_unique").on(t.householdId, t.name)],
);

export type RuleConditions = {
  merchant?: string;
  descriptionPattern?: string;
  amountMin?: number;
  amountMax?: number;
  accountId?: string;
  direction?: "in" | "out";
};

/** Rules never apply tags, events or people (BUILD_PLAN R18). */
export type RuleActions = {
  categoryId?: string;
  splitTemplate?: { categoryId: string; share: number }[];
  markAsTransfer?: boolean;
  maaserEffect?: "accrue" | "reduce" | "none";
};

export const rules = sqliteTable(
  "rules",
  {
    id: id(),
    householdId: householdId().references(() => households.id),
    conditions: text("conditions", { mode: "json" }).$type<RuleConditions>().notNull(),
    actions: text("actions", { mode: "json" }).$type<RuleActions>().notNull(),
    priority: integer("priority").notNull().default(100),
    origin: text("origin", { enum: ruleOrigins }).notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("rules_household_priority_idx").on(t.householdId, t.priority)],
);
