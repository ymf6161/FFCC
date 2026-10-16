import type { Drift } from "@/import/drift";
import { formatFullDate } from "@/lib/dates";
import { Money } from "./money";

/** "Matches the bank" or "£23.40 different from the bank since 3 Mar 2026", in words, never colour alone. */
export function DriftLine({ drift }: { drift: Drift }) {
  if (drift.status === "no_checkpoints") return <span className="text-muted-foreground">No bank balance to check against yet</span>;
  if (drift.status === "matches") return <span className="text-money-in">Matches the bank on {formatFullDate(drift.checkedOn)}</span>;
  return (
    <span className="text-warning-strong">
      <Money pence={Math.abs(drift.difference)} kind="transfer" className="font-bold text-warning-strong" /> {drift.difference > 0 ? "more" : "less"} than the bank
      since {formatFullDate(drift.since)}
    </span>
  );
}
