import { normaliseDescription } from "@/import/dedupe";

/**
 * Merchant names from bank descriptions. Strips card-payment boilerplate
 * (dates, store numbers, payment-type codes) and keeps Hebrew as it is.
 */
const PREFIXES = [/^card payment to\s+/i, /^(pos|bcc|dd|so|fpi|fpo|bgc|tfr|vis|ddr)\s+/i, /^refund\s+(from\s+)?/i, /^rfnd\s+/i, /^החזר\s+/];
const SUFFIXES = [
  /\s+on\s+\d{1,2}[/ -]\w{2,3}(\b.*)?$/i, // "ON 12/01", "ON 12 JAN BCC"
  /\s+\d{3,}(\s+\S+)?$/, // store numbers, optionally followed by a town
  /\s+(dd|so|bcc|fpi|fpo|bgc|ddr)$/i,
];

export function normaliseMerchant(raw: string): string {
  let text = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  for (const p of PREFIXES) text = text.replace(p, "");
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of SUFFIXES) {
      const next = text.replace(s, "");
      if (next !== text && next.length > 0) {
        text = next.trim();
        changed = true;
      }
    }
  }
  // Some exports repeat the name ("Coffee Corner COFFEE CORNER"): keep it once.
  const words = text.split(" ");
  if (words.length % 2 === 0) {
    const half = words.length / 2;
    const first = words.slice(0, half).join(" ");
    if (first.toLocaleLowerCase("en-GB") === words.slice(half).join(" ").toLocaleLowerCase("en-GB")) text = words.slice(half).join(" ");
  }
  return text || raw.trim();
}

/** The key used to compare merchants: normalised, lower case. */
export const merchantKey = (merchant: string): string => normaliseDescription(merchant);

const REFUND_WORDS = /\b(refund|rfnd|refunded)\b|החזר/i;
export const looksLikeRefund = (description: string): boolean => REFUND_WORDS.test(description);

const TRANSFER_HINTS = /transfer|העברה|\btfr\b|payment received|thank you|card payment$|\batm\b|cash withdrawal|top up|to savings|from current|standing order|\bso\b|faster payment/i;
export const hasTransferHint = (description: string): boolean => TRANSFER_HINTS.test(description);

/**
 * "card" for a card-style purchase from a business (money out, no transfer,
 * standing order or direct debit wording); "other" for everything else,
 * including transfers, payments to people and money coming in. Only card lines
 * may enter the shared merchant table (BUILD_PLAN R3).
 */
export function lineKind(description: string, amount: number): "card" | "other" {
  if (amount >= 0) return "other";
  return hasTransferHint(description) || /\b(so|dd|fpo|fpi|bgc|ddr|standing order|direct debit)\b/i.test(description) ? "other" : "card";
}
