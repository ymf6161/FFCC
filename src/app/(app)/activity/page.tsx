import Link from "next/link";
import { requireSession } from "@/auth/session";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { KindChips, moneyKindFor, StatusChip } from "@/components/transaction-chips";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { getImportBatch, listTransactions } from "@/db/queries";
import { formatDate } from "@/lib/dates";
import { ukDate } from "@/lib/time";

export const metadata = { title: "Activity" };

const PAGE = 50;

/**
 * A simple, read-only list so imported and seed data can be seen. Search,
 * filters, detail and editing arrive with the full Activity page (Phase 4).
 */
export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ batch?: string; show?: string }> }) {
  const { householdId } = await requireSession();
  const { batch: batchId, show } = await searchParams;
  const limit = Math.min(Math.max(Number.parseInt(show ?? "", 10) || PAGE, PAGE), 5000);
  const db = await getDb();
  const batch = batchId ? await getImportBatch(db, householdId, batchId) : null;
  const { rows, total } = await listTransactions(db, householdId, { batchId: batch ? batchId : undefined, limit });
  const today = ukDate();
  const moreHref = `/activity?${new URLSearchParams({ ...(batch ? { batch: batchId! } : {}), show: String(limit + PAGE) })}`;

  return (
    <>
      <PageHeader title="Activity" description="Every transaction, newest first." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button asChild>
          <Link href="/settings/import">Import a CSV</Link>
        </Button>
        {batch ? (
          <p className="text-muted-foreground">
            Showing {total.toLocaleString("en-GB")} from <span dir="auto">{batch.batch.fileName}</span>.{" "}
            <Link href="/activity" className="text-teal-text underline-offset-4 hover:underline">
              Show everything
            </Link>
          </p>
        ) : null}
      </div>

      {total === 0 ? (
        <EmptyState title="No transactions yet">
          <p>Import a bank statement to get started.</p>
        </EmptyState>
      ) : (
        <section className="rounded-lg bg-card p-2 lg:p-3">
          {/* Phone: list rows. */}
          <ul className="divide-y divide-divider lg:hidden">
            {rows.map((t) => (
              <li key={t.id} className="flex min-h-[60px] items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate font-semibold" dir="auto">
                      {t.description}
                    </span>
                    <StatusChip status={t.status} />
                    <KindChips row={t} />
                  </p>
                  <p className="type-label truncate text-muted-foreground">
                    {t.categoryName ?? "Not sorted yet"} · {t.accountName} · {formatDate(t.date, today)}
                  </p>
                </div>
                <Money pence={t.amount} kind={moneyKindFor(t)} className="shrink-0" />
              </li>
            ))}
          </ul>
          {/* Wider screens: a table. */}
          <table className="hidden w-full text-left lg:table">
            <caption className="sr-only">Transactions, newest first</caption>
            <thead>
              <tr className="type-label border-b border-divider text-muted-foreground">
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {rows.map((t) => (
                <tr key={t.id} className="h-[60px]">
                  <td className="whitespace-nowrap px-3 tabular-nums">{formatDate(t.date, today)}</td>
                  <td className="whitespace-nowrap px-3 text-muted-foreground">{t.accountName}</td>
                  <td className="px-3 py-2" dir="auto">
                    <span>{t.description}</span>
                    <span className="ml-2 align-middle">
                      <KindChips row={t} />
                    </span>
                  </td>
                  <td className="px-3 text-muted-foreground">{t.categoryName ?? "Not sorted yet"}</td>
                  <td className="whitespace-nowrap px-3">
                    <StatusChip status={t.status} />
                  </td>
                  <td className="whitespace-nowrap px-3 text-right">
                    <Money pence={t.amount} kind={moneyKindFor(t)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > rows.length ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider px-3 pb-1 pt-3">
              <p className="type-label text-muted-foreground">
                Showing {rows.length.toLocaleString("en-GB")} of {total.toLocaleString("en-GB")}
              </p>
              <Button asChild variant="secondary">
                <Link href={moreHref} scroll={false}>
                  Show more
                </Link>
              </Button>
            </div>
          ) : null}
        </section>
      )}
    </>
  );
}
