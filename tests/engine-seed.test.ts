import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { MockAiProvider } from "@/ai";
import { accounts, categories, questions, transactions } from "@/db/schema";
import { runEngine } from "@/engine/run";
import { seedDatabase } from "@/seed";
import { generateSeedData } from "@/seed/generate";
import { createTestDb, FIXED_END_DATE } from "./helpers";

/** Phase 3 done when: the seed household categorises with transfers and refunds correctly handled. */
describe("the engine on the seed household", () => {
  it("files every row in its expected category, pairs every transfer and links every refund", async () => {
    const { db, cleanup } = await createTestDb();
    try {
      const seeded = await seedDatabase(db, { endDate: FIXED_END_DATE });
      const summary = await runEngine(db, seeded.householdId, { today: FIXED_END_DATE, provider: new MockAiProvider() });
      expect(summary.aiFailed).toBe(false);

      const data = generateSeedData({ endDate: FIXED_END_DATE });
      const catName = new Map((await db.select().from(categories)).map((c) => [c.id, c.name]));
      const acctType = new Map((await db.select().from(accounts)).map((a) => [a.id, a.type]));
      const rows = (await db.select().from(transactions).where(eq(transactions.householdId, seeded.householdId))).filter((t) => t.source !== "system");
      const typeOf = { current: "current", savings: "savings", card: "credit_card", cash: "cash_wallet" } as const;

      const used = new Set<string>();
      const idForKey = new Map<string, string>();
      const groupForKey = new Map<string, string | null>();
      const refundTarget = new Map<string, string | null>();
      for (const e of data.rows) {
        const match = rows.find((t) => !used.has(t.id) && t.date === e.date && t.amount === e.amount && t.rawDescription === e.description && acctType.get(t.accountId) === typeOf[e.account]);
        expect(match, e.key).toBeDefined();
        used.add(match!.id);
        idForKey.set(e.key, match!.id);
        expect(catName.get(match!.categoryId ?? ""), `${e.description} on ${e.date}`).toBe(e.expected.category);
        groupForKey.set(e.key, match!.transferGroupId);
        refundTarget.set(e.key, match!.refundOfId);
      }
      // Each expected transfer pair shares exactly one group, and only with its partner.
      const pairs = new Map<string, string[]>();
      for (const e of data.rows) if (e.expected.transferKey) pairs.set(e.expected.transferKey, [...(pairs.get(e.expected.transferKey) ?? []), e.key]);
      for (const [key, [a, b]] of pairs) {
        expect(groupForKey.get(a!), key).toBeTruthy();
        expect(groupForKey.get(a!), key).toBe(groupForKey.get(b!));
      }
      const openRefundQuestions = (await db.select().from(questions).where(and(eq(questions.householdId, seeded.householdId), eq(questions.type, "refund"), eq(questions.status, "open"))));
      for (const e of data.rows) {
        if (!e.expected.transferKey) expect(groupForKey.get(e.key), e.key).toBeNull();
        if (!e.expected.refundOfKey) {
          expect(refundTarget.get(e.key), e.key).toBeNull();
          continue;
        }
        const expected = idForKey.get(e.expected.refundOfKey)!;
        const id = idForKey.get(e.key)!;
        const row = rows.find((t) => t.id === id)!;
        if (row.status === "auto") {
          // Sure: linked to exactly the right purchase.
          expect(refundTarget.get(e.key), e.key).toBe(expected);
        } else {
          // A partial refund that could belong to several purchases: linked to a candidate, and the family is asked, with the right one offered.
          const q = openRefundQuestions.find((x) => x.subjectId === id);
          expect(q?.options.map((o) => o.key), e.key).toContain(`refund_of:${expected}`);
          expect(q?.options.map((o) => o.key)).toContain(`refund_of:${refundTarget.get(e.key)}`);
        }
      }
      // Everything else is sure.
      expect(summary.status.unconfirmed).toBe(openRefundQuestions.length);

      // Running it again changes nothing.
      const again = await runEngine(db, seeded.householdId, { today: FIXED_END_DATE, provider: new MockAiProvider() });
      expect(again).toMatchObject({ rowsChanged: 0, questionsOpened: 0, pairsCreated: 0, refundsLinked: 0, sweeps: 0 });
    } finally {
      cleanup();
    }
  });
});
