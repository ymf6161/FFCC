import { AppShell } from "@/components/shell/app-shell";
import { requireSession } from "@/auth/session";
import { getDb } from "@/db";
import { countOpenQuestions } from "@/db/queries";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { householdId } = await requireSession();
  const openQuestions = await countOpenQuestions(await getDb(), householdId);
  return <AppShell openQuestions={openQuestions}>{children}</AppShell>;
}
