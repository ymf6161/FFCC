import { and, eq, isNull } from "drizzle-orm";
import { type Actor, insertAudited, updateAudited } from "@/audit";
import type { Executor } from "@/db";
import { accounts, categories, transactions } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";

/** The category a transfer pair files under, from the kinds of account on each side (rule 3). */
export function transferCategoryFor(typeA: string, typeB: string): "Credit card repayment" | "Cash withdrawal" | "Transfer" {
  if (typeA === "credit_card" || typeB === "credit_card") return "Credit card repayment";
  if (typeA === "cash_wallet" || typeB === "cash_wallet") return "Cash withdrawal";
  return "Transfer";
}

/**
 * A transfer to one of the family's own accounts that we don't import (a
 * pension, an ISA elsewhere, a child's account): confirming it creates or
 * reuses a manual account and posts the other side there automatically
 * (BUILD_PLAN rule 3, R11). The pair sums to zero and never counts as income
 * or spending.
 */
export async function confirmTransferToOwnAccount(
  ex: Executor,
  { householdId, transactionId, accountName, actor }: { householdId: string; transactionId: string; accountName: string; actor: Actor },
) {
  return (ex as typeof ex).transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), eq(transactions.householdId, householdId), isNull(transactions.deletedAt)));
    if (!row) throw new Error("That transaction doesn’t exist in this household.");
    if (row.transferGroupId) throw new Error("This payment is already paired.");
    const [transfer] = await tx
      .select()
      .from(categories)
      .where(and(eq(categories.householdId, householdId), eq(categories.name, "Transfer"), isNull(categories.deletedAt)));
    if (!transfer) throw new Error("The Transfer category is missing.");

    const now = nowIso();
    const name = accountName.trim().slice(0, 60);
    let [manual] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.householdId, householdId), eq(accounts.name, name), eq(accounts.isManual, true), isNull(accounts.deletedAt)));
    manual ??= await insertAudited(
      tx,
      accounts,
      {
        id: newId(),
        householdId,
        type: "investment",
        name,
        institution: null,
        openingBalance: 0,
        openingBalanceDate: "1900-01-01",
        isLiquid: false,
        includeInNetWorth: true,
        isManual: true,
        createdAt: now,
        updatedAt: now,
      },
      { actor, reason: "Added an account we don’t import, for a transfer" },
    );

    const groupId = newId();
    const other = await insertAudited(
      tx,
      transactions,
      {
        id: newId(),
        householdId,
        accountId: manual.id,
        date: row.date,
        amount: -row.amount,
        rawDescription: row.rawDescription,
        merchant: row.merchant,
        categoryId: transfer.id,
        source: "system",
        bookingStatus: "booked",
        dedupeKey: `system:transfer:${row.id}`,
        transferGroupId: groupId,
        status: "confirmed",
        confidence: 100,
        createdAt: now,
        updatedAt: now,
      },
      { actor, reason: "Posted the other side of a transfer to an account we don’t import" },
    );
    await updateAudited(
      tx,
      transactions,
      { id: row.id, householdId },
      { transferGroupId: groupId, categoryId: transfer.id, status: "confirmed", confidence: 100, updatedAt: now },
      { actor, reason: "Confirmed as a transfer to our own account" },
    );
    return { groupId, otherSideId: other.id, accountId: manual.id };
  });
}
