import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/auth/session";
import { Money } from "@/components/money";
import { Notice } from "@/components/notice";
import { KindChips, moneyKindFor, StatusChip } from "@/components/transaction-chips";
import { getDb } from "@/db";
import { getTransactionDetail, listCategories } from "@/db/queries";
import { formatFullDate } from "@/lib/dates";
import { categoryAllowed } from "@/activity/edits";
import { CategoryEditor, DetailEditor, NotesEditor, SplitEditor } from "./editors";

export const metadata = { title: "Transaction" };

const SOURCES: Record<string, string> = {
  csv: "Imported from a bank statement",
  open_banking: "From your bank connection",
  manual: "Added by hand",
  cash_note: "From a cash note",
  receipt: "From a receipt",
  system: "Added by FFCC",
};

export default async function TransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { householdId } = await requireSession();
  const { id } = await params;
  const db = await getDb();
  const [detail, categories] = await Promise.all([getTransactionDetail(db, householdId, id), listCategories(db, householdId)]);
  if (!detail) notFound();
  const { tx, account, category } = detail;
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  // Only the categories this row may go in (a transfer stays a transfer, a refund stays spending).
  const allowed = categories.filter((c) => !categoryAllowed(tx, c)).map((c) => ({ id: c.id, name: c.name, kind: c.kind }));
  const splitCats = allowed.filter((c) => c.kind !== "transfer");
  const categoryLabel = detail.splits.length > 0 ? `Split across ${detail.splits.length} lines` : (category?.name ?? "Not sorted yet");
  const chipRow = {
    status: tx.status,
    bookingStatus: tx.bookingStatus,
    categoryName: detail.splits.length > 0 ? "Split" : (category?.name ?? null),
    categoryKind: category?.kind ?? null,
    transferGroupId: tx.transferGroupId,
    refundOfId: tx.refundOfId,
    refunded: detail.refunds.length > 0,
  };

  return (
    <>
      <p className="mb-3">
        <Link href="/activity" className="text-teal-text underline-offset-4 hover:underline">
          Back to Activity
        </Link>
      </p>
      <header className="mb-4 lg:mb-6">
        <h1 className="type-title" dir="auto">
          {tx.merchant ?? tx.rawDescription}
        </h1>
        <p className="mt-2">
          <Money pence={tx.amount} kind={moneyKindFor({ categoryKind: category?.kind ?? null, amount: tx.amount })} size="figure" />
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-2">
          <StatusChip status={tx.status} />
          <KindChips row={chipRow} />
        </p>
      </header>

      <div className="grid gap-2.5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-4">
        <div className="grid gap-2.5 lg:gap-4">
          {detail.questions.length > 0 ? (
            <Notice tone="warning" title="We have a question about this payment">
              <Link href="/activity/questions" className="text-teal-text underline-offset-4 hover:underline">
                See the question
              </Link>
            </Notice>
          ) : null}

          <section className="rounded-lg bg-card p-5 lg:p-6">
            <h2 className="type-heading">Details</h2>
            <dl className="mt-3 divide-y divide-divider">
              <Fact label="Date">{formatFullDate(tx.date)}</Fact>
              <Fact label="Account">{account.name}</Fact>
              <Fact label="Bank description">
                <span dir="auto">{tx.rawDescription}</span>
              </Fact>
              <Fact label="Category">{categoryLabel}</Fact>
              <Fact label="Where it came from">{SOURCES[tx.source] ?? tx.source}</Fact>
              {detail.transferPartner ? (
                <Fact label="Other side of the transfer">
                  <Link href={`/activity/${detail.transferPartner.id}`} className="text-teal-text underline-offset-4 hover:underline">
                    {detail.transferPartner.accountName}, {formatFullDate(detail.transferPartner.date)}
                  </Link>
                </Fact>
              ) : null}
              {detail.refundOf ? (
                <Fact label="Refund of">
                  <Link href={`/activity/${detail.refundOf.id}`} className="text-teal-text underline-offset-4 hover:underline">
                    <span dir="auto">{detail.refundOf.description}</span>, {formatFullDate(detail.refundOf.date)}
                  </Link>
                </Fact>
              ) : null}
              {detail.refunds.map((r) => (
                <Fact key={r.id} label="Refunded by">
                  <Link href={`/activity/${r.id}`} className="text-teal-text underline-offset-4 hover:underline">
                    <Money pence={r.amount} kind="in" />, {formatFullDate(r.date)}
                  </Link>
                </Fact>
              ))}
            </dl>
          </section>

          {tx.source !== "system" ? (
            <section className="rounded-lg bg-card p-5 lg:p-6">
              <h2 className="type-heading">Category</h2>
              <div className="mt-3">
                <CategoryEditor transactionId={tx.id} categoryId={tx.categoryId} status={tx.status} categories={allowed} />
              </div>
              {detail.rules.length > 0 ? (
                <div className="mt-4 rounded-md bg-sunken p-3">
                  <p className="type-label font-semibold">Rules for this merchant</p>
                  <ul className="mt-1 space-y-1">
                    {detail.rules.map((r) => (
                      <li key={r.id}>
                        Always file <span dir="auto">{tx.merchant}</span> as {catName.get(r.actions.categoryId ?? "") ?? "a category"}
                        <span className="type-label text-muted-foreground"> ({r.origin === "correction" ? "from your correction" : r.origin === "answer" ? "from your answer" : "set up by you"})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {tx.categoryId && category?.kind !== "transfer" && !tx.transferGroupId && tx.source !== "system" ? (
            <section className="rounded-lg bg-card p-5 lg:p-6">
              <h2 className="type-heading">Split across categories</h2>
              <p className="mt-1 text-muted-foreground">For a shop that covered more than one thing, such as food and clothing.</p>
              <div className="mt-3">
                <SplitEditor
                  transactionId={tx.id}
                  amount={tx.amount}
                  categories={splitCats}
                  initial={detail.splits.map((s) => ({ categoryId: s.categoryId, amount: s.amount }))}
                />
              </div>
            </section>
          ) : null}
        </div>

        <div className="grid content-start gap-2.5 lg:gap-4">
          <section className="space-y-4 rounded-lg bg-card p-5 lg:p-6">
            <h2 className="type-heading">Tags, events and people</h2>
            <DetailEditor transactionId={tx.id} kind="tag" label="Tags" items={detail.tags} />
            <DetailEditor transactionId={tx.id} kind="event" label="Events" items={detail.events} />
            <DetailEditor transactionId={tx.id} kind="person" label="People" items={detail.persons} />
            <NotesEditor transactionId={tx.id} notes={tx.notes} />
          </section>

          {detail.receipts.length > 0 ? (
            <section className="rounded-lg bg-card p-5 lg:p-6">
              <h2 className="type-heading">Receipt</h2>
              {detail.receipts.map((r) => (
                <p key={r.id} className="mt-2">
                  <Link href={`/receipts/${r.id}`} className="text-teal-text underline-offset-4 hover:underline">
                    See the receipt
                  </Link>
                </p>
              ))}
            </section>
          ) : null}

          <section className="rounded-lg bg-card p-5 lg:p-6">
            <h2 className="type-heading">History</h2>
            <ol className="mt-3 space-y-3">
              {detail.history.map((h) => (
                <li key={h.id}>
                  <p>{h.reason}</p>
                  <p className="type-label text-muted-foreground">
                    {h.actorType === "user" ? "You" : "FFCC"} · {formatFullDate(h.createdAt.slice(0, 10))} {h.createdAt.slice(11, 16)}
                    {changeSummary(h.before, h.after, catName)}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-semibold">{children}</dd>
    </div>
  );
}

/** "Groceries → Household" style summary of what an audit entry changed. */
function changeSummary(before: unknown, after: unknown, catName: Map<string, string>): string {
  if (!before || !after || typeof before !== "object" || typeof after !== "object") return "";
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const parts: string[] = [];
  if (b.categoryId !== a.categoryId && "categoryId" in a) {
    parts.push(`${catName.get(String(b.categoryId)) ?? "Not sorted"} → ${catName.get(String(a.categoryId)) ?? "Not sorted"}`);
  }
  if (b.status !== a.status && "status" in a) parts.push(`${statusWord(b.status)} → ${statusWord(a.status)}`);
  return parts.length ? ` · ${parts.join(", ")}` : "";
}

const statusWord = (s: unknown) => (s === "confirmed" ? "Confirmed" : s === "auto" ? "Auto" : "Not sure");
