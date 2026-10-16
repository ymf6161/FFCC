import type { categoryKinds, maaserEffects } from "@/db/schema";

export type SeedCategory = {
  name: string;
  kind: (typeof categoryKinds)[number];
  maaserEffect: (typeof maaserEffects)[number];
};

/** The system categories every household starts with. */
export const SYSTEM_CATEGORIES: readonly SeedCategory[] = [
  { name: "Salary", kind: "income", maaserEffect: "accrue" },
  { name: "Interest", kind: "income", maaserEffect: "accrue" },
  { name: "Other income", kind: "income", maaserEffect: "accrue" },
  { name: "Mortgage", kind: "expense", maaserEffect: "none" },
  { name: "Council tax", kind: "expense", maaserEffect: "none" },
  { name: "Energy", kind: "expense", maaserEffect: "none" },
  { name: "Water", kind: "expense", maaserEffect: "none" },
  { name: "Broadband and phone", kind: "expense", maaserEffect: "none" },
  { name: "Groceries", kind: "expense", maaserEffect: "none" },
  { name: "Fuel", kind: "expense", maaserEffect: "none" },
  { name: "Subscriptions", kind: "expense", maaserEffect: "none" },
  { name: "Clothing", kind: "expense", maaserEffect: "none" },
  { name: "Household", kind: "expense", maaserEffect: "none" },
  { name: "Charity", kind: "expense", maaserEffect: "reduce" },
  { name: "General cash spending", kind: "expense", maaserEffect: "none" },
  { name: "Transfer", kind: "transfer", maaserEffect: "none" },
  { name: "Credit card repayment", kind: "transfer", maaserEffect: "none" },
  { name: "Cash withdrawal", kind: "transfer", maaserEffect: "none" },
];

export type SystemCategoryName =
  | "Salary"
  | "Interest"
  | "Other income"
  | "Mortgage"
  | "Council tax"
  | "Energy"
  | "Water"
  | "Broadband and phone"
  | "Groceries"
  | "Fuel"
  | "Subscriptions"
  | "Clothing"
  | "Household"
  | "Charity"
  | "General cash spending"
  | "Transfer"
  | "Credit card repayment"
  | "Cash withdrawal";
