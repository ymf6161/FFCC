/**
 * `bun run engine:report`: runs the engine (mock AI) on a temporary database
 * and prints what it did, in plain words:
 *   1. the seed household;
 *   2. the sample CSVs in fixtures/csv, each layout imported into its own account.
 * Your data/ffcc.db is never touched.
 */
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { MockAiProvider } from "@/ai";
import { insertAudited } from "@/audit";
import { createDb, type Db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { accounts, categories, householdMerchants, households, maaserLedger, maaserSettings, questions, transactions } from "@/db/schema";
import { runEngine } from "@/engine/run";
import { parseCsv } from "@/import/csv";
import { detectLayout } from "@/import/detect";
import { bankProfileMappingSchema } from "@/import/mapping";
import { runImport } from "@/import/pipeline";
import { newId } from "@/lib/ids";
import { nowIso, ukDate } from "@/lib/time";
import { formatMoney } from "@/money";
import { seedDatabase } from "@/seed";

const today = ukDate();
const dir = mkdtempSync(path.join(tmpdir(), "ffcc-report-"));
const db = await createDb(`file:${path.join(dir, "report.db")}`);
await runMigrations(db);
const actor = { type: "system" as const, id: "report" };
const gbp = (p: number) => formatMoney(p);

async function describe(db: Db, householdId: string, title: string, { listPairs }: { listPairs: boolean }) {
  const rows = await db.select().from(transactions).where(and(eq(transactions.householdId, householdId), isNull(transactions.deletedAt)));
  const accts = new Map((await db.select().from(accounts).where(eq(accounts.householdId, householdId))).map((a) => [a.id, a]));
  const cats = new Map((await db.select().from(categories).where(eq(categories.householdId, householdId))).map((c) => [c.id, c]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const bank = rows.filter((r) => r.source !== "system");
  const posted = rows.filter((r) => r.source === "system");
  const qs = await db.select().from(questions).where(and(eq(questions.householdId, householdId), inArray(questions.status, ["open", "sent"])));
  const hms = new Map((await db.select().from(householdMerchants).where(eq(householdMerchants.householdId, householdId))).map((h) => [h.id, h]));
  const owed = (await db.select().from(maaserLedger).where(and(eq(maaserLedger.householdId, householdId), isNull(maaserLedger.deletedAt))));

  console.log(`\n## ${title}\n`);
  const count = (s: string) => bank.filter((r) => r.status === s).length;
  console.log(`Bank rows: ${bank.length}. Sorted automatically: ${count("auto")}. Not sure (waiting on a question): ${count("unconfirmed")}. Confirmed by the family: ${count("confirmed")}.`);
  console.log(`Rows the engine posted itself: ${posted.length} (${posted.filter((p) => p.dedupeKey.startsWith("cash-sweep:")).length} month-end cash sweeps, ${posted.filter((p) => p.dedupeKey.startsWith("system:cash:")).length} cash wallet sides).`);

  console.log(`\nQuestions waiting: ${qs.length}`);
  for (const q of qs) {
    const subject =
      q.subjectType === "household_merchant"
        ? `merchant “${hms.get(q.subjectId)?.name}” (${bank.filter((r) => r.merchant && hms.get(q.subjectId)?.name && r.merchant.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() === hms.get(q.subjectId)?.name).length} rows)`
        : q.subjectType === "transaction"
          ? `“${byId.get(q.subjectId)?.rawDescription}” ${gbp(byId.get(q.subjectId)?.amount ?? 0)} on ${byId.get(q.subjectId)?.date}`
          : `transfer pair ${q.subjectId}`;
    console.log(`- ${q.type}: ${subject}; options: ${q.options.map((o) => o.label).join(" / ")}`);
  }

  const groups = new Map<string, typeof rows>();
  for (const r of rows) if (r.transferGroupId) groups.set(r.transferGroupId, [...(groups.get(r.transferGroupId) ?? []), r]);
  const byCat = new Map<string, number>();
  for (const sides of groups.values()) {
    const name = cats.get(sides[0]!.categoryId ?? "")?.name ?? "?";
    byCat.set(name, (byCat.get(name) ?? 0) + 1);
  }
  console.log(`\nTransfer pairs: ${groups.size} (${[...byCat].map(([k, v]) => `${v} ${k.toLowerCase()}`).join(", ")})`);
  if (listPairs) {
    for (const sides of groups.values()) {
      const out = sides.find((s) => s.amount < 0)!;
      const into = sides.find((s) => s.amount > 0)!;
      console.log(`- ${out.date}: ${gbp(into.amount)} from ${accts.get(out.accountId)?.name} (“${out.rawDescription}”) to ${accts.get(into.accountId)?.name} (“${into.rawDescription}”)${out.status === "unconfirmed" ? " (not sure, asked)" : ""}`);
    }
  }
  const unpaired = bank.filter((r) => !r.transferGroupId && cats.get(r.categoryId ?? "")?.kind === "transfer");
  console.log(`Unpaired transfers: ${unpaired.length}${unpaired.length ? `: ${unpaired.map((u) => `“${u.rawDescription}” ${gbp(u.amount)} on ${u.date}`).join("; ")}` : ""}`);

  const refunds = rows.filter((r) => r.refundOfId);
  console.log(`\nRefunds linked to their purchase: ${refunds.length}`);
  for (const r of refunds) {
    const p = byId.get(r.refundOfId!)!;
    console.log(`- ${r.date}: “${r.rawDescription}” ${gbp(r.amount)} refunds ${p.date} ${gbp(p.amount)} (${cats.get(r.categoryId ?? "")?.name})${r.status === "unconfirmed" ? " (several purchases fit: asked which)" : ""}`);
  }

  const accrued = owed.filter((e) => e.kind === "accrual").reduce((s, e) => s + e.amount, 0);
  const given = owed.filter((e) => e.kind === "reduction").reduce((s, e) => s + e.amount, 0);
  const total = owed.reduce((s, e) => s + e.amount, 0);
  console.log(`\nMa’aser: ${gbp(accrued)} accrued on income, ${gbp(-given)} given to charity: ${total >= 0 ? `${gbp(total)} owed` : `ahead by ${gbp(-total)}`}.`);
}

// 1. The seed household.
const seeded = await seedDatabase(db, { endDate: today });
const seedSummary = await runEngine(db, seeded.householdId, { today, provider: new MockAiProvider() });
await describe(db, seeded.householdId, `Seed household (${seeded.startDate} to ${seeded.endDate})`, { listPairs: false });
console.log(`(AI calls: ${seedSummary.aiCalls}; merchants added to the shared list: ${seedSummary.sharedMerchantsAdded}.)`);

// 2. The sample CSVs, each layout in its own account, in a new household with ma'aser at 10%.
const now = nowIso();
const householdId = newId();
await insertAudited(db, households, { id: householdId, name: "Sample CSV household", createdAt: now, updatedAt: now }, { actor, reason: "Report" });
await insertAudited(db, maaserSettings, { id: newId(), householdId, percentageBp: 1000, effectiveFrom: "2026-01-01", createdAt: now }, { actor, reason: "Report" });
const layouts = [
  { name: "Barclays-style current", type: "current" as const, files: ["barclays-style-current-2026-01-to-03.csv", "barclays-style-current-2026-03-to-05.csv"] },
  { name: "Nationwide-style joint", type: "current" as const, files: ["nationwide-style-joint-2026-01-to-03.csv", "nationwide-style-joint-2026-02-to-04.csv"] },
  { name: "Monzo-style current", type: "current" as const, files: ["monzo-style-current-2026-02-to-03.csv", "monzo-style-current-2026-03-to-04.csv"] },
  { name: "Amex-style card", type: "credit_card" as const, files: ["amex-style-card-2026-01-to-03.csv"] },
];
for (const layout of layouts) {
  const account = await insertAudited(
    db,
    accounts,
    { id: newId(), householdId, type: layout.type, name: layout.name, openingBalanceDate: "1900-01-01", isLiquid: layout.type !== "credit_card", createdAt: now, updatedAt: now },
    { actor, reason: "Report" },
  );
  for (const file of layout.files) {
    const csvText = readFileSync(`fixtures/csv/${file}`, "utf8");
    const mapping = bankProfileMappingSchema.parse(detectLayout(parseCsv(csvText), []).mapping);
    await runImport(db, { householdId, accountId: account.id, fileName: file, csvText, mapping, profileName: layout.name, actor });
  }
}
const sampleSummary = await runEngine(db, householdId, { today, provider: new MockAiProvider() });
await describe(db, householdId, "Sample CSVs (fixtures/csv, January to May 2026)", { listPairs: true });
console.log(`(AI calls: ${sampleSummary.aiCalls}; merchants added to the shared list: ${sampleSummary.sharedMerchantsAdded}.)`);

db.$client.close();
rmSync(dir, { recursive: true, force: true });
