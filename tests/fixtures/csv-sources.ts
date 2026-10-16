/**
 * Source data for the sample bank CSVs in fixtures/csv. Everything here is
 * invented: names, references, account numbers and amounts. The CSV files are
 * written from this by `bun run fixtures` and checked by the tests.
 */
import { createRng } from "@/seed/rng";
import { addDays } from "@/seed/dates";

export type SourceRow = {
  date: string;
  /** Signed pence from the account's point of view. */
  amount: number;
  description: string;
  /** Format-specific extras. */
  type?: string;
  name?: string;
  category?: string;
  time?: string;
  id?: string;
};

export type SourceAccount = {
  key: "barclays" | "nationwide" | "monzo" | "amex";
  openingBalance: number;
  rows: SourceRow[];
};

function eachDay(from: string, to: string, fn: (date: string, dayOfMonth: number, weekday: number) => void) {
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const date = new Date(`${d}T00:00:00Z`);
    fn(d, date.getUTCDate(), date.getUTCDay());
  }
}

function barclays(): SourceAccount {
  const rng = createRng(101);
  const rows: SourceRow[] = [];
  const shops = ["FRESHWAYS SUPERMARKET", "KOSHER KORNER LTD", "PARKSIDE BAKERY", "מכולת השכונה"];
  eachDay("2026-01-01", "2026-05-31", (date, day, weekday) => {
    if (day === 1) rows.push({ date, amount: -19_800, description: "NORTHGATE COUNCIL TAX", type: "Direct Debit" });
    if (day === 3) rows.push({ date, amount: -5_000, description: "תרומה קופת צדקה", type: "Standing Order" });
    if (day === 6) rows.push({ date, amount: -rng.int(9_000, 16_000), description: "OCTANE ENERGY", type: "Direct Debit" });
    if (day === 28) rows.push({ date, amount: 295_000, description: "BRIGHTLINE LTD SALARY", type: "Counter Credit" });
    // Pays off the Amex-style card each month: the other side is in the card file.
    if (day === 22 && date <= "2026-03-31") rows.push({ date, amount: -40_000, description: "AMEX-STYLE CARD PAYMENT", type: "Payment" });
    if (weekday === 1 || weekday === 4) {
      const shop = rng.pick(shops);
      rows.push({ date, amount: -rng.int(1_850, 12_400), description: `${shop} ON ${date.slice(8)}/${date.slice(5, 7)}`, type: "Debit" });
    }
    if (day === 15 && rng.chance(0.6)) rows.push({ date, amount: -rng.pick([1_800, 3_600, 5_400]), description: "גמ״ח כלי קודש", type: "Payment" });
  });
  // Two genuine, identical coffees on the same day: once in the first file only, once in the overlap.
  for (const date of ["2026-02-10", "2026-03-12"]) {
    rows.push({ date, amount: -320, description: "COFFEE CORNER", type: "Debit" });
    rows.push({ date, amount: -320, description: "COFFEE CORNER", type: "Debit" });
  }
  return { key: "barclays", openingBalance: 0, rows: sortRows(rows) };
}

function nationwide(): SourceAccount {
  const rng = createRng(202);
  const rows: SourceRow[] = [];
  eachDay("2026-01-01", "2026-04-30", (date, day, weekday) => {
    if (day === 2) rows.push({ date, amount: -138_500, description: "HALSTEAD BS MORTGAGE", type: "Direct debit" });
    // Tops up the Monzo-style account each month: the other side is in the Monzo file.
    if (day === 1 && date >= "2026-02-01") rows.push({ date, amount: -50_000, description: "TRANSFER TO MONZO", type: "Transfer" });
    if (day === 10) rows.push({ date, amount: -3_850, description: "CLEARFLOW WATER", type: "Direct debit" });
    if (day === 25) rows.push({ date, amount: 210_000, description: "ACME HOLDINGS PAYROLL", type: "Bank credit" });
    if (day === 20) rows.push({ date, amount: -10_000, description: "קרן ידידים", type: "Standing order" });
    if (weekday === 5) rows.push({ date, amount: -rng.int(3_500, 9_900), description: rng.pick(["KOSHER KORNER LTD", "ספרי קודש בע״מ", "FUELSTOP SERVICE STATION"]), type: "Card payment" });
    if (weekday === 3 && rng.chance(0.5)) rows.push({ date, amount: -rng.pick([2_000, 4_000, 6_000]), description: "CASH HIGH STREET ATM", type: "Cash withdrawal" });
  });
  for (const date of ["2026-01-14", "2026-03-04"]) {
    rows.push({ date, amount: -320, description: "COFFEE CORNER", type: "Card payment" });
    rows.push({ date, amount: -320, description: "COFFEE CORNER", type: "Card payment" });
  }
  return { key: "nationwide", openingBalance: 412_350, rows: sortRows(rows) };
}

function monzo(): SourceAccount {
  const rng = createRng(303);
  const rows: SourceRow[] = [];
  let n = 0;
  const id = () => `tx_fake${String(++n).padStart(6, "0")}`;
  const time = () => `${String(rng.int(8, 21)).padStart(2, "0")}:${String(rng.int(0, 59)).padStart(2, "0")}:${String(rng.int(0, 59)).padStart(2, "0")}`;
  eachDay("2026-02-01", "2026-04-30", (date, day, weekday) => {
    if (day === 1) rows.push({ date, amount: 50_000, name: "Joint account", description: "MONTHLY TOP UP", type: "Faster payment", category: "transfers" });
    if (day === 9) rows.push({ date, amount: -1_099, name: "Streambox", description: "STREAMBOX SUBSCRIPTION", type: "Card payment", category: "entertainment" });
    if (weekday === 2 || weekday === 6) {
      const pick = rng.pick([
        { name: "Freshways", description: "FRESHWAYS SUPERMARKET", category: "groceries" },
        { name: "פיצה ירושלים", description: "PIZZA YERUSHALAYIM", category: "eating_out" },
        { name: "Little Steps", description: "LITTLE STEPS KIDSWEAR", category: "shopping" },
      ]);
      rows.push({ date, amount: -rng.int(650, 4_800), ...pick, type: "Card payment" });
    }
    if (day === 18) rows.push({ date, amount: -2_600, name: "צדקה לעניים", description: "TZEDAKAH APPEAL", type: "Faster payment", category: "charity" });
  });
  for (const date of ["2026-02-24", "2026-03-17"]) {
    rows.push({ date, amount: -320, name: "Coffee Corner", description: "COFFEE CORNER", type: "Card payment", category: "eating_out" });
    rows.push({ date, amount: -320, name: "Coffee Corner", description: "COFFEE CORNER", type: "Card payment", category: "eating_out" });
  }
  return { key: "monzo", openingBalance: 0, rows: sortRows(rows).map((r) => ({ ...r, id: id(), time: time() })) };
}

function amex(): SourceAccount {
  const rng = createRng(404);
  const rows: SourceRow[] = [];
  eachDay("2026-01-01", "2026-03-31", (date, day, weekday) => {
    if (weekday === 0) rows.push({ date, amount: -rng.int(1_200, 15_000), description: rng.pick(["HOMEWARE HOUSE LONDON", "SEFORIM CENTRE", "חנות צעצועים", "FUELSTOP SERVICE STATION"]) });
    if (day === 22) rows.push({ date, amount: 40_000, description: "PAYMENT RECEIVED - THANK YOU" });
  });
  rows.push({ date: "2026-02-08", amount: -320, description: "COFFEE CORNER" });
  rows.push({ date: "2026-02-08", amount: -320, description: "COFFEE CORNER" });
  // A purchase, then a partial refund of it.
  rows.push({ date: "2026-02-14", amount: -4_998, description: "HOMEWARE HOUSE LONDON" });
  rows.push({ date: "2026-03-02", amount: 2_499, description: "REFUND HOMEWARE HOUSE LONDON" });
  return { key: "amex", openingBalance: 0, rows: sortRows(rows) };
}

function sortRows(rows: SourceRow[]): SourceRow[] {
  // Stable: rows on the same date keep the order they were added.
  return rows.map((r, i) => ({ r, i })).sort((a, b) => a.r.date.localeCompare(b.r.date) || a.i - b.i).map(({ r }) => r);
}

export const SOURCES = { barclays: barclays(), nationwide: nationwide(), monzo: monzo(), amex: amex() };

/** One file: which account, which dates, and how to write it. */
export type FixtureFile = { file: string; account: SourceAccount["key"]; from: string; to: string };

export const FIXTURE_FILES: readonly FixtureFile[] = [
  { file: "barclays-style-current-2026-01-to-03.csv", account: "barclays", from: "2026-01-01", to: "2026-03-31" },
  { file: "barclays-style-current-2026-03-to-05.csv", account: "barclays", from: "2026-03-01", to: "2026-05-31" },
  { file: "nationwide-style-joint-2026-01-to-03.csv", account: "nationwide", from: "2026-01-01", to: "2026-03-31" },
  { file: "nationwide-style-joint-2026-02-to-04.csv", account: "nationwide", from: "2026-02-01", to: "2026-04-30" },
  { file: "monzo-style-current-2026-02-to-03.csv", account: "monzo", from: "2026-02-01", to: "2026-03-31" },
  { file: "monzo-style-current-2026-03-to-04.csv", account: "monzo", from: "2026-03-01", to: "2026-04-30" },
  { file: "amex-style-card-2026-01-to-03.csv", account: "amex", from: "2026-01-01", to: "2026-03-31" },
];

export function rowsFor(f: FixtureFile): SourceRow[] {
  return SOURCES[f.account].rows.filter((r) => r.date >= f.from && r.date <= f.to);
}

// ---- writing -------------------------------------------------------------

const csvField = (v: string, quoteAll = false) => (quoteAll || /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const line = (cells: string[], quoteAll = false) => cells.map((c) => csvField(c, quoteAll)).join(",");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dmy = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const dMonY = (d: string) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const plain = (p: number) => `${p < 0 ? "-" : ""}${Math.trunc(Math.abs(p) / 100)}.${String(Math.abs(p) % 100).padStart(2, "0")}`;
const pounds = (p: number) => {
  const abs = Math.abs(p);
  const whole = Math.trunc(abs / 100).toLocaleString("en-GB");
  return `${p < 0 ? "-" : ""}£${whole}.${String(abs % 100).padStart(2, "0")}`;
};

/** Balance after each row, starting from the account's opening balance. */
function withBalances(account: SourceAccount): Map<SourceRow, number> {
  const out = new Map<SourceRow, number>();
  let balance = account.openingBalance;
  for (const row of account.rows) {
    balance += row.amount;
    out.set(row, balance);
  }
  return out;
}

export function renderFixture(f: FixtureFile): string {
  const account = SOURCES[f.account];
  const rows = rowsFor(f);
  switch (f.account) {
    case "barclays": {
      // Newest first, as some banks export.
      const body = [...rows].reverse().map((r) => line(["", dmy(r.date), "99-99-99 12345678", plain(r.amount), r.type ?? "", `${r.description}`]));
      return [line(["Number", "Date", "Account", "Amount", "Subcategory", "Memo"]), ...body].join("\n") + "\n";
    }
    case "nationwide": {
      const balances = withBalances(account);
      const last = balances.get(rows.at(-1)!)!;
      const preamble = [
        line(["Account Name:", "FlexDirect ****9999"], true),
        line(["Account Balance:", pounds(last)], true),
        line(["Available Balance: ", pounds(last)], true),
        "",
      ];
      const body = rows.map((r) =>
        line([dMonY(r.date), r.type ?? "", r.description, r.amount < 0 ? pounds(-r.amount) : "", r.amount > 0 ? pounds(r.amount) : "", pounds(balances.get(r)!)], true),
      );
      return [...preamble, line(["Date", "Transaction type", "Description", "Paid out", "Paid in", "Balance"], true), ...body].join("\r\n") + "\r\n";
    }
    case "monzo": {
      const body = rows.map((r) => line([r.id!, dmy(r.date), r.time!, r.type ?? "", r.name ?? "", r.category ?? "", plain(r.amount), "GBP", "", r.description]));
      return [line(["Transaction ID", "Date", "Time", "Type", "Name", "Category", "Amount", "Currency", "Notes", "Description"]), ...body].join("\n") + "\n";
    }
    case "amex": {
      // Card statement: spending shown as positive, payments and refunds as negative.
      const body = rows.map((r) => line([dmy(r.date), r.description, "MR A TEST", "-99999", plain(-r.amount)]));
      return "\uFEFF" + [line(["Date", "Description", "Card Member", "Account #", "Amount"]), ...body].join("\n") + "\n";
    }
  }
}

/** What a correct import of this file stores, in date order. */
export function expectedRows(f: FixtureFile): { date: string; amount: number; description: string; externalId?: string; balance?: number }[] {
  const balances = withBalances(SOURCES[f.account]);
  return rowsFor(f).map((r) => ({
    date: r.date,
    amount: r.amount,
    description: f.account === "monzo" ? `${r.name} ${r.description}` : r.description,
    ...(r.id ? { externalId: r.id } : {}),
    ...(f.account === "nationwide" ? { balance: balances.get(r)! } : {}),
  }));
}
