import Link from "next/link";
import { requireSession } from "@/auth/session";
import { PageHeader } from "@/components/page-header";
import { getDb } from "@/db";
import { listAccounts } from "@/db/queries";
import { ImportWizard } from "./import-wizard";

export const metadata = { title: "Import a bank statement" };

export default async function ImportPage() {
  const { householdId } = await requireSession();
  const accounts = (await listAccounts(await getDb(), householdId)).filter((a) => a.type !== "loan" && a.type !== "mortgage");
  return (
    <>
      <PageHeader title="Import a bank statement" description="Bring in transactions from a CSV file exported from your bank." />
      <ImportWizard accounts={accounts.map((a) => ({ id: a.id, name: a.name, type: a.type }))} />
      <p className="mt-4">
        <Link href="/settings/imports" className="text-teal-text underline-offset-4 hover:underline">
          See past imports
        </Link>
      </p>
    </>
  );
}
