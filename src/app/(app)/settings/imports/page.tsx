import Link from "next/link";
import { requireSession } from "@/auth/session";
import { Chip } from "@/components/chip";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { listImportBatches } from "@/db/queries";
import { formatFullDate } from "@/lib/dates";

export const metadata = { title: "Past imports" };

export default async function ImportsPage() {
  const { householdId } = await requireSession();
  const batches = await listImportBatches(await getDb(), householdId);
  return (
    <>
      <PageHeader title="Past imports" description="Every bank statement brought in, newest first." />
      <div className="mb-4">
        <Button asChild>
          <Link href="/settings/import">Import a CSV</Link>
        </Button>
      </div>
      {batches.length === 0 ? (
        <EmptyState title="No imports yet">
          <p>Import a bank statement to get started.</p>
        </EmptyState>
      ) : (
        <section className="rounded-lg bg-card p-2">
          <ul className="divide-y divide-divider">
            {batches.map((b) => (
              <li key={b.id}>
                <Link href={`/settings/imports/${b.id}`} className="flex min-h-[60px] items-center justify-between gap-4 rounded-md px-3 py-3 hover:bg-sunken">
                  <div className="min-w-0">
                    <p className="truncate font-semibold" dir="auto">
                      {b.fileName}
                    </p>
                    <p className="type-label text-muted-foreground">
                      {b.accountName} · {formatFullDate(b.createdAt.slice(0, 10))} · {b.newCount.toLocaleString("en-GB")} new
                      {b.duplicateCount ? `, ${b.duplicateCount.toLocaleString("en-GB")} already imported` : ""}
                    </p>
                  </div>
                  {b.status === "undone" ? <Chip tone="neutral">Undone</Chip> : <Chip tone="success">Imported</Chip>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
