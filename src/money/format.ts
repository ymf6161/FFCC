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

export type FormatOptions = { kind?: MoneyKind; wholePounds?: boolean };

/** The only function that turns pence into £ text. */
export function formatMoney(pence: number, { kind = "balance", wholePounds = false }: FormatOptions = {}): string {
  assertInteger(pence, "pence");
  const abs = formatAbs(Math.abs(pence), wholePounds);
  switch (kind) {
    case "in":
      return `+${abs}`;
    case "out":
      return pence === 0 ? abs : `${MINUS}${abs}`;
    case "transfer":
      return abs;
    case "balance":
      return pence < 0 ? `${MINUS}${abs}` : abs;
  }
}

/** Splits a figure for hero display: pounds part and the two-digit pence. */
export function splitHero(pence: number): { pounds: string; pence: string; negative: boolean } {
  assertInteger(pence, "pence");
  const abs = Math.abs(pence);
  return {
    pounds: gbpWhole.format(Math.trunc(abs / 100)),
    pence: String(abs % 100).padStart(2, "0"),
    negative: pence < 0,
  };
}

