/** Account types the import wizard can create. Loans and mortgages hold no transactions. */
export const NEW_ACCOUNT_TYPES = ["current", "savings", "credit_card", "cash_wallet"] as const;

export const ACCOUNT_TYPE_LABELS = {
  current: "Current account",
  savings: "Savings",
  credit_card: "Credit card",
  cash_wallet: "Cash wallet",
  loan: "Loan",
  mortgage: "Mortgage",
  investment: "Investment",
  other_asset: "Other asset",
} as const;
