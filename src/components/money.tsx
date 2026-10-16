import { formatMoney, type MoneyKind, splitHero } from "@/money";
import { cn } from "@/lib/utils";

type Props = {
  pence: number;
  kind?: MoneyKind;
  size?: "hero" | "figure" | "row";
  /** On a field tile: uses the on-field green for money in. */
  onField?: boolean;
  wholePounds?: boolean;
  className?: string;
};

/** The only component that shows money (DESIGN.md "Money"). */
export function Money({ pence, kind = "balance", size = "row", onField = false, wholePounds = false, className }: Props) {
  const colour =
    kind === "in"
      ? onField
        ? "text-money-in-on-field"
        : "text-money-in"
      : kind === "transfer"
        ? "text-muted-foreground"
        : kind === "balance" && pence < 0 && !onField
          ? "text-error"
          : undefined;

  if (size === "hero") {
    const { pounds, pence: p, negative } = splitHero(pence);
    return (
      <span className={cn("type-figure-hero tabular-nums", colour, className)}>
        {negative ? "−" : ""}
        {pounds}
        <sup className="ml-0.5 align-top text-[45%] opacity-70">.{p}</sup>
      </span>
    );
  }

  return (
    <span className={cn("tabular-nums", size === "figure" ? "type-figure" : "type-amount", colour, className)}>
      {formatMoney(pence, { kind, wholePounds })}
    </span>
  );
}
