import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { auditLog, questions, transactions } from "@/db/schema";
import type { Mapping } from "@/import/mapping";
import { runImport } from "@/import/pipeline";
import { createTestDb } from "../helpers";
import { engineHousehold, run } from "./helpers";

/** Rule 10: importing the same data twice creates nothing new; sorting it twice changes nothing. */
let db: Db;
let cleanup: () => void;
beforeAll(async () => ({ db, cleanup } = await createTestDb()));
afterAll(() => cleanup());

const MAPPING: Mapping = { headerRow: 0, dateColumn: "Date", dateFormat: "dd/mm/yyyy", amountColumn: "Amount", signConvention: "money_in_positive", descriptionColumns: ["Description"] };
const CSV = "Date,Description,Amount\n01/03/2026,תרומה לקופת צדקה,-50.00\n02/03/2026,מכולת השכונה,-23.40\n02/03/2026,מכולת השכונה,-23.40\n03/03/2026,פיצה ירושלים,-18.00\n";

describe("rule 10: idempotent imports and sorting", () => {
  it("re-importing Hebrew rows and re-running the engine adds and changes nothing", async () => {
    const h = await engineHousehold(db, ["current"], { maaserBp: 1000 });
    const imp = () => runImport(db, { householdId: h.householdId, accountId: h.account(0), fileName: "a.csv", csvText: CSV, mapping: MAPPING, profileName: "Test", actor: h.actor });
    await imp();
    await run(db, h);
    const counts = async () => ({
      rows: (await db.select({ n: count() }).from(transactions).where(eq(transactions.householdId, h.householdId)))[0]!.n,
      questions: (await db.select({ n: count() }).from(questions).where(eq(questions.householdId, h.householdId)))[0]!.n,
    });
    const before = await counts();
    const second = await imp();
    expect(second.counts).toMatchObject({ new: 0, duplicate: 4 });
    const auditBefore = (await db.select({ n: count() }).from(auditLog).where(eq(auditLog.householdId, h.householdId)))[0]!.n;
    const summary = await run(db, h);
    expect(summary).toMatchObject({ rowsChanged: 0, questionsOpened: 0, pairsCreated: 0, refundsLinked: 0 });
    expect(await counts()).toEqual(before);
    expect((await db.select({ n: count() }).from(auditLog).where(eq(auditLog.householdId, h.householdId)))[0]!.n).toBe(auditBefore);
  });
});
