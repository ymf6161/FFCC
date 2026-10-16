import { assertInteger } from "./round";

/**
 * How an amount is shown (DESIGN.md "Money formatting"):
 * - `in`: plus sign, green in the UI: +£3,850.00
 * - `out`: true minus U+2212, text colour: −£86.40
 * - `transfer`: no sign, muted: £500.00
 * - `balance`: no sign when positive, true minus when negative
 */
export type MoneyKind = "in" | "out" | "transfer" | "balance";

export const MINUS = "−";

const gbpWhole = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Formats an absolute pence value without a sign. Integer maths up to the final division. */
function formatAbs(absPence: number, wholePounds: boolean): string {
  if (wholePounds) return gbpWhole.format(Math.floor((absPence + 50) / 100));
  // Pounds and pence are split as integers so no float rounding can creep in.
  const pounds = Math.trunc(absPence / 100);
  const pence = absPence % 100;
  const poundsText = gbpWhole.format(pounds);
  return `${poundsText}.${String(pence).padStart(2, "0")}`;
}

/**
 * The sign shown before an amount. One rule for every size, so a hero figure
 * and a list row never disagree:
 * money in "+", money out "−" (unless zero), transfers none,
 * balances "−" only when negative.
 */
export function moneySign(pence: number, kind: MoneyKind): "+" | typeof MINUS | "" {
  assertInteger(pence, "pence");
  switch (kind) {
    case "in":
      return "+";
    case "out":
      return pence === 0 ? "" : MINUS;
    case "transfer":
      return "";
    case "balance":
      return pence < 0 ? MINUS : "";
  }
}

export type FormatOptions = { kind?: MoneyKind; wholePounds?: boolean };

/** The only function that turns pence into £ text. */
export function formatMoney(pence: number, { kind = "balance", wholePounds = false }: FormatOptions = {}): string {
  assertInteger(pence, "pence");
  return `${moneySign(pence, kind)}${formatAbs(Math.abs(pence), wholePounds)}`;
}

/**
 * Parts of a hero figure: the sign, the pounds, and the two-digit pence
 * (shown smaller). Uses the same sign rule as `formatMoney`.
 */
export function formatHeroParts(
  pence: number,
  kind: MoneyKind = "balance",
): { sign: ReturnType<typeof moneySign>; pounds: string; pence: string } {
  assertInteger(pence, "pence");
  const abs = Math.abs(pence);
  return {
    sign: moneySign(pence, kind),
    pounds: gbpWhole.format(Math.trunc(abs / 100)),
    pence: String(abs % 100).padStart(2, "0"),
  };
}
