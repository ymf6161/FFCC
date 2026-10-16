import { requireSession } from "@/auth/session";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { getDb } from "@/db";
import { countTransactions } from "@/db/queries";

export const metadata = { title: "Activity" };

export default async function ActivityPage() {
  const { householdId } = await requireSession();
  const transactionCount = await countTransactions(await getDb(), householdId);
  return (
    <>
      <PageHeader title="Activity" description="Every transaction, in one place." />
      <EmptyState title="The transaction list is on its way">
        <p>
          You will be able to search, filter and check every payment here, see what is still to be confirmed, and fix
          anything that was filed in the wrong place.
        </p>
        <p>{transactionCount.toLocaleString("en-GB")} transactions are stored and will appear here in a later update.</p>
      </EmptyState>
    </>
  );
}
