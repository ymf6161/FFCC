import { text } from "drizzle-orm/sqlite-core";

/**
 * Shared column builders. Portability rules (BUILD_PLAN section 3):
 * text ULID ids, ISO UTC timestamps as text, `YYYY-MM-DD` dates as text,
 * integer pence for money. Nothing here is SQLite-specific in meaning.
 */
export const id = () => text("id").primaryKey();
export const householdId = () => text("household_id").notNull();
export const createdAt = () => text("created_at").notNull();
export const updatedAt = () => text("updated_at").notNull();
export const deletedAt = () => text("deleted_at");
