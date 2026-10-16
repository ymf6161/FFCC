import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Executor } from "@/db";
import { accounts, transactions } from "@/db/schema";
import { listOpenQuestions } from "@/db/queries";
import { merchantKey } from "@/engine/merchant";
import type { QuestionContext } from "./describe";

export type OpenQuestion = Awaited<ReturnType<typeof listOpenQuestions>>["questions"][number];

/** Open questions with what each is about, ready to word (inbox and digest). */
export async function openQuestionsWithContext(ex: Executor, householdId: string): Promise<{ q: OpenQuestion; ctx: QuestionContext }[]> {
  const { questions, transactions: txs, householdMerchants, pairSides } = await listOpenQuestions(ex, householdId);
  if (questions.length === 0) return [];
  const accts = new Map((await ex.select().from(accounts).where(eq(accounts.householdId, householdId))).map((a) => [a.id, a.name]));
  const keys = new Set(householdMerchants.map((h) => h.name));
  const merchantRows = keys.size
    ? (
        await ex
          .select({ merchant: transactions.merchant, amount: transactions.amount, date: transactions.date, status: transactions.status })
          .from(transactions)
          .where(and(eq(transactions.householdId, householdId), isNull(transactions.deletedAt), isNotNull(transactions.merchant)))
      ).filter((r) => keys.has(merchantKey(r.merchant!)))
    : [];

  return questions.map((q) => {
    if (q.subjectType === "transaction") {
      const t = txs.find((x) => x.id === q.subjectId);
      return { q, ctx: { type: q.type, subjectType: q.subjectType, amount: t?.amount ?? null, date: t?.date ?? null, payee: t?.merchant ?? t?.rawDescription ?? "this payment", accountName: t ? accts.get(t.accountId) : null } };
    }
    if (q.subjectType === "household_merchant") {
      const hm = householdMerchants.find((h) => h.id === q.subjectId);
      const rows = merchantRows.filter((r) => hm && merchantKey(r.merchant!) === hm.name).sort((a, b) => b.date.localeCompare(a.date));
      const display = rows[0]?.merchant ?? hm?.name ?? "this merchant";
      return { q, ctx: { type: q.type, subjectType: q.subjectType, amount: rows[0]?.amount ?? null, date: rows[0]?.date ?? null, payee: display, count: rows.length } };
    }
    const sides = pairSides.filter((s) => s.transferGroupId === q.subjectId);
    const out = sides.find((s) => s.amount < 0);
    const into = sides.find((s) => s.amount > 0);
    return {
      q,
      ctx: {
        type: q.type,
        subjectType: q.subjectType,
        amount: into?.amount ?? null,
        date: out?.date ?? null,
        payee: out?.rawDescription ?? "",
        fromAccount: out ? accts.get(out.accountId) : null,
        toAccount: into ? accts.get(into.accountId) : null,
      },
    };
  });
}

