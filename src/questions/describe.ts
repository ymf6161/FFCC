import { formatFullDate } from "@/lib/dates";
import { formatMoney } from "@/money";

/**
 * Questions in plain words (DESIGN.md "Question card"): short, with the amount
 * and payee, answerable in one word. Shared by the inbox and the digest.
 */

export type QuestionContext = {
  type: "category" | "transfer" | "maaser" | "receipt_match" | "duplicate" | "refund";
  subjectType: "transaction" | "household_merchant" | "transfer_pair";
  /** The transaction it's about, or the merchant's most recent payment. */
  amount: number | null;
  date: string | null;
  payee: string;
  accountName?: string | null;
  /** For a merchant question: how many payments it covers. */
  count?: number;
  /** For a transfer pair: the two accounts. */
  fromAccount?: string | null;
  toAccount?: string | null;
};

const money = (p: number) => formatMoney(Math.abs(p));

export function questionText(q: QuestionContext): string {
  const amount = q.amount === null ? "" : money(q.amount);
  switch (q.type) {
    case "category":
      return `What is ${q.payee}?`;
    case "maaser":
      return `Was ${amount} to ${q.payee} ma’aser?`;
    case "refund":
      return `Which purchase does the ${amount} refund from ${q.payee} belong to?`;
    case "duplicate":
      return `Is the ${amount} payment to ${q.payee} the same as one already here?`;
    case "receipt_match":
      return `Is this receipt for the ${amount} payment to ${q.payee}?`;
    case "transfer":
      if (q.subjectType === "transfer_pair") return `Was ${amount} from ${q.fromAccount ?? "one account"} to ${q.toAccount ?? "another"} a move between your accounts?`;
      return `Where did the ${amount} payment “${q.payee}” go?`;
  }
}

export function questionContextLine(q: QuestionContext): string {
  const when = q.date ? formatFullDate(q.date) : "";
  if (q.subjectType === "household_merchant") {
    const n = q.count ?? 1;
    return `${n} payment${n === 1 ? "" : "s"}${q.amount !== null ? `, most recently ${money(q.amount)} on ${when}` : ""}. Your answer applies to future payments to them too.`;
  }
  if (q.subjectType === "transfer_pair") return `On ${when}.`;
  return `${q.accountName ? `From ${q.accountName}` : "Paid"} on ${when}.`;
}
