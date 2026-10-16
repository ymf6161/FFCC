import Link from "next/link";
import { signOut } from "@/auth/actions";
import { requireSession } from "@/auth/session";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { DriftLine } from "@/components/drift-line";
import { getHousehold, listAccounts, listImportBatches } from "@/db/queries";
import { accountDrift } from "@/import/drift";
import { ACCOUNT_TYPE_LABELS } from "./import/shared";

export const metadata = { title: "Settings" };


const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default async function SettingsPage() {
  const { householdId } = await requireSession();
  const db = await getDb();
  const [household, accounts, batches] = await Promise.all([
    getHousehold(db, householdId),
    listAccounts(db, householdId),
    listImportBatches(db, householdId),
  ]);
  const drifts = new Map(await Promise.all(accounts.map(async (a) => [a.id, await accountDrift(db, householdId, a.id)] as const)));

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-2.5 lg:grid-cols-2 lg:gap-4">
        <section className="rounded-lg bg-card p-5 lg:p-6">
          <h2 className="type-heading">Household</h2>
          <dl className="mt-3 divide-y divide-divider">
            <div className="flex justify-between gap-4 py-3">
              <dt className="text-muted-foreground">Name</dt>
              <dd dir="auto" className="text-right font-semibold">
                {household?.name}
              </dd>
            </div>
            <div className="flex justify-between gap-4 py-3">
              <dt className="text-muted-foreground">Financial year starts</dt>
              <dd className="text-right font-semibold">
                {household ? `${household.financialYearStartDay} ${MONTHS[household.financialYearStartMonth - 1]}` : null}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-lg bg-card p-5 lg:p-6">
          <h2 className="type-heading">Accounts</h2>
          <ul className="mt-3 divide-y divide-divider">
            {accounts.map((a) => (
              <li key={a.id} className="flex min-h-[60px] items-center justify-between gap-4 py-2">
                <div className="min-w-0">
                  <p dir="auto" className="truncate font-semibold">
                    {a.name}
                  </p>
                  <p className="type-label text-muted-foreground">
                    {ACCOUNT_TYPE_LABELS[a.type]}
                    {a.institution ? ` · ${a.institution}` : ""}
                  </p>
                  <p className="type-label">
                    <DriftLine drift={drifts.get(a.id)!} />
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 type-label text-muted-foreground">Editing accounts arrives in a later update.</p>
        </section>

        <section className="rounded-lg bg-card p-5 lg:col-span-2 lg:p-6">
          <h2 className="type-heading">Imports</h2>
          <p className="mt-2 text-muted-foreground">
            {batches.length === 0
              ? "Bring in transactions from a CSV file exported from your bank."
              : `${batches.length.toLocaleString("en-GB")} bank statement${batches.length === 1 ? "" : "s"} imported so far.`}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/settings/import">Import a CSV</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/settings/imports">See past imports</Link>
            </Button>
          </div>
        </section>

        <section className="rounded-lg bg-card p-5 lg:col-span-2 lg:p-6">
          <h2 className="type-heading">Signed in as the demo household</h2>
          <p className="mt-2 text-muted-foreground">This is a demo sign-in for building and testing. It holds no real data.</p>
          <form action={signOut} className="mt-4">
            <Button variant="secondary" type="submit">
              Sign out
            </Button>
          </form>
        </section>
      </div>
    </>
  );
}
