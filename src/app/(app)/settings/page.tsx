import { signOut } from "@/auth/actions";
import { requireSession } from "@/auth/session";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { getHousehold, listAccounts } from "@/db/queries";
import type { accountTypes } from "@/db/schema";

export const metadata = { title: "Settings" };

const ACCOUNT_TYPE_LABELS: Record<(typeof accountTypes)[number], string> = {
  current: "Current account",
  savings: "Savings",
  credit_card: "Credit card",
  cash_wallet: "Cash wallet",
  loan: "Loan",
  mortgage: "Mortgage",
  investment: "Investment",
  other_asset: "Other asset",
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default async function SettingsPage() {
  const { householdId } = await requireSession();
  const db = await getDb();
  const [household, accounts] = await Promise.all([getHousehold(db, householdId), listAccounts(db, householdId)]);

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
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 type-label text-muted-foreground">
            Importing statements and editing accounts arrive in later updates.
          </p>
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
