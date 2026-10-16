import { requireSession } from "@/auth/session";
import { EmptyState } from "@/components/empty-state";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { getDb } from "@/db";
import { countOpenQuestions, countTransactions, getHousehold, isSortingPaused, listAccounts } from "@/db/queries";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const { householdId } = await requireSession();
  const db = await getDb();
  const [household, accounts, transactionCount, openQuestions, paused] = await Promise.all([
    getHousehold(db, householdId),
    listAccounts(db, householdId),
    countTransactions(db, householdId),
    countOpenQuestions(db, householdId),
    isSortingPaused(db, householdId),
  ]);

  return (
    <>
      <PageHeader title="Home" description={household?.name} />
      <div className="grid gap-2.5 lg:gap-4">
        {paused ? (
          <Notice tone="warning" title="Sorting is paused">
            Some transactions are waiting to be sorted. This will carry on by itself once the background worker is
            running again; nothing has been lost.
          </Notice>
        ) : null}

        {openQuestions === 0 ? (
          <section className="rounded-lg bg-card p-5 lg:p-6">
            <p className="type-subheading">All caught up. Nothing needs you today.</p>
          </section>
        ) : null}

        <EmptyState title="Your figures will appear here">
          <p>
            Available cash, money in and out this month, money set aside and your goals will show here once
            transactions are sorted. That arrives in a later update.
          </p>
          <p>
            {transactionCount.toLocaleString("en-GB")} transactions from {accounts.length}{" "}
            {accounts.length === 1 ? "account are" : "accounts are"} stored and ready to sort.
          </p>
        </EmptyState>
      </div>
    </>
  );
}
