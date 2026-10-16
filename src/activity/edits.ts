import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  type Actor,
  insertAudited,
  linkAudited,
  unlinkAudited,
  updateAudited,
  updateBatchAudited,
} from "@/audit";
import type { Db, Executor } from "@/db";
import {
  categories,
  events,
  householdMerchants,
  persons,
  questions,
  rules,
  tags,
  transactionEvents,
  transactionPersons,
  transactionSplits,
  transactionTags,
  transactions,
} from "@/db/schema";
import { rebuildLedgers } from "@/engine/ledgers";
import { merchantKey, normaliseMerchant } from "@/engine/merchant";
import { loadSplits, setSplits, type SplitInput } from "@/engine/splits";
import { newId } from "@/lib/ids";
import { nowIso, ukDate } from "@/lib/time";

/**
 * Changes the family makes in Activity (BUILD_PLAN Phase 4). Every change is
 * audited, scoped to the household, and marks the transaction as confirmed:
 * the engine never changes a confirmed row again. Ledgers are rebuilt from
 * the transaction's date so ma'aser and reserves follow straight away.
 */

async function loadTx(ex: Executor, householdId: string, id: string) {
  const [tx] = await ex
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.householdId, householdId), isNull(transactions.deletedAt)));
  if (!tx) throw new Error("That transaction doesn’t exist in this household.");
  return tx;
}

async function loadCategory(ex: Executor, householdId: string, id: string) {
  const [cat] = await ex.select().from(categories).where(and(eq(categories.id, id), eq(categories.householdId, householdId), isNull(categories.deletedAt)));
  if (!cat) throw new Error("That category doesn’t exist in this household.");
  return cat;
}

type Tx = typeof transactions.$inferSelect;
type Cat = typeof categories.$inferSelect;

/**
 * What a family edit may do to a row, so totals keep rules 3 and 4: rows FFCC
 * added itself aren't edited here; a paired transfer stays a transfer; a
 * refund stays in an expense category (it reduces what it refunds).
 */
export function categoryAllowed(row: Pick<Tx, "source" | "transferGroupId" | "refundOfId">, cat: Pick<Cat, "kind">): string | null {
  if (row.source === "system") return "FFCC added this entry itself, so it can’t be changed here.";
  if (row.transferGroupId && cat.kind !== "transfer") return "This is one side of a transfer between your accounts, so it stays in a transfer category.";
  if (row.refundOfId && cat.kind !== "expense") return "This is a refund, so it goes in a spending category, like the purchase it refunds.";
  return null;
}

export type CategoryChange = {
  merchant: string | null;
  categoryName: string;
  /** True when no enabled rule already files this merchant in this category. */
  offerRule: boolean;
};

/** The family puts a payment in a category: confirmed, audited, ledgers follow. */
export async function setCategory(
  db: Db,
  { householdId, transactionId, categoryId, actor }: { householdId: string; transactionId: string; categoryId: string; actor: Actor },
): Promise<CategoryChange> {
  return db.transaction(async (tx) => {
    const row = await loadTx(tx, householdId, transactionId);
    const cat = await loadCategory(tx, householdId, categoryId);
    const refused = categoryAllowed(row, cat);
    if (refused) throw new Error(refused);
    const now = nowIso();
    const ctx = { actor, reason: "Changed the category" };
    // A single category replaces any split.
    const existing = await loadSplits(tx, householdId, [transactionId]);
    if (existing.length > 0) await updateBatchAudited(tx, transactionSplits, { householdId, ids: existing.map((s) => s.id) }, { deletedAt: now, updatedAt: now }, ctx);
    await updateAudited(tx, transactions, { id: transactionId, householdId }, { categoryId, status: "confirmed", confidence: 100, updatedAt: now }, ctx);
    // Refunds of this purchase follow its category unless the family set them
    // themselves, and only into spending (a refund is never income, rule 4).
    const refunds =
      cat.kind === "expense"
        ? await tx
            .select()
            .from(transactions)
            .where(and(eq(transactions.householdId, householdId), eq(transactions.refundOfId, transactionId), isNull(transactions.deletedAt)))
        : [];
    for (const r of refunds.filter((r) => r.status !== "confirmed")) {
      await updateAudited(tx, transactions, { id: r.id, householdId }, { categoryId, updatedAt: now }, { actor, reason: "Follows the category of the purchase it refunds" });
    }
    await rebuildLedgers(tx, householdId, { fromDate: row.date, today: ukDate(), actor });

    const merchant = row.merchant ?? normaliseMerchant(row.rawDescription);
    const key = merchantKey(merchant);
    const sameRule = (await tx.select().from(rules).where(and(eq(rules.householdId, householdId), eq(rules.enabled, true)))).find(
      (r) => r.conditions.merchant && merchantKey(r.conditions.merchant) === key && r.actions.categoryId === categoryId,
    );
    return { merchant, categoryName: cat.name, offerRule: Boolean(key) && !sameRule };
  });
}

/** "Looks right": confirms the engine's choice as it is. */
export async function confirmTransaction(db: Db, { householdId, transactionId, actor }: { householdId: string; transactionId: string; actor: Actor }) {
  await db.transaction(async (tx) => {
    const row = await loadTx(tx, householdId, transactionId);
    if (row.status === "confirmed") return;
    await updateAudited(tx, transactions, { id: transactionId, householdId }, { status: "confirmed", updatedAt: nowIso() }, { actor, reason: "Confirmed as it is" });
  });
}

export type RuleResult = {
  ruleId: string;
  merchant: string;
  categoryId: string;
  categoryName: string;
  questionsAnswered: number;
  /** The merchant's other payments the rule could still change (not confirmed, filed elsewhere). */
  candidateIds: string[];
};

/**
 * "Always do this for [merchant]?" (BUILD_PLAN workflow 4): creates a rule
 * from a correction, confirms the household's mapping for the merchant, and
 * closes open questions about it. Run the engine afterwards to apply the rule
 * to the merchant's other unconfirmed payments.
 */
export async function createRuleFromCorrection(
  db: Db,
  { householdId, transactionId, actor }: { householdId: string; transactionId: string; actor: Actor },
): Promise<RuleResult> {
  return db.transaction(async (tx) => {
    const row = await loadTx(tx, householdId, transactionId);
    if (!row.categoryId) throw new Error("Choose a category first.");
    const cat = await loadCategory(tx, householdId, row.categoryId);
    const merchant = row.merchant ?? normaliseMerchant(row.rawDescription);
    const key = merchantKey(merchant);
    if (!key) throw new Error("This payment has no merchant name to make a rule from.");
    const now = nowIso();
    const ctx = { actor, reason: `Always file ${merchant} as ${cat.name}` };
    const candidateIds = (
      await tx
        .select({ id: transactions.id, merchant: transactions.merchant, raw: transactions.rawDescription, categoryId: transactions.categoryId })
        .from(transactions)
        .where(and(eq(transactions.householdId, householdId), isNull(transactions.deletedAt), inArray(transactions.status, ["auto", "unconfirmed"])))
    )
      .filter((t) => t.id !== transactionId && t.categoryId !== cat.id && merchantKey(t.merchant ?? normaliseMerchant(t.raw)) === key)
      .map((t) => t.id);

    // An older rule for the same merchant that points elsewhere is turned off, not deleted.
    const older = (await tx.select().from(rules).where(and(eq(rules.householdId, householdId), eq(rules.enabled, true)))).filter(
      (r) => r.conditions.merchant && merchantKey(r.conditions.merchant) === key,
    );
    for (const r of older) {
      if (r.actions.categoryId === cat.id) return { ruleId: r.id, merchant, categoryId: cat.id, categoryName: cat.name, questionsAnswered: 0, candidateIds };
      await updateAudited(tx, rules, { id: r.id, householdId }, { enabled: false, updatedAt: now }, { actor, reason: "Replaced by a newer rule for the same merchant" });
    }
    const rule = await insertAudited(
      tx,
      rules,
      { id: newId(), householdId, conditions: { merchant: key }, actions: { categoryId: cat.id }, priority: 100, origin: "correction", enabled: true, createdAt: now, updatedAt: now },
      ctx,
    );

    const [hm] = await tx.select().from(householdMerchants).where(and(eq(householdMerchants.householdId, householdId), eq(householdMerchants.name, key)));
    const hmId = hm
      ? (await updateAudited(tx, householdMerchants, { id: hm.id, householdId }, { categoryId: cat.id, confirmed: true, updatedAt: now }, ctx)).id
      : (await insertAudited(tx, householdMerchants, { id: newId(), householdId, name: key, categoryId: cat.id, confirmed: true, createdAt: now, updatedAt: now }, ctx)).id;

    // The correction answers any open category or ma'aser question about this merchant.
    const open = await tx
      .select()
      .from(questions)
      .where(and(eq(questions.householdId, householdId), eq(questions.subjectType, "household_merchant"), eq(questions.subjectId, hmId), inArray(questions.status, ["open", "sent"])));
    for (const q of open) {
      await updateAudited(
        tx,
        questions,
        { id: q.id, householdId },
        { status: "answered", answer: q.type === "maaser" ? (cat.maaserEffect === "reduce" ? "yes" : "no") : cat.id, answeredBy: actor.type === "user" ? actor.id : null, channel: "in_app", answeredAt: now, updatedAt: now },
        { actor, reason: "Answered by a correction in Activity" },
      );
    }
    return { ruleId: rule.id, merchant, categoryId: cat.id, categoryName: cat.name, questionsAnswered: open.length, candidateIds };
  });
}

/** How many of the given payments are now filed in the category (after the engine applied a new rule). */
export async function countFiledAs(ex: Executor, householdId: string, ids: string[], categoryId: string): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await ex
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), inArray(transactions.id, ids), eq(transactions.categoryId, categoryId), isNull(transactions.deletedAt)));
  return rows.length;
}

/** Splits a payment across categories; the lines must add up exactly. */
export async function saveSplits(
  db: Db,
  { householdId, transactionId, lines, actor }: { householdId: string; transactionId: string; lines: SplitInput[]; actor: Actor },
) {
  await db.transaction(async (tx) => {
    const row = await loadTx(tx, householdId, transactionId);
    if (row.source === "system") throw new Error("FFCC added this entry itself, so it can’t be changed here.");
    if (row.transferGroupId) throw new Error("A transfer between your accounts can’t be split.");
    for (const line of lines) {
      if (!line.categoryId) continue;
      const cat = await loadCategory(tx, householdId, line.categoryId);
      if (cat.kind === "transfer") throw new Error("Split lines go in spending or income categories, not transfers.");
      const refused = categoryAllowed(row, cat);
      if (refused) throw new Error(refused);
    }
    if (lines.length > 0 && lines.reduce((s, l) => s + l.amount, 0) !== row.amount) throw new Error("The lines need to add up to the payment.");
    const ctx = { actor, reason: lines.length ? "Split the payment" : "Removed the split" };
    await setSplits(tx, { householdId, transactionId }, lines, ctx);
    await updateAudited(tx, transactions, { id: transactionId, householdId }, { status: "confirmed", updatedAt: nowIso() }, ctx);
    await rebuildLedgers(tx, householdId, { fromDate: row.date, today: ukDate(), actor });
  });
}

export async function setNotes(db: Db, { householdId, transactionId, notes, actor }: { householdId: string; transactionId: string; notes: string; actor: Actor }) {
  await db.transaction(async (tx) => {
    await loadTx(tx, householdId, transactionId);
    await updateAudited(tx, transactions, { id: transactionId, householdId }, { notes: notes.trim() || null, updatedAt: nowIso() }, { actor, reason: "Changed the note" });
  });
}

/** Tags, events and people: entered by the family only, never inferred (CLAUDE.md). */
export type DetailKind = "tag" | "event" | "person";

const DETAIL = {
  tag: { table: tags, link: transactionTags, column: transactionTags.tagId, field: "tagId" as const },
  event: { table: events, link: transactionEvents, column: transactionEvents.eventId, field: "eventId" as const },
  person: { table: persons, link: transactionPersons, column: transactionPersons.personId, field: "personId" as const },
};

/** Finds a tag, event or person by name (as typed), or creates it. */
export async function findOrCreateDetail(ex: Executor, { householdId, kind, name, actor }: { householdId: string; kind: DetailKind; name: string; actor: Actor }) {
  const clean = name.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!clean) throw new Error("Give it a name.");
  const { table } = DETAIL[kind];
  const [existing] = await ex.select().from(table).where(and(eq(table.householdId, householdId), eq(table.name, clean)));
  if (existing) return existing;
  const now = nowIso();
  return insertAudited(ex, table, { id: newId(), householdId, name: clean, createdAt: now, updatedAt: now }, { actor, reason: `Added a ${kind}` });
}

/** Adds a tag, event or person to one or many of the household's transactions. Returns how many were added. */
export async function addDetail(
  db: Db,
  { householdId, kind, name, transactionIds, actor }: { householdId: string; kind: DetailKind; name: string; transactionIds: string[]; actor: Actor },
): Promise<number> {
  return db.transaction(async (tx) => {
    const detail = await findOrCreateDetail(tx, { householdId, kind, name, actor });
    const own = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), inArray(transactions.id, transactionIds.length ? transactionIds : ["-"]), isNull(transactions.deletedAt)));
    if (own.length !== new Set(transactionIds).size) throw new Error("Some of those transactions don’t exist in this household.");
    const { link, field } = DETAIL[kind];
    const now = nowIso();
    let added = 0;
    for (const { id } of own) {
      const values = { householdId, transactionId: id, [field]: detail.id, createdAt: now } as never;
      if (await linkAudited(tx, link, values, { actor, reason: `Added ${kind} “${detail.name}”` })) added++;
    }
    return added;
  });
}

export async function removeDetail(
  db: Db,
  { householdId, kind, detailId, transactionId, actor }: { householdId: string; kind: DetailKind; detailId: string; transactionId: string; actor: Actor },
) {
  const { link, column } = DETAIL[kind];
  await unlinkAudited(db, link, { householdId, transactionId, column, value: detailId }, { actor, reason: `Removed a ${kind}` });
}
