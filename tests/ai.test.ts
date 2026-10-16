import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiUnavailableError, buildCategoriseItem, getAiProvider, MockAiProvider, redactDescription } from "@/ai";
import type { Db } from "@/db";
import { householdMerchants, jobs, merchants } from "@/db/schema";
import { makeHandlers } from "@/jobs/handlers";
import { enqueue } from "@/jobs/queue";
import { runOnce } from "@/jobs/runner";
import { createTestDb } from "./helpers";
import { addTx, engineHousehold, run, tx } from "./rules/helpers";

let db: Db;
let cleanup: () => void;
beforeAll(async () => ({ db, cleanup } = await createTestDb()));
afterAll(() => cleanup());

describe("redaction (BUILD_PLAN R4)", () => {
  it("masks sort codes, account and card numbers and long digit runs, and keeps Hebrew", () => {
    expect(redactDescription("TFR 99-99-99 12345678 צדקה")).toBe("TFR [sort code] [number] צדקה");
    expect(redactDescription("CARD 4111 1111 1111 1111 TESCO")).toBe("CARD [card] TESCO");
    expect(redactDescription("FlexDirect ****9999")).toBe("FlexDirect [card]");
    expect(redactDescription("REF 1234567890 קופת צדקה")).toBe("REF [number] קופת צדקה");
    expect(redactDescription("COFFEE CORNER 3297")).toBe("COFFEE CORNER 3297");
  });

  it("sends only the fields the AI needs", () => {
    const item = buildCategoriseItem({ key: "m0", merchant: "TESCO", description: "TESCO 12345678", amount: -1234, date: "2026-03-01", accountType: "current" });
    expect(Object.keys(item).sort()).toEqual(["accountType", "amount", "date", "description", "direction", "key", "merchant"]);
    expect(item).toMatchObject({ amount: 1234, direction: "out", description: "TESCO [number]" });
  });

  it("never lets an account number, sort code or balance reach the provider", async () => {
    const h = await engineHousehold(db, ["current"]);
    await addTx(db, h, { date: "2026-03-01", amount: -2_000, description: "SHOP 99-99-99 12345678 ספרים" });
    const provider = new MockAiProvider();
    await run(db, h, "2026-03-02", provider);
    const sent = JSON.stringify([provider.seenCategorise, provider.seenLookups]);
    expect(sent).not.toMatch(/12345678|99-99-99/);
    expect(sent).not.toMatch(/balance/i);
  });
});

describe("AI use", () => {
  it("asks once per unique merchant, batched, and reuses the answer for every row", async () => {
    const h = await engineHousehold(db, ["current"]);
    for (let d = 1; d <= 6; d++) await addTx(db, h, { date: `2026-03-0${d}`, amount: -1_000 * d, description: d % 2 ? "פיצה ירושלים" : "SEFORIM CENTRE" });
    const provider = new MockAiProvider();
    await run(db, h, "2026-03-10", provider);
    expect(provider.seenCategorise).toHaveLength(1);
    expect(provider.seenCategorise[0]).toHaveLength(2);
  });

  it("rejects malformed AI output: nothing is filed from it", async () => {
    const h = await engineHousehold(db, ["current"]);
    const id = await addTx(db, h, { date: "2026-03-01", amount: -1_000, description: "SEFORIM CENTRE" });
    const provider = new MockAiProvider();
    provider.categoriseMerchants = async () => ({ results: [{ key: "m0", category: "DROP TABLE", confidence: 999 }] });
    provider.lookupMerchant = async () => ({ isBusiness: false, canonicalName: "x", suggestedCategory: null });
    const summary = await run(db, h, "2026-03-02", provider);
    expect(summary.aiFailed).toBe(true);
    expect((await tx(db, id)).categoryId).toBeNull();
  });

  it("ignores a category the household doesn't have", async () => {
    const h = await engineHousehold(db, ["current"]);
    const id = await addTx(db, h, { date: "2026-03-01", amount: -1_000, description: "SEFORIM CENTRE" });
    const provider = new MockAiProvider();
    provider.categoriseMerchants = async () => ({ results: [{ key: "m0", category: "Holidays in space", confidence: 99 }] });
    provider.lookupMerchant = async () => ({ isBusiness: false, canonicalName: "x", suggestedCategory: null });
    await run(db, h, "2026-03-02", provider);
    expect((await tx(db, id)).categoryId).toBeNull();
  });

  it("leaves rows unconfirmed when the AI is down, and the job retries", async () => {
    const h = await engineHousehold(db, ["current"]);
    const id = await addTx(db, h, { date: "2026-03-01", amount: -1_000, description: "SEFORIM CENTRE" });
    const down = new MockAiProvider();
    down.failWith = new AiUnavailableError();
    await db.update(jobs).set({ status: "done" });
    await enqueue(db, { type: "categorise_batch", householdId: h.householdId, payload: {} });
    const result = await runOnce(db, makeHandlers(() => down));
    expect(result?.outcome).toBe("retry");
    expect((await tx(db, id)).status).toBe("unconfirmed");
    expect((await tx(db, id)).categoryId).toBeNull();
  });

  it("only offers the mock until the Claude provider exists", () => {
    expect(getAiProvider().name).toBe("mock");
    process.env.AI_PROVIDER = "claude";
    try {
      expect(() => getAiProvider()).toThrow(/isn’t available yet/);
    } finally {
      delete process.env.AI_PROVIDER;
    }
  });
});

describe("shared merchant list (BUILD_PLAN R3)", () => {
  it("adds businesses found by web lookup from card payments, never transfers or payments to people", async () => {
    const h = await engineHousehold(db, ["current"]);
    await addTx(db, h, { date: "2026-03-01", amount: -2_000, description: "FRESHWAYS SUPERMARKET" });
    await addTx(db, h, { date: "2026-03-02", amount: -5_000, description: "J COHEN FASTER PAYMENT" });
    await addTx(db, h, { date: "2026-03-03", amount: -5_000, description: "גמ״ח כלי קודש SO" });
    await addTx(db, h, { date: "2026-03-04", amount: 210_000, description: "ACME HOLDINGS PAYROLL" });
    await run(db, h, "2026-03-05");
    const names = (await db.select().from(merchants)).flatMap((m) => m.matchPatterns);
    expect(names).toContain("freshways supermarket");
    expect(names.some((n) => n.includes("cohen") || n.includes("גמ") || n.includes("acme"))).toBe(false);
  });

  it("keeps a household's own answers out of the shared list", async () => {
    const h = await engineHousehold(db, ["current"]);
    const before = (await db.select().from(merchants)).length;
    await db.insert(householdMerchants).values({ id: "hm-test", householdId: h.householdId, name: "our cleaner", categoryId: h.cat("Household"), confirmed: true, createdAt: "x", updatedAt: "x" });
    await addTx(db, h, { date: "2026-03-01", amount: -4_000, description: "OUR CLEANER" });
    await run(db, h, "2026-03-05");
    expect((await db.select().from(merchants)).length).toBe(before);
    expect((await db.select().from(householdMerchants).where(eq(householdMerchants.id, "hm-test")))[0]?.confirmed).toBe(true);
  });
});

describe("AI result keys", () => {
  it("only accepts the exact keys it sent", async () => {
    const h = await engineHousehold(db, ["current"]);
    const id = await addTx(db, h, { date: "2026-03-01", amount: -1_000, description: "SEFORIM CENTRE" });
    const provider = new MockAiProvider();
    provider.lookupMerchant = async () => ({ isBusiness: false, canonicalName: "x", suggestedCategory: null });
    provider.categoriseMerchants = async () => ({ results: [{ key: "m00", category: "Groceries", confidence: 99 }] });
    await run(db, h, "2026-03-02", provider);
    expect((await tx(db, id)).categoryId).toBeNull();
  });
});
