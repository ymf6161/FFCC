import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { auditLog, transactions } from "@/db/schema";
import { sweepCashWallets } from "@/engine/cash";
import { accountBalances } from "@/engine/totals";
import { createTestDb } from "../helpers";
import { addTx, engineHousehold, run } from "./helpers";

/** Rule 8: cash is a wallet; at month end all unnoted cash becomes one "General cash spending" transaction. */
let db: Db;
let cleanup: () => void;
beforeAll(async () => ({ db, cleanup } = await createTestDb()));
afterAll(() => cleanup());

const sweeps = (householdId: string) =>
  db
    .select()
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), eq(transactions.source, "system"), isNull(transactions.deletedAt)))
    .then((rows) => rows.filter((r) => r.dedupeKey.startsWith("cash-sweep:")));

async function withdrawal(h: Awaited<ReturnType<typeof engineHousehold>>, date: string, pence: number) {
  await addTx(db, h, { account: 0, date, amount: -pence, description: "CASH HIGH STREET ATM" });
  await addTx(db, h, { account: 1, date, amount: pence, description: "CASH WITHDRAWAL" });
}

describe("rule 8: cash wallet", () => {
  it("sweeps all unnoted cash at month end and resets the wallet to zero; the current month is left alone", async () => {
    const h = await engineHousehold(db, ["current", "cash_wallet"]);
    await withdrawal(h, "2026-01-07", 10_000);
    await addTx(db, h, { account: 1, date: "2026-01-09", amount: -4_000, description: "מונית taxi", source: "cash_note", categoryId: h.cat("Household"), status: "confirmed" });
    await withdrawal(h, "2026-02-03", 6_000);
    await run(db, h, "2026-02-15");
    const s = await sweeps(h.householdId);
    expect(s.map((r) => [r.date, r.amount])).toEqual([["2026-01-31", -6_000]]);
    const wallet = (await accountBalances(db, h.householdId, "2026-01-31")).find((b) => b.account.type === "cash_wallet")!;
    expect(wallet.balance).toBe(0);
  });

  it("sweeps only the difference when the family counts the cash on hand", async () => {
    const h = await engineHousehold(db, ["current", "cash_wallet"]);
    await withdrawal(h, "2026-01-07", 10_000);
    await run(db, h, "2026-01-20");
    await sweepCashWallets(db, h.householdId, { today: "2026-02-02", cashOnHand: new Map([[`${h.account(1)}:2026-01`, 3_000]]), actor: h.actor });
    expect((await sweeps(h.householdId)).map((r) => r.amount)).toEqual([-7_000]);
  });

  it("recalculates the sweep when a late note for that month arrives, with an audit entry", async () => {
    const h = await engineHousehold(db, ["current", "cash_wallet"]);
    await withdrawal(h, "2026-01-07", 10_000);
    await run(db, h, "2026-02-02");
    expect((await sweeps(h.householdId)).map((r) => r.amount)).toEqual([-10_000]);
    await addTx(db, h, { account: 1, date: "2026-01-20", amount: -2_500, description: "40 לניקיון cleaner", source: "cash_note", categoryId: h.cat("Household"), status: "confirmed" });
    await run(db, h, "2026-02-05");
    const [sweep] = await sweeps(h.householdId);
    expect(sweep!.amount).toBe(-7_500);
    const entries = await db.select().from(auditLog).where(and(eq(auditLog.entityId, sweep!.id), eq(auditLog.reason, "Recalculated the cash sweep after a late note or count")));
    expect(entries).toHaveLength(1);
  });
});
