/** Enum values stored as text. One source for Drizzle columns, Zod and TypeScript. */
export const memberRoles = ["owner", "member", "viewer"] as const;
export const accountTypes = [
  "current",
  "savings",
  "credit_card",
  "cash_wallet",
  "loan",
  "mortgage",
  "investment",
  "other_asset",
] as const;
export const transactionSources = ["csv", "open_banking", "manual", "cash_note", "receipt", "system"] as const;
export const bookingStatuses = ["pending", "booked"] as const;
export const categorisationStatuses = ["auto", "confirmed", "unconfirmed"] as const;
export const categoryKinds = ["income", "expense", "transfer"] as const;
export const maaserEffects = ["accrue", "reduce", "none"] as const;
export const checkpointSources = ["csv_running_balance", "statement", "manual"] as const;
export const valuationKinds = ["asset", "liability"] as const;
export const ruleOrigins = ["onboarding", "answer", "correction", "manual"] as const;
export const questionSubjects = ["transaction", "household_merchant", "transfer_pair"] as const;
export const questionTypes = ["category", "transfer", "maaser", "receipt_match", "duplicate", "refund"] as const;
export const questionStatuses = ["open", "sent", "answered", "expired", "fallback"] as const;
export const channels = ["in_app", "email", "sms", "whatsapp"] as const;
export const receiptSources = ["upload", "email"] as const;
export const cashNoteStatuses = ["new", "parsed", "applied", "failed"] as const;
export const reserveTypes = ["tax", "emergency", "custom"] as const;
export const reserveFundingRules = ["manual", "percent_of_income", "fixed_monthly"] as const;
export const ledgerOrigins = ["auto", "manual"] as const;
export const maaserEntryKinds = ["accrual", "reduction", "adjustment"] as const;
export const reserveMovementKinds = ["allocation", "release"] as const;
export const goalProgressMethods = ["reserve_balance", "account_balance", "manual"] as const;
export const importBatchStatuses = ["processing", "complete", "failed", "undone"] as const;
export const jobStatuses = ["pending", "running", "done", "failed"] as const;
export const actorTypes = ["user", "system"] as const;
