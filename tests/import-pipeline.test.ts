import { readFileSync } from "node:fs";
import { and, asc, eq, isNull } from "drizzle-orm";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { accounts, auditLog, balanceCheckpoints, bankProfiles, importBatches, jobs, questions, transactions } from "@/db/schema";
import { parseCsv } from "@/import/csv";
import { detectLayout } from "@/import/detect";
import { accountDrift } from "@/import/drift";
import { bankProfileMappingSchema, type Mapping } from "@/import/mapping";
import { prepareImport, runImport } from "@/import/pipeline";
import { expectedRows, FIXTURE_FILES, type FixtureFile, renderFixture } from "./fixtures/csv-sources";
import { createTestDb, makeHousehold } from "./helpers";

let db: Db;
let cleanup: () => void;
beforeAll(async () => ({ db, cleanup } = await createTestDb()));
afterAll(() => cleanup());

const read = (f: FixtureFile) => readFileSync(`fixtures/csv/${f.file}`, "utf8");
const file = (name: string) => FIXTURE_FILES.find((f) => f.file.startsWith(name))!;

function mappingFor(csvText: string): Mapping {
  const detection = detectLayout(parseCsv(csvText), []);
  return bankProfileMappingSchema.parse(detection.mapping);
}

/** For plain "Date,Description,Amount" files, the mapping the family would confirm: money in positive. */
const SIGNED: Mapping = { headerRow: 0, dateColumn: "Date", dateFormat: "dd/mm/yyyy", amountColumn: "Amount", signConvention: "money_in_positive", descriptionColumns: ["Description"] };

async function importFile(
  h: { householdId: string; actor: { type: "user"; id: string } },
  accountId: string,
  f: FixtureFile | { file: string; text: string; mapping?: Mapping },
) {
  const csvText = "text" in f ? f.text : read(f);
  const mapping = ("mapping" in f && f.mapping) || mappingFor(csvText);
  return runImport(db, { householdId: h.householdId, accountId, fileName: f.file, csvText, mapping, profileName: "Test bank", actor: h.actor });
}

const stored = (accountId: string) =>
  db
    .select()
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), isNull(transactions.deletedAt)))
    .orderBy(asc(transactions.date), asc(transactions.dedupeOccurrence), asc(transactions.createdAt));

describe("the sample files", () => {
  it.each(FIXTURE_FILES.map((f) => [f.file, f]))("%s matches its generator", (_, f) => {
    expect(read(f)).toBe(renderFixture(f));
  });

  it.each([
    ["barclays-style", "Barclays-style CSV"],
    ["nationwide-style", "Nationwide-style CSV"],
    ["monzo-style", "Monzo-style CSV"],
    ["amex-style", "Amex-style card CSV"],
  ])("recognises the %s layout", (prefix, name) => {
    expect(detectLayout(parseCsv(read(file(prefix))), []).recognisedAs).toBe(name);
  });
});

describe("importing each bank format (done when: three formats import correctly)", () => {
  it.each(FIXTURE_FILES.map((f) => [f.file, f]))("%s stores exactly the rows in the file", async (_, f) => {
    const h = await makeHousehold(db);
    const accountId = h.accountIds[0]!;
    const result = await importFile(h, accountId, f);
    const expected = expectedRows(f);
    expect(result.counts).toMatchObject({ new: expected.length, duplicate: 0, nearDuplicate: 0, error: 0 });

    const rows = await stored(accountId);
    // Compare as multisets (same-day order is not significant).
    const key = (r: { date: string; amount: number; description: string }) => `${r.date}|${r.amount}|${r.description}`;
    expect(rows.map((r) => key({ date: r.date, amount: r.amount, description: r.rawDescription })).sort()).toEqual(expected.map(key).sort());
    expect(rows.every((r) => r.source === "csv" && r.bookingStatus === "booked" && r.status === "unconfirmed")).toBe(true);
    if (f.account === "monzo") expect(rows.map((r) => r.externalId).sort()).toEqual(expected.map((e) => e.externalId).sort());
    // Hebrew survives the round trip.
    expect(rows.some((r) => /[֐-׿]/.test(r.rawDescription))).toBe(true);
  });
});

describe("duplicates (done when: same file twice adds nothing; identical same-day rows import once)", () => {
  it("importing the same file twice adds nothing, including bank balances", async () => {
    const h = await makeHousehold(db);
    const accountId = h.accountIds[0]!;
    const f = file("nationwide-style-joint-2026-01");
    const first = await importFile(h, accountId, f);
    const countAfterFirst = (await stored(accountId)).length;
    const checkpointsAfterFirst = await db.select().from(balanceCheckpoints).where(eq(balanceCheckpoints.accountId, accountId));

    const second = await importFile(h, accountId, f);
    expect(second.counts).toMatchObject({ new: 0, duplicate: first.counts.new, nearDuplicate: 0 });
    expect((await stored(accountId)).length).toBe(countAfterFirst);
    expect(await db.select().from(balanceCheckpoints).where(eq(balanceCheckpoints.accountId, accountId))).toHaveLength(checkpointsAfterFirst.length);
    // The second attempt is still recorded, as "0 new".
    const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, second.batchId));
    expect(batch).toMatchObject({ newCount: 0, duplicateCount: first.counts.new });
  });

  it("keeps two genuine identical same-day rows, once each, and a re-import adds neither", async () => {
    const h = await makeHousehold(db);
    const accountId = h.accountIds[0]!;
    await importFile(h, accountId, file("barclays-style-current-2026-01"));
    const coffees = (await stored(accountId)).filter((r) => r.date === "2026-02-10" && r.rawDescription === "COFFEE CORNER");
    expect(coffees.map((c) => c.dedupeOccurrence).sort()).toEqual([1, 2]);
    await importFile(h, accountId, file("barclays-style-current-2026-01"));
    expect((await stored(accountId)).filter((r) => r.date === "2026-02-10" && r.rawDescription === "COFFEE CORNER")).toHaveLength(2);
  });

  it.each([
    ["barclays-style-current-2026-01", "barclays-style-current-2026-03", "2026-03-12"],
    ["nationwide-style-joint-2026-01", "nationwide-style-joint-2026-02", "2026-03-04"],
    ["monzo-style-current-2026-02", "monzo-style-current-2026-03", "2026-03-17"],
  ])("overlapping files %s and %s add only the rows not already there", async (a, b, coffeeDay) => {
    const h = await makeHousehold(db);
    const accountId = h.accountIds[0]!;
    const fa = file(a);
    const fb = file(b);
    await importFile(h, accountId, fa);
    const second = await importFile(h, accountId, fb);

    const union = new Map<string, number>();
    for (const r of [...expectedRows(fa), ...expectedRows(fb)]) union.set(`${r.date}|${r.amount}|${r.description}`, 0);
    const all = [...expectedRows(fa), ...expectedRows(fb).filter((r) => r.date > fa.to)];
    expect((await stored(accountId)).length).toBe(all.length);
    expect(second.counts.duplicate).toBe(expectedRows(fb).filter((r) => r.date <= fa.to).length);
    // The two coffees in the overlap are stored once each, not four times.
    expect((await stored(accountId)).filter((r) => r.date === coffeeDay && r.amount === -320)).toHaveLength(2);
    expect(union.size).toBeGreaterThan(0);
  });

  it("matches on transaction id first, even if the description changed", async () => {
    const h = await makeHousehold(db);
    const accountId = h.accountIds[0]!;
    const header = "Transaction ID,Date,Time,Type,Name,Category,Amount,Currency,Notes,Description";
    await importFile(h, accountId, { file: "a.csv", text: `${header}\ntx_1,01/03/2026,10:00:00,Card payment,Shop,general,-5.00,GBP,,SHOP ONE\n` });
    const again = await importFile(h, accountId, { file: "b.csv", text: `${header}\ntx_1,01/03/2026,10:00:00,Card payment,Shop Renamed,general,-5.00,GBP,,SHOP ONE LTD\n` });
    expect(again.counts).toMatchObject({ new: 0, duplicate: 1 });
  });

  it("stores a near match from a different file layout and asks whether it is a duplicate", async () => {
    const h = await makeHousehold(db);
    const accountId = h.accountIds[0]!;
    await importFile(h, accountId, { file: "a.csv", text: "Date,Description,Amount\n01/03/2026,CARD PAYMENT TO FRESHWAYS,-42.10\n", mapping: SIGNED });
    // The same payment from another export of the same account: two days later, different wording, different layout.
    const other = await importFile(h, accountId, {
      file: "b.csv",
      text: "Number,Date,Account,Amount,Subcategory,Memo\n,03/03/2026,99-99-99 12345678,-42.10,Debit,FRESHWAYS SUPERMARKET\n",
    });
    expect(other.counts).toMatchObject({ new: 0, nearDuplicate: 1, duplicate: 0 });
    const rows = await stored(accountId);
    expect(rows).toHaveLength(2);
    const newer = rows.find((r) => r.rawDescription === "FRESHWAYS SUPERMARKET")!;
    const [question] = await db.select().from(questions).where(eq(questions.subjectId, newer.id));
    expect(question).toMatchObject({ type: "duplicate", status: "open", subjectType: "transaction" });
    expect(question!.options.map((o) => o.label)).toEqual(["Keep both", "It’s the same payment"]);
  });

  it("does not flag near matches within the same layout (two different shops, same amount)", async () => {
    const h = await makeHousehold(db);
    const accountId = h.accountIds[0]!;
    await importFile(h, accountId, { file: "a.csv", text: "Date,Description,Amount\n01/03/2026,SHOP A,-10.00\n", mapping: SIGNED });
    const second = await importFile(h, accountId, { file: "b.csv", text: "Date,Description,Amount\n02/03/2026,SHOP B,-10.00\n", mapping: SIGNED });
    expect(second.counts).toMatchObject({ new: 1, nearDuplicate: 0 });
  });

  it("property: importing any file twice, or in overlapping date windows, gives the same rows as once", async () => {
    const rowArb = fc.record({
      day: fc.integer({ min: 1, max: 20 }),
      amount: fc.integer({ min: -50_000, max: 50_000 }).filter((a) => a !== 0),
      description: fc.constantFrom("SHOP", "COFFEE", "צדקה", "Café", "RENT"),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(rowArb, { minLength: 1, maxLength: 25 }), fc.integer({ min: 1, max: 20 }), fc.integer({ min: 1, max: 20 }), async (raw, cutA, cutB) => {
        const rows = raw.map((r) => ({ ...r, date: `2026-04-${String(r.day).padStart(2, "0")}` })).sort((x, y) => x.date.localeCompare(y.date));
        const toCsv = (rs: typeof rows) =>
          "Date,Description,Amount\n" + rs.map((r) => `${r.date.slice(8)}/04/2026,${r.description},${(r.amount / 100).toFixed(2)}`).join("\n") + "\n";
        const [lo, hi] = [Math.min(cutA, cutB), Math.max(cutA, cutB)];
        // Window A: days 1..hi; window B: days lo..20. They overlap on whole days lo..hi.
        const windowA = rows.filter((r) => r.day <= hi);
        const windowB = rows.filter((r) => r.day >= lo);

        const h = await makeHousehold(db, ["current", "current"]);
        const [once, windows] = h.accountIds as [string, string];
        await importFile(h, once, { file: "all.csv", text: toCsv(rows), mapping: SIGNED });
        await importFile(h, once, { file: "all.csv", text: toCsv(rows), mapping: SIGNED });
        await importFile(h, windows, { file: "a.csv", text: toCsv(windowA), mapping: SIGNED });
        await importFile(h, windows, { file: "b.csv", text: toCsv(windowB), mapping: SIGNED });

        const shape = async (id: string) => (await stored(id)).map((r) => `${r.date}|${r.amount}|${r.rawDescription}`).sort();
        expect(await shape(once)).toEqual(rows.map((r) => `${r.date}|${r.amount}|${r.description}`).sort());
        expect(await shape(windows)).toEqual(await shape(once));
      }),
      { numRuns: 25 },
    );
  });
});

describe("bank balances", () => {
  it("stores end-of-day balances, sets a new account's opening balance, and matches the bank", async () => {
    const h = await makeHousehold(db);
    const accountId = h.accountIds[0]!;
    await importFile(h, accountId, file("nationwide-style-joint-2026-01"));
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    expect(account).toMatchObject({ openingBalance: 412_350, openingBalanceDate: "2026-01-01" });
    const checkpoints = await db.select().from(balanceCheckpoints).where(eq(balanceCheckpoints.accountId, accountId));
    expect(checkpoints.length).toBeGreaterThan(10);
    const lastDate = (f: FixtureFile) => expectedRows(f).at(-1)!.date;
    expect(await accountDrift(db, h.householdId, accountId)).toEqual({ status: "matches", checkedOn: lastDate(file("nationwide-style-joint-2026-01")) });

    // The overlapping second file keeps it matching.
    await importFile(h, accountId, file("nationwide-style-joint-2026-02"));
    expect(await accountDrift(db, h.householdId, accountId)).toEqual({ status: "matches", checkedOn: lastDate(file("nationwide-style-joint-2026-02")) });
  });

  it("shows the difference and when it started if a row is missing", async () => {
    const h = await makeHousehold(db);
    const accountId = h.accountIds[0]!;
    const f = file("nationwide-style-joint-2026-01");
    const lines = read(f).split("\r\n");
    const missing = lines.findIndex((l) => l.startsWith('"10 Feb 2026"'));
    expect(missing).toBeGreaterThan(0);
    const removedPence = 3_850; // the water bill on 10 Feb
    expect(lines[missing]).toContain("CLEARFLOW WATER");
    const text = lines.filter((_, i) => i !== missing).join("\r\n");
    await importFile(h, accountId, { file: f.file, text });
    // The bank's balances only show the gap from the next day that has rows (10 Feb had only this one).
    const rows = expectedRows(f);
    const nextDay = rows.find((r) => r.date > "2026-02-10")!.date;
    expect(rows.filter((r) => r.date === "2026-02-10")).toHaveLength(1);
    expect(await accountDrift(db, h.householdId, accountId)).toEqual({ status: "differs", difference: removedPence, since: nextDay, checkedOn: rows.at(-1)!.date });
  });

  it("reports no checkpoints for a file without balances", async () => {
    const h = await makeHousehold(db);
    await importFile(h, h.accountIds[0]!, file("amex-style"));
    expect(await accountDrift(db, h.householdId, h.accountIds[0]!)).toEqual({ status: "no_checkpoints" });
  });
});

describe("what an import writes", () => {
  it("saves the bank format, audits once per batch and queues sorting", async () => {
    const h = await makeHousehold(db);
    const accountId = h.accountIds[0]!;
    const result = await importFile(h, accountId, file("monzo-style-current-2026-02"));
    const profiles = await db.select().from(bankProfiles).where(eq(bankProfiles.householdId, h.householdId));
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.headerSignature).toContain("transaction id|date");

    const entries = await db.select().from(auditLog).where(eq(auditLog.importBatchId, result.batchId));
    expect(entries.filter((e) => e.entity === "transactions")).toHaveLength(1);
    expect(entries.find((e) => e.entity === "transactions")!.after).toMatchObject({ rowCount: result.counts.new });

    const queued = await db.select().from(jobs).where(eq(jobs.householdId, h.householdId));
    expect(queued.map((j) => [j.type, j.payload])).toEqual([["categorise_batch", { batchId: result.batchId }]]);

    // A second import of the same layout reuses the saved profile.
    await importFile(h, accountId, file("monzo-style-current-2026-03"));
    expect(await db.select().from(bankProfiles).where(eq(bankProfiles.householdId, h.householdId))).toHaveLength(1);
  });

  it("refuses to import into another household's account", async () => {
    const a = await makeHousehold(db);
    const b = await makeHousehold(db);
    await expect(importFile(a, b.accountIds[0]!, file("amex-style"))).rejects.toThrow(/doesn’t exist in this household/);
    expect(await stored(b.accountIds[0]!)).toHaveLength(0);
  });

  it("refuses loan and mortgage accounts, which hold no transactions", async () => {
    const h = await makeHousehold(db);
    await db.update(accounts).set({ type: "mortgage" }).where(eq(accounts.id, h.accountIds[0]!));
    await expect(importFile(h, h.accountIds[0]!, file("amex-style"))).rejects.toThrow(/can’t hold transactions/);
    expect(await stored(h.accountIds[0]!)).toHaveLength(0);
  });

  it("previews without writing anything", async () => {
    const h = await makeHousehold(db);
    const f = file("amex-style");
    const preview = await prepareImport(db, { householdId: h.householdId, accountId: h.accountIds[0]!, csvText: read(f), mapping: mappingFor(read(f)) });
    expect(preview.counts.new).toBe(expectedRows(f).length);
    expect(await stored(h.accountIds[0]!)).toHaveLength(0);
  });
});
