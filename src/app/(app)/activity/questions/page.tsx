import Link from "next/link";
import { requireSession } from "@/auth/session";
import { PageHeader } from "@/components/page-header";
import { getDb } from "@/db";
import { openQuestionsWithContext } from "@/questions/context";
import { questionContextLine, questionText } from "@/questions/describe";

export const metadata = { title: "Questions" };

export default async function QuestionsPage() {
  const { householdId } = await requireSession();
  const items = await openQuestionsWithContext(await getDb(), householdId);

  return (
    <>
      <PageHeader title="Questions" description="The few things we weren’t sure about." />
      {items.length === 0 ? (
        <section className="rounded-lg bg-card p-5 lg:p-6">
          <p className="type-subheading">All caught up. Nothing needs you today.</p>
          <p className="mt-2 text-muted-foreground">When FFCC isn’t sure about a payment, it asks here, in one word or number.</p>
        </section>
      ) : (
        <ul className="grid gap-2.5 lg:gap-4">
          {items.map(({ q, ctx }) => (
            <li key={q.id} className="overflow-hidden rounded-lg bg-card">
              <div className="bg-saffron px-5 py-3 text-on-saffron">
                <p className="text-[1.1875rem] font-bold" dir="auto">
                  {questionText(ctx)}
                </p>
              </div>
              <div className="px-5 py-4">
                <p className="text-muted-foreground" dir="auto">
                  {questionContextLine(ctx)}
                </p>
                <p className="type-label mt-2 text-muted-foreground">Answers: {q.options.map((o) => o.label).join(" · ")}</p>
                {q.subjectType === "transaction" ? (
                  <p className="mt-2">
                    <Link href={`/activity/${q.subjectId}`} className="text-teal-text underline-offset-4 hover:underline">
                      See the payment
                    </Link>
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
