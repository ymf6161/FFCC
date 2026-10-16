/**
 * What bank data may leave the app (BUILD_PLAN R4). Every AI payload is built
 * here: account numbers, sort codes, card numbers and long digit runs are
 * masked; balances, names and other transactions are never included.
 */

const SORT_CODE = /\b\d{2}[- ]\d{2}[- ]\d{2}\b/g;
const MASKED_CARD = /[*xX]{2,}\s?\d{2,4}\b/g;
const CARD_NUMBER = /\b\d(?:[ -]?\d){12,18}\b/g;
const LONG_DIGITS = /\d{6,}/g;

export function redactDescription(raw: string): string {
  return raw
    .replace(SORT_CODE, "[sort code]")
    .replace(MASKED_CARD, "[card]")
    .replace(CARD_NUMBER, (m) => (m.replace(/\D/g, "").length >= 13 ? "[card]" : m))
    .replace(LONG_DIGITS, "[number]")
    .replace(/\s+/g, " ")
    .trim();
}

export type CategorisePayloadItem = {
  /** Opaque key the response refers back to; never a database id. */
  key: string;
  merchant: string;
  description: string;
  amount: number;
  date: string;
  direction: "in" | "out";
  accountType: string;
};

/** The minimum the AI needs to sort one merchant's payment. */
export function buildCategoriseItem(input: {
  key: string;
  merchant: string;
  description: string;
  amount: number;
  date: string;
  accountType: string;
}): CategorisePayloadItem {
  return {
    key: input.key,
    merchant: redactDescription(input.merchant),
    description: redactDescription(input.description),
    amount: Math.abs(input.amount),
    date: input.date,
    direction: input.amount >= 0 ? "in" : "out",
    accountType: input.accountType,
  };
}
