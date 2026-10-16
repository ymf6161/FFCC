import { eq } from "drizzle-orm";
import { MockAiProvider } from "@/ai";
import type { Db } from "@/db";
import { accounts, maaserSettings, transactions } from "@/db/schema";
import { ensureSystemCategories } from "@/engine/categories";
import { runEngine } from "@/engine/run";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { makeHousehold } from "../helpers";

type AccountType = "current" | "savings" | "credit_card" | "cash_wallet";

/** A household with system categories, the given accounts (opening 0 on 31 Dec 2025) and optionally a ma'aser rate. */
export async function engineHousehold(db: Db, types: AccountType[] = ["current"], { maaserBp }: { maaserBp?: number } = {}) {
  const h = await makeHousehold(db, types);
  const cats = await ensureSystemCategories(db, h.householdId, h.actor);
  const cat = (name: string) => cats.find((c) => c.name === name)!.id;
  if (maaserBp !== undefined) {
    await db.insert(maaserSettings).values({ id: newId(), householdId: h.householdId, percentageBp: maaserBp, effectiveFrom: "2025-01-01", createdAt: nowIso() });
  }
  const account = (i: number) => h.accountIds[i]!;
  return { ...h, cat, account };
}

export type H = Awaited<ReturnType<typeof engineHousehold>>;

/** Inserts a bank row directly (test set-up only). */
export async function addTx(
  db: Db,
  h: H,
  row: { account?: number; date: string; amount: number; description: string } & Partial<typeof transactions.$inferInsert>,
): Promise<string> {
  const now = nowIso();
  const id = newId();
  const { account = 0, description, ...rest } = row;
  await db.insert(transactions).values({
    id,
    householdId: h.householdId,
    accountId: h.account(account),
    rawDescription: description,
    source: "csv",
    dedupeKey: `test|${id}`,
    createdAt: now,
    updatedAt: now,
    ...rest,
  });
  return id;
}

export const tx = async (db: Db, id: string) => (await db.select().from(transactions).where(eq(transactions.id, id)))[0]!;

export const run = (db: Db, h: H, today = "2026-06-30", provider = new MockAiProvider()) => runEngine(db, h.householdId, { today, provider, actor: h.actor });

export async function setAccountType(db: Db, id: string, type: "loan" | "mortgage") {
  await db.update(accounts).set({ type }).where(eq(accounts.id, id));
}
