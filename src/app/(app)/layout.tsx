import { AppShell } from "@/components/shell/app-shell";
import { requireSession } from "@/auth/session";
import { getOpenQuestionCount } from "./data";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { householdId } = await requireSession();
  const openQuestions = await getOpenQuestionCount(householdId);
  return <AppShell openQuestions={openQuestions}>{children}</AppShell>;
}
