import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/auth/session";
import { DriftLine } from "@/components/drift-line";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { getImportBatch, listTransactions } from "@/db/queries";
import { accountDrift } from "@/import/drift";
import { undoWarning } from "@/import/undo";
import { formatFullDate } from "@/lib/dates";
import { UndoImport } from "./undo-import";

export const metadata = { title: "Import" };

export default async function ImportBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string; undone?: string }>;
}) {
  const { householdId } = await requireSession();
  const { id } = await params;
  const { done, undone } = await searchParams;
  const db = await getDb();
  const found = await getImportBatch(db, householdId, id);
  if (!found) notFound();
  const { batch, accountName, profileName } = found;
  const [warning, drift, rows] = await Promise.all([
    undoWarning(db, householdId, id),
    accountDrift(db, householdId, batch.accountId),
    listTransactions(db, householdId, { batchId: id, limit: 1 }),
  ]);
  const imported = batch.newCount;

  const facts: [string, React.ReactNode][] = [
    ["Account", accountName],
    ["File", <span key="f" dir="auto">{batch.fileName}</span>],
    ["Layout", profileName ?? "Not recorded"],
    ["Imported on", formatFullDate(batch.createdAt.slice(0, 10))],
    ["New transactions", imported.toLocaleString("en-GB")],
    ["Already imported (skipped)", batch.duplicateCount.toLocaleString("en-GB")],
    ["Possible duplicates to check", batch.nearDuplicateCount.toLocaleString("en-GB")],
    ["Rows we couldn’t read", batch.errorCount.toLocaleString("en-GB")],
    ["Balance check", <DriftLine key="d" drift={drift} />],
  ];

  return (
    <>
      <PageHeader title="Import" description={batch.status === "undone" ? "This import has been undone." : undefined} />
      <div className="grid gap-2.5 lg:gap-4">
        {done === "1" && batch.status !== "undone" ? (
          <Notice tone="success" title={imported === 0 ? "Nothing new: everything in this file was already here." : `Imported ${imported.toLocaleString("en-GB")} transactions.`}>
            They will be sorted automatically. You can undo this import at any time.
          </Notice>
        ) : null}
        {undone === "1" ? <Notice tone="success" title="The import has been undone." /> : null}

        <section className="rounded-lg bg-card p-5 lg:p-6">
          <dl className="divide-y divide-divider">
            {facts.map(([label, value]) => (
              <div key={label} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex flex-wrap gap-3">
            {rows.total > 0 ? (
              <Button asChild variant="secondary">
                <Link href={`/activity?batch=${id}`}>See these transactions</Link>
              </Button>
            ) : null}
            <Button asChild variant="quiet">
              <Link href="/settings/imports">All imports</Link>
            </Button>
          </div>
        </section>

        {batch.status !== "undone" && warning ? (
          <section className="rounded-lg bg-card p-5 lg:p-6">
            <h2 className="type-heading">Undo this import</h2>
            <p className="mt-2 max-w-[65ch] text-muted-foreground">
              This removes the transactions this import added and anything linked to them, such as matched receipts. Rules you have
              set up stay. Everything is recorded in the audit trail.
            </p>
            <UndoImport batchId={id} transactionCount={warning.transactionCount} confirmedOrEdited={warning.confirmedOrEdited} />
          </section>
        ) : null}
      </div>
    </>
  );
}
