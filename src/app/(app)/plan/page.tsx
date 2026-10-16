import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Plan" };

export default function PlanPage() {
  return (
    <>
      <PageHeader title="Plan" description="Money set aside." />
      <EmptyState title="Nothing set aside yet">
        <p>
          Money you put aside for tax, emergencies or anything else will show here, with ma’aser owed and progress
          towards your goals. Setting these up arrives in a later update.
        </p>
      </EmptyState>
    </>
  );
}
