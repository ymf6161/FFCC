import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <>
      <PageHeader title="Reports" description="Understanding your money over time." />
      <EmptyState title="No reports yet">
        <p>
          A short summary of each month, spending by category, income sources and net worth over time will appear here
          once transactions are sorted. You will also be able to download them.
        </p>
      </EmptyState>
    </>
  );
}
