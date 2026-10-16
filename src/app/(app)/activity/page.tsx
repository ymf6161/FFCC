import Link from "next/link";
import { requireSession } from "@/auth/session";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { getImportBatch, listAccounts, listCategories, listTagsEventsPersons, listTransactions } from "@/db/queries";
import type { categorisationStatuses } from "@/db/schema";
import { formatDate } from "@/lib/dates";
import { ukDate } from "@/lib/time";
import { getOpenQuestionCount } from "../data";
import { ActivityList } from "./activity-list";
import { ActivityFilters, type FilterValues } from "./filters";

export const metadata = { title: "Activity" };

const PAGE = 50;
const STATUSES = new Set(["auto", "confirmed", "unconfirmed"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Params = FilterValues & { batch?: string; show?: string };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { householdId } = await requireSession();
  const params = await searchParams;
  const limit = Math.min(Math.max(Number.parseInt(params.show ?? "", 10) || PAGE, PAGE), 5000);
  const db = await getDb();
  const [batch, accounts, categories, details, openQuestions] = await Promise.all([
    params.batch ? getImportBatch(db, householdId, params.batch) : null,
    listAccounts(db, householdId),
    listCategories(db, householdId),
    listTagsEventsPersons(db, householdId),
    getOpenQuestionCount(householdId),
  ]);
  const q = params.q?.slice(0, 100);
  const filters = {
    batchId: batch ? params.batch : undefined,
    q,
    accountId: params.account || undefined,
    categoryId: params.category || undefined,
    status: STATUSES.has(params.status ?? "") ? (params.status as (typeof categorisationStatuses)[number]) : undefined,
    from: params.from && DATE.test(params.from) ? params.from : undefined,
    to: params.to && DATE.test(params.to) ? params.to : undefined,
    tagId: params.tag || undefined,
    eventId: params.event || undefined,
    personId: params.person || undefined,
  };
  const { rows, total } = await listTransactions(db, householdId, { ...filters, limit });
  const today = ukDate();
  const keep = Object.fromEntries(Object.entries(params).filter(([k, v]) => v && k !== "show")) as Record<string, string>;
  const moreHref = `/activity?${new URLSearchParams({ ...keep, show: String(limit + PAGE) })}`;
  const filtered = Object.values(filters).some(Boolean);

  return (
    <>
      <PageHeader title="Activity" description="Every transaction, newest first." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button asChild>
          <Link href="/settings/import">Import a CSV</Link>
        </Button>
        {openQuestions > 0 ? (
          <Button asChild variant="secondary">
            <Link href="/activity/questions">
              {openQuestions} question{openQuestions === 1 ? "" : "s"} waiting
            </Link>
          </Button>
        ) : null}
        {batch ? (
          <p className="text-muted-foreground">
            Showing transactions from <span dir="auto">{batch.batch.fileName}</span>.
          </p>
        ) : null}
      </div>

      <ActivityFilters
        values={{ q, account: params.account, category: params.category, status: filters.status, from: filters.from, to: filters.to, tag: params.tag, event: params.event, person: params.person }}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
        categories={categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
        tags={details.tags}
        events={details.events}
        persons={details.persons}
      />

      {total === 0 ? (
        filtered ? (
          <EmptyState title="Nothing matches">
            <p>Try a different search, or clear the filters.</p>
          </EmptyState>
        ) : (
          <EmptyState title="No transactions yet">
            <p>Import a bank statement to get started.</p>
          </EmptyState>
        )
      ) : (
        <section className="rounded-lg bg-card p-2 lg:p-3" aria-label="Transactions">
          <p className="type-label px-3 pb-2 pt-1 text-muted-foreground" role="status">
            {total.toLocaleString("en-GB")} transaction{total === 1 ? "" : "s"}
            {filtered ? " match" : ""}
          </p>
          <ActivityList key={JSON.stringify(keep)} rows={rows.map((r) => ({ ...r, dateLabel: formatDate(r.date, today) }))} />
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
