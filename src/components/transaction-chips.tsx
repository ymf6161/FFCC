import { Chip } from "@/components/chip";

type Row = {
  status: "auto" | "confirmed" | "unconfirmed";
  bookingStatus: "pending" | "booked";
  categoryName: string | null;
  categoryKind: "income" | "expense" | "transfer" | null;
  transferGroupId: string | null;
  refundOfId: string | null;
  refunded: boolean;
};

/** Status in words, never colour alone (DESIGN.md "Chip / badge"). */
export function StatusChip({ status }: { status: Row["status"] }) {
  if (status === "confirmed") return <Chip tone="success">Confirmed</Chip>;
  if (status === "unconfirmed") return <Chip tone="warning">Not sure</Chip>;
  return <Chip tone="neutral">Auto</Chip>;
}

/** Marks transfers and refunds, which are never income or spending. */
export function KindChips({ row }: { row: Row }) {
  const chips: React.ReactNode[] = [];
  if (row.bookingStatus === "pending") chips.push(<Chip key="p" tone="neutral">Pending</Chip>);
  if (row.categoryKind === "transfer") {
    const label = row.categoryName === "Credit card repayment" ? "Card repayment" : row.categoryName === "Cash withdrawal" ? "Cash withdrawal" : "Transfer";
    chips.push(<Chip key="t" tone="neutral">{label}</Chip>);
    if (!row.transferGroupId) chips.push(<Chip key="u" tone="warning">Unpaired</Chip>);
  }
  if (row.refundOfId) chips.push(<Chip key="r" tone="success">Refund</Chip>);
  if (row.refunded) chips.push(<Chip key="d" tone="neutral">Refunded</Chip>);
  return chips.length ? <span className="inline-flex flex-wrap gap-1">{chips}</span> : null;
}

export function moneyKindFor(row: Pick<Row, "categoryKind"> & { amount: number }): "in" | "out" | "transfer" {
  if (row.categoryKind === "transfer") return "transfer";
  return row.amount > 0 ? "in" : "out";
}
