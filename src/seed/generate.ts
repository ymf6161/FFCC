import type { accountTypes } from "@/db/schema";
import type { SystemCategoryName } from "./categories";
import { addDays, addMonths, dateInMonth, lastDayOfMonth, parseDate } from "./dates";
import { createRng, type Rng } from "./rng";

/**
 * Generates the demo household's bank history (BUILD_PLAN Phase 1, section 10).
 * Every name and description is invented. The output is the same for the same
 * `endDate` and `seed` on any machine.
 *
 * Rows are what a bank CSV would contain. Each row also carries `expected`:
 * the category, transfer partner and refund target a correct engine should
 * find. Phase 3 tests the engine against these; they are never stored.
 */

export type SeedAccountKey = "current" | "savings" | "card" | "cash";

export type SeedAccount = {
  key: SeedAccountKey;
  type: (typeof accountTypes)[number];
  name: string;
  institution: string | null;
  isLiquid: boolean;
  openingBalance: number;
};

export const SEED_ACCOUNTS: readonly SeedAccount[] = [
  { key: "current", type: "current", name: "Current account", institution: "Northbank", isLiquid: true, openingBalance: 245_000 },
  { key: "savings", type: "savings", name: "Savings", institution: "Northbank", isLiquid: true, openingBalance: 800_000 },
  { key: "card", type: "credit_card", name: "Credit card", institution: "Meridian Card", isLiquid: false, openingBalance: -31_240 },
  { key: "cash", type: "cash_wallet", name: "Cash wallet", institution: null, isLiquid: true, openingBalance: 0 },
];

export type SeedRow = {
  key: string;
  account: SeedAccountKey;
  date: string;
  /** Integer pence, signed from the account's point of view. */
  amount: number;
  description: string;
  expected: {
    category: SystemCategoryName;
    /** Rows sharing a transfer key are the two sides of one transfer. */
    transferKey?: string;
    /** Key of the purchase this row refunds. */
    refundOfKey?: string;
  };
};

export type SeedData = {
  startDate: string;
  endDate: string;
  openingBalanceDate: string;
  accounts: readonly SeedAccount[];
  rows: SeedRow[];
};

const GROCERS = ["FRESHWAYS SUPERMARKET", "KOSHER CORNER", "PARKSIDE BAKERY", "GREENLEAF GROCERS"] as const;
const SUBSCRIPTIONS = [
  { description: "STREAMBOX SUBSCRIPTION", amount: -1099, day: 3 },
  { description: "CLOUDSAFE STORAGE", amount: -299, day: 9 },
  { description: "DAILY NEWS DIGITAL", amount: -799, day: 14 },
] as const;

export function generateSeedData({ endDate, seed = 20261016 }: { endDate: string; seed?: number }): SeedData {
  const rng = createRng(seed);
  const startDate = addDays(addMonths(endDate, -12), 1);
  const openingBalanceDate = addDays(startDate, -1);
  const rows: SeedRow[] = [];
  let n = 0;
  const nextKey = () => `seed-${String(++n).padStart(5, "0")}`;
  const inRange = (date: string) => date >= startDate && date <= endDate;

  const add = (row: Omit<SeedRow, "key">): SeedRow | null => {
    if (!inRange(row.date)) return null;
    const full = { ...row, key: nextKey() };
    rows.push(full);
    return full;
  };

  const transfer = (
    from: SeedAccountKey,
    to: SeedAccountKey,
    date: string,
    pence: number,
    fromDescription: string,
    toDescription: string,
    category: SystemCategoryName,
  ) => {
    if (!inRange(date)) return;
    const transferKey = `transfer-${n + 1}`;
    add({ account: from, date, amount: -pence, description: fromDescription, expected: { category, transferKey } });
    add({ account: to, date, amount: pence, description: toDescription, expected: { category, transferKey } });
  };

  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const months: { year: number; month: number }[] = [];
  const lastMonth = end.getUTCFullYear() * 12 + end.getUTCMonth();
  for (let i = start.getUTCFullYear() * 12 + start.getUTCMonth(); i <= lastMonth; i++) {
    months.push({ year: Math.floor(i / 12), month: i % 12 });
  }

  // Card purchases per month, so the repayment next month clears the statement.
  let previousCardSpend = 31_240;
  const refundable: SeedRow[] = [];

  for (const { year, month } of months) {
    const d = (day: number) => dateInMonth(year, month, day);

    // Income
    add({ account: "current", date: d(25), amount: 385_000, description: "ACME HOLDINGS LTD SALARY", expected: { category: "Salary" } });
    add({ account: "current", date: d(28), amount: 124_000, description: "BRIGHTWAY NURSERY PAYROLL", expected: { category: "Salary" } });
    add({ account: "savings", date: d(31), amount: rng.int(1100, 1900), description: "INTEREST PAID", expected: { category: "Interest" } });

    // Fixed costs from the current account
    add({ account: "current", date: d(1), amount: -142_500, description: "HALSTEAD BUILDING SOC MORTGAGE", expected: { category: "Mortgage" } });
    add({ account: "current", date: d(1), amount: -19_800, description: "NORTHGATE COUNCIL TAX DD", expected: { category: "Council tax" } });
    add({ account: "current", date: d(6), amount: -rng.int(11_000, 17_500), description: "BRIGHTSPARK ENERGY DD", expected: { category: "Energy" } });
    add({ account: "current", date: d(12), amount: -3_850, description: "CLEARFLOW WATER DD", expected: { category: "Water" } });
    add({ account: "current", date: d(15), amount: -3_200, description: "LINKWAVE BROADBAND", expected: { category: "Broadband and phone" } });
    add({ account: "current", date: d(18), amount: -2_400, description: "TALKSTAR MOBILE", expected: { category: "Broadband and phone" } });

    // Charity: a monthly standing order and the odd one-off gift
    add({ account: "current", date: d(2), amount: -15_000, description: "TZEDAKAH FUND SO", expected: { category: "Charity" } });
    if (rng.chance(0.5)) {
      add({ account: "current", date: d(rng.int(5, 27)), amount: -rng.pick([3_600, 5_400, 10_000, 18_000]), description: "COMMUNITY CHESED TRUST", expected: { category: "Charity" } });
    }

    // Card spending
    let cardSpend = 0;
    const cardPurchase = (date: string, amount: number, description: string, category: SystemCategoryName) => {
      const row = add({ account: "card", date, amount, description, expected: { category } });
      if (row) cardSpend += -amount;
      return row;
    };
    for (const sub of SUBSCRIPTIONS) cardPurchase(d(sub.day), sub.amount, sub.description, "Subscriptions");
    for (let week = 0; week < 4; week++) {
      const shops = rng.int(2, 3);
      for (let i = 0; i < shops; i++) {
        const row = cardPurchase(d(week * 7 + rng.int(1, 7)), -rng.int(1_800, 17_500), rng.pick(GROCERS), "Groceries");
        if (row && rng.chance(0.05)) refundable.push(row);
      }
    }
    for (let i = 0, fills = rng.int(2, 3); i < fills; i++) {
      cardPurchase(d(rng.int(1, 28)), -rng.int(4_500, 7_800), "FUELSTOP SERVICE STATION", "Fuel");
    }
    if (rng.chance(0.6)) {
      const row = cardPurchase(d(rng.int(1, 28)), -rng.int(2_500, 9_500), "LITTLE STEPS KIDSWEAR", "Clothing");
      if (row) refundable.push(row);
    }
    if (rng.chance(0.4)) cardPurchase(d(rng.int(1, 28)), -rng.int(1_500, 6_000), "HOMEWARE HOUSE", "Household");

    // Card repayment clears last month's statement: a transfer pair.
    transfer("current", "card", d(20), previousCardSpend, "MERIDIAN CARD PAYMENT", "PAYMENT RECEIVED THANK YOU", "Credit card repayment");
    previousCardSpend = cardSpend;

    // Saving and cash
    transfer("current", "savings", d(26), 40_000, "TRANSFER TO SAVINGS", "TRANSFER FROM CURRENT ACCOUNT", "Transfer");
    for (let i = 0, withdrawals = rng.int(1, 2); i < withdrawals; i++) {
      transfer("current", "cash", d(rng.int(3, 27)), rng.pick([4_000, 6_000, 10_000]), "CASH HIGH STREET ATM", "CASH WITHDRAWAL", "Cash withdrawal");
    }
  }

  // A few refunds: some partial, some full, a few days after the purchase.
  for (const purchase of pickRefunds(rng, refundable, 4)) {
    const full = rng.chance(0.5);
    const amount = full ? -purchase.amount : Math.max(100, Math.floor(-purchase.amount / 2));
    add({
      account: purchase.account,
      date: addDays(purchase.date, rng.int(2, 9)),
      amount,
      description: `REFUND ${purchase.description}`,
      expected: { category: purchase.expected.category, refundOfKey: purchase.key },
    });
  }

  rows.sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date.localeCompare(b.date)));
  return { startDate, endDate, openingBalanceDate, accounts: SEED_ACCOUNTS, rows };
}

function pickRefunds(rng: Rng, candidates: SeedRow[], count: number): SeedRow[] {
  const pool = [...candidates];
  const picked: SeedRow[] = [];
  while (picked.length < count && pool.length > 0) {
    picked.push(pool.splice(Math.floor(rng.next() * pool.length), 1)[0]!);
  }
  return picked;
}

/** End-of-month balances per account, as a bank statement would show them. */
export function monthEndBalances(data: SeedData): { account: SeedAccountKey; date: string; balance: number }[] {
  const out: { account: SeedAccountKey; date: string; balance: number }[] = [];
  for (const account of data.accounts) {
    const rows = data.rows.filter((r) => r.account === account.key);
    let balance = account.openingBalance;
    let i = 0;
    for (let monthEnd = lastDayOfMonth(data.startDate); monthEnd <= data.endDate; monthEnd = lastDayOfMonth(addDays(monthEnd, 1))) {
      while (i < rows.length && rows[i]!.date <= monthEnd) balance += rows[i++]!.amount;
      out.push({ account: account.key, date: monthEnd, balance });
    }
  }
  return out;
}
