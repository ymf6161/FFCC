import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, householdId, id, updatedAt } from "./_columns";
import { memberRoles } from "./enums";

export const households = sqliteTable("households", {
  id: id(),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("GBP"),
  financialYearStartMonth: integer("financial_year_start_month").notNull().default(4),
  financialYearStartDay: integer("financial_year_start_day").notNull().default(6),
  /** JSON: onboarding step progress, saved per household so anyone can resume. */
  onboardingProgress: text("onboarding_progress", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = sqliteTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

export const householdMembers = sqliteTable(
  "household_members",
  {
    id: id(),
    householdId: householdId().references(() => households.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: memberRoles }).notNull(),
    notifyEmail: text("notify_email"),
    notifyPhone: text("notify_phone"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("household_members_household_user_unique").on(t.householdId, t.userId),
    index("household_members_user_idx").on(t.userId),
  ],
);
