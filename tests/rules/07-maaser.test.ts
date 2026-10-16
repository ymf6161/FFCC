import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { maaserLedger, maaserSettings, questions } from "@/db/schema";
import { maaserOwed } from "@/engine/totals";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { createTestDb } from "../helpers";
import { addTx, engineHousehold, run, tx } from "./helpers";

/** Rule 7: ma'aser accrues on net income received and reduces on charity payments. */
let db: Db;
let cleanup: () => void;
beforeAll(async () => ({ db, cleanup } = await createTestDb()));
afterAll(() => cleanup());

const live = (householdId: string) => db.select().from(maaserLedger).where(and(eq(maaserLedger.householdId, householdId), isNull(maaserLedger.deletedAt)));

describe("rule 7: ma'aser", () => {
  it("accrues the household's percentage of net income and reduces by the full charity payment (Hebrew)", async () => {
    const h = await engineHousehold(db, ["current"], { maaserBp: 1000 });
    await addTx(db, h, { date: "2026-03-25", amount: 385_000, description: "משכורת ACME HOLDINGS SALARY" });
    await addTx(db, h, { date: "2026-03-26", amount: -15_000, description: "תרומה לקופת צדקה" });
    await run(db, h);
    expect(await maaserOwed(db, h.householdId)).toBe(38_500 - 15_000);
  });

  it("applies a changed percentage only from its date, never rewriting earlier entries", async () => {
    const h = await engineHousehold(db, ["current"], { maaserBp: 1000 });
    await addTx(db, h, { date: "2026-03-25", amount: 100_000, description: "ACME HOLDINGS SALARY" });
    await run(db, h);
    await db.insert(maaserSettings).values({ id: newId(), householdId: h.householdId, percentageBp: 2000, effectiveFrom: "2026-04-01", createdAt: nowIso() });
    await addTx(db, h, { date: "2026-04-25", amount: 100_000, description: "ACME HOLDINGS SALARY" });
    await run(db, h);
    const entries = await live(h.householdId);
    expect(entries.map((e) => [e.date, e.amount]).sort()).toEqual([["2026-03-25", 10_000], ["2026-04-25", 20_000]]);
  });

  it("lets ma'aser owed go below zero when the family gives more (ahead)", async () => {
    const h = await engineHousehold(db, ["current"], { maaserBp: 1000 });
    await addTx(db, h, { date: "2026-03-25", amount: 100_000, description: "ACME HOLDINGS SALARY" });
    await addTx(db, h, { date: "2026-03-26", amount: -25_000, description: "גמ״ח כלי קודש" });
    await run(db, h);
    expect(await maaserOwed(db, h.householdId)).toBe(-15_000);
  });

  it("asks Y/N about an ambiguous charity payment instead of assuming (Hebrew payee)", async () => {
    const h = await engineHousehold(db, ["current"], { maaserBp: 1000 });
    const id = await addTx(db, h, { date: "2026-03-20", amount: -10_000, description: "קרן ידידים" });
    await run(db, h);
    expect((await tx(db, id)).status).toBe("unconfirmed");
    const [q] = await db.select().from(questions).where(and(eq(questions.householdId, h.householdId), eq(questions.type, "maaser")));
    expect(q?.options.map((o) => o.key)).toEqual(["yes", "no"]);
    expect(q?.subjectType).toBe("household_merchant");
  });

  it("keeps manual adjustments (opening balance, gross top-ups) through rebuilds", async () => {
    const h = await engineHousehold(db, ["current"], { maaserBp: 1000 });
    await db.insert(maaserLedger).values({ id: newId(), householdId: h.householdId, date: "2026-01-01", kind: "adjustment", amount: 50_000, origin: "manual", note: "יתרת פתיחה", createdAt: nowIso() });
    await addTx(db, h, { date: "2026-03-25", amount: 100_000, description: "ACME HOLDINGS SALARY" });
    await run(db, h);
    await run(db, h);
    expect(await maaserOwed(db, h.householdId)).toBe(60_000);
  });
});
