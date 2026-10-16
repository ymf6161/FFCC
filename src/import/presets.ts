import { headerSignature, type Mapping } from "./mapping";

/**
 * Built-in layouts we recognise without the family mapping columns. They are
 * modelled on how these banks describe their CSV exports; they have not been
 * checked against real exports, so the family always sees the mapping before
 * importing.
 */
export type Preset = { key: string; name: string; headers: string[]; mapping: Omit<Mapping, "headerRow"> };

export const PRESETS: readonly Preset[] = [
  {
    key: "barclays-style",
    name: "Barclays-style CSV",
    headers: ["Number", "Date", "Account", "Amount", "Subcategory", "Memo"],
    mapping: {
      dateColumn: "Date",
      dateFormat: "dd/mm/yyyy",
      amountColumn: "Amount",
      signConvention: "money_in_positive",
      descriptionColumns: ["Memo"],
    },
  },
  {
    key: "nationwide-style",
    name: "Nationwide-style CSV",
    headers: ["Date", "Transaction type", "Description", "Paid out", "Paid in", "Balance"],
    mapping: {
      dateColumn: "Date",
      dateFormat: "d mmm yyyy",
      debitColumn: "Paid out",
      creditColumn: "Paid in",
      signConvention: "money_in_positive",
      descriptionColumns: ["Description"],
      runningBalanceColumn: "Balance",
    },
  },
  {
    key: "monzo-style",
    name: "Monzo-style CSV",
    headers: ["Transaction ID", "Date", "Time", "Type", "Name", "Category", "Amount", "Currency", "Notes", "Description"],
    mapping: {
      dateColumn: "Date",
      dateFormat: "dd/mm/yyyy",
      amountColumn: "Amount",
      signConvention: "money_in_positive",
      descriptionColumns: ["Name", "Description"],
      externalIdColumn: "Transaction ID",
    },
  },
  {
    key: "amex-style",
    name: "Amex-style card CSV",
    headers: ["Date", "Description", "Card Member", "Account #", "Amount"],
    mapping: {
      dateColumn: "Date",
      dateFormat: "dd/mm/yyyy",
      amountColumn: "Amount",
      signConvention: "money_out_positive",
      descriptionColumns: ["Description"],
    },
  },
];

export function findPreset(signature: string): Preset | undefined {
  return PRESETS.find((p) => headerSignature(p.headers) === signature);
}
