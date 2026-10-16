import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { generateSeedData, monthEndBalances } from "@/seed/generate";
import { SYSTEM_CATEGORIES } from "@/seed/categories";
import { seedDatabase } from "@/seed";
import { createTestDb, FIXED_END_DATE } from "./helpers";

const data = generateSeedData({ endDate: FIXED_END_DATE });
const categoryKind = new Map(SYSTEM_CATEGORIES.map((c) => [c.name, c.kind]));

describe("seed generator", () => {
  it("is the same every time for the same end date", () => {
    expect(generateSeedData({ endDate: FIXED_END_DATE })).toEqual(data);
  });

  it("covers exactly 12 months ending on the end date", () => {
    expect(data.startDate).toBe("2025-10-17");
    expect(data.endDate).toBe(FIXED_END_DATE);
    const dates = data.rows.map((r) => r.date).sort();
    expect(dates[0]! >= data.startDate).toBe(true);
    expect(dates.at(-1)! <= data.endDate).toBe(true);
    const months = new Set(dates.map((d) => d.slice(0, 7)));
    expect(months.size).toBe(13); // 17 Oct 2025 to 16 Oct 2026 touches 13 calendar months
  });

  it("stores every amount as whole pence and never zero", () => {
    for (const row of data.rows) {
      expect(Number.isSafeInteger(row.amount), row.key).toBe(true);
      expect(row.amount).not.toBe(0);
    }
  });

  it("includes every kind of activity the build plan asks for", () => {
    const categories = new Set(data.rows.map((r) => r.expected.category));
    for (const name of ["Salary", "Mortgage", "Energy", "Water", "Council tax", "Groceries", "Fuel", "Subscriptions", "Charity", "Credit card repayment", "Transfer", "Cash withdrawal"]) {
      expect(categories.has(name as never), name).toBe(true);
    }
    expect(data.rows.some((r) => r.expected.refundOfKey)).toBe(true);
    for (const key of ["current", "savings", "card", "cash"]) {
      expect(data.rows.some((r) => r.account === key), key).toBe(true);
    }
  });

  it("makes every transfer a pair on two different accounts that sums to zero", () => {
    const groups = new Map<string, typeof data.rows>();
    for (const row of data.rows) {
      if (!row.expected.transferKey) continue;
      groups.set(row.expected.transferKey, [...(groups.get(row.expected.transferKey) ?? []), row]);
    }
    expect(groups.size).toBeGreaterThan(20);
    for (const [key, sides] of groups) {
      expect(sides, key).toHaveLength(2);
      expect(sides[0]!.amount + sides[1]!.amount, key).toBe(0);
      expect(sides[0]!.account).not.toBe(sides[1]!.account);
      expect(categoryKind.get(sides[0]!.expected.category)).toBe("transfer");
    }
  });

  it("never pairs mortgage payments as transfers", () => {
    for (const row of data.rows.filter((r) => r.expected.category === "Mortgage")) {
      expect(row.expected.transferKey).toBeUndefined();
      expect(row.amount).toBeLessThan(0);
    }
  });

  it("uses the right signs on the credit card", () => {
    const card = data.rows.filter((r) => r.account === "card");
    for (const row of card) {
      if (row.expected.transferKey || row.expected.refundOfKey) expect(row.amount, row.key).toBeGreaterThan(0);
      else expect(row.amount, row.key).toBeLessThan(0);
    }
  });

  it("links each refund to an earlier purchase on the same account, no larger than it, in the same category", () => {
    const byKey = new Map(data.rows.map((r) => [r.key, r]));
    const refunds = data.rows.filter((r) => r.expected.refundOfKey);
    for (const refund of refunds) {
      const purchase = byKey.get(refund.expected.refundOfKey!)!;
      expect(purchase, refund.key).toBeDefined();
      expect(refund.amount).toBeGreaterThan(0);
      expect(refund.amount).toBeLessThanOrEqual(-purchase.amount);
      expect(refund.account).toBe(purchase.account);
      expect(refund.date > purchase.date).toBe(true);
      expect(refund.expected.category).toBe(purchase.expected.category);
    }
  });

  it("gives month-end balances consistent with the rows", () => {
    const balances = monthEndBalances(data);
    for (const account of data.accounts) {
      const last = balances.filter((b) => b.account === account.key).at(-1)!;
      const lastMonthEnd = last.date;
      const expected = account.openingBalance + data.rows.filter((r) => r.account === account.key && r.date <= lastMonthEnd).reduce((s, r) => s + r.amount, 0);
      expect(last.balance, account.key).toBe(expected);
    }
  });
});

describe("seeding the database", () => {
  async function seedFresh() {
    const t = await createTestDb();
    const result = await seedDatabase(t.db, { endDate: FIXED_END_DATE });
    const counts: Record<string, number> = {};
    for (const [name, table] of Object.entries({
      households: schema.households,
      users: schema.users,
      accounts: schema.accounts,
      categories: schema.categories,
      transactions: schema.transactions,
      checkpoints: schema.balanceCheckpoints,
      batches: schema.importBatches,
      audit: schema.auditLog,
    })) {
      const [row] = await t.db.select({ n: count() }).from(table);
      counts[name] = row!.n;
    }
    return { ...t, result, counts };
  }

  it("builds the same database every time", async () => {
    const first = await seedFresh();
    const second = await seedFresh();
    try {
      expect(first.counts).toEqual(second.counts);
      expect(first.counts.transactions).toBe(data.rows.length);
      expect(first.counts).toMatchObject({ households: 1, users: 1, accounts: 4, categories: SYSTEM_CATEGORIES.length, batches: 4 });
    } finally {
      first.cleanup();
      second.cleanup();
    }
  });

  it("stores transactions as a bank import would: booked, unconfirmed, uncategorised, unlinked", async () => {
    const t = await seedFresh();
    try {
      const rows = await t.db.select().from(schema.transactions);
      for (const row of rows) {
        expect(row.bookingStatus).toBe("booked");
        expect(row.status).toBe("unconfirmed");
        expect(row.source).toBe("csv");
        expect(row.categoryId).toBeNull();
        expect(row.transferGroupId).toBeNull();
        expect(row.refundOfId).toBeNull();
        expect(row.importBatchId).not.toBeNull();
      }
    } finally {
      t.cleanup();
    }
  });

  it("audits every write: one entry per row for set-up data, one per batch for transactions", async () => {
    const t = await seedFresh();
    try {
      const { counts } = t;
      // household, user, membership, categories, ma'aser setting, accounts, batches,
      // plus one transactions entry and one checkpoints entry per batch.
      const expected = 3 + SYSTEM_CATEGORIES.length + 1 + 4 + 4 + 4 * 2;
      expect(counts.audit).toBe(expected);
      const txEntries = await t.db.select().from(schema.auditLog).where(eq(schema.auditLog.entity, "transactions"));
      expect(txEntries.reduce((s, e) => s + Number((e.after as { rowCount: number }).rowCount), 0)).toBe(counts.transactions);
    } finally {
      t.cleanup();
    }
  });

  it("marks charity as reducing ma'aser and salary as accruing it", async () => {
    const t = await seedFresh();
    try {
      const cats = await t.db.select().from(schema.categories);
      expect(cats.find((c) => c.name === "Charity")).toMatchObject({ kind: "expense", maaserEffect: "reduce" });
      expect(cats.find((c) => c.name === "Salary")).toMatchObject({ kind: "income", maaserEffect: "accrue" });
      expect(cats.find((c) => c.name === "Credit card repayment")).toMatchObject({ kind: "transfer" });
    } finally {
      t.cleanup();
    }
  });
});
