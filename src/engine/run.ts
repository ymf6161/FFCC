import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { type Actor, insertAudited, updateAudited } from "@/audit";
import {
  type AiProvider,
  buildCategoriseItem,
  categoriseResponseSchema,
  getAiProvider,
  lookupResponseSchema,
} from "@/ai";
import type { Db } from "@/db";
import { accounts, householdMerchants, merchants, questions, rules, transactions } from "@/db/schema";
import type { RuleConditions } from "@/db/schema/learning";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { sweepCashWallets } from "./cash";
import { type Category, ensureSystemCategories } from "./categories";
import { daysBetween } from "./dates";
import { rebuildLedgers } from "./ledgers";
import { hasTransferHint, lineKind, looksLikeRefund, merchantKey, normaliseMerchant } from "./merchant";
import { openQuestion, type QuestionInput } from "./questions";
import { allocateProRata, loadSplits, setSplits } from "./splits";
import { maaserOwed } from "./totals";
import { transferCategoryFor } from "./transfers";

/** At or above this confidence a category is filed automatically; below it the family is asked (BUILD_PLAN section 11). */
export const AUTO_FILE_THRESHOLD = 80;
/** A transfer with no partner after this many days becomes a question (rule 3). */
export const UNPAIRED_TRANSFER_DAYS = 10;
/** How far apart the two sides of a transfer may be. */
const PAIR_WINDOW_DAYS = 3;
/** How far back a refund may reach for its purchase. */
const REFUND_WINDOW_DAYS = 120;
const CASH_HINT = /\batm\b|cash withdrawal|cash machine/i;

type Tx = typeof transactions.$inferSelect;
type Account = typeof accounts.$inferSelect;
type Patch = Partial<Pick<Tx, "merchant" | "categoryId" | "status" | "confidence" | "transferGroupId" | "refundOfId">>;

export type EngineSummary = {
  rowsChanged: number;
  pairsCreated: number;
  cashSidesPosted: number;
  refundsLinked: number;
  questionsOpened: number;
  sharedMerchantsAdded: number;
  sweeps: number;
  aiCalls: number;
  aiFailed: boolean;
  status: { auto: number; confirmed: number; unconfirmed: number };
  maaserOwed: number;
};

const SYSTEM: Actor = { type: "system", id: "engine" };

/** Something changed the household's rows while the engine was deciding; nothing was written. */
export class EngineConflictError extends Error {
  constructor() {
    super("Transactions changed while they were being sorted; nothing was saved. Sorting will run again.");
    this.name = "EngineConflictError";
  }
}

/**
 * Sorts a household's transactions (BUILD_PLAN section 8, workflow 2):
 * merchant names → rules and confirmed merchant mappings → transfer pairs →
 * shared merchants, web lookup and AI (once per merchant) → refunds →
 * unpaired-transfer questions → cash sweep → ledgers.
 *
 * Decisions are planned in memory (the AI is called outside any database
 * transaction), then written in one audited transaction. Confirmed rows are
 * never changed. Running it again with nothing new changes nothing. If the AI
 * fails, rows that needed it stay as they were and `aiFailed` is set, so the
 * job can retry.
 */
export async function runEngine(
  db: Db,
  householdId: string,
  { today, provider = getAiProvider(), actor = SYSTEM }: { today: string; provider?: AiProvider; actor?: Actor },
): Promise<EngineSummary> {
  const cats = await db.transaction((tx) => ensureSystemCategories(tx, householdId, actor));
  const catById = new Map(cats.map((c) => [c.id, c]));
  const catByName = new Map(cats.map((c) => [c.name, c]));
  const cat = (name: string): Category => catByName.get(name)!;

  const accts = await db.select().from(accounts).where(and(eq(accounts.householdId, householdId), isNull(accounts.deletedAt)));
  const acctById = new Map(accts.map((a) => [a.id, a]));
  const original = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), isNull(transactions.deletedAt), eq(transactions.bookingStatus, "booked")))
    .orderBy(asc(transactions.date), asc(transactions.id));
  const rows = original.map((r) => ({ ...r }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const splits = await loadSplits(db, householdId);
  const ruleRows = (await db.select().from(rules).where(and(eq(rules.householdId, householdId), eq(rules.enabled, true)))).sort(
    (a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt),
  );
  const hmRows = await db.select().from(householdMerchants).where(eq(householdMerchants.householdId, householdId));
  const shared = await db.select().from(merchants);

  const editable = (r: Tx) => r.status !== "confirmed" && r.source !== "system";
  const keyOf = (r: Tx) => merchantKey(r.merchant ?? normaliseMerchant(r.rawDescription));
  const newRows: (typeof transactions.$inferInsert)[] = [];
  const newAccounts: (typeof accounts.$inferInsert)[] = [];
  const newShared: (typeof merchants.$inferInsert)[] = [];
  const newHouseholdMerchants = new Map<string, typeof householdMerchants.$inferInsert>();
  const plannedQuestions: QuestionInput[] = [];
  const plannedSplits = new Map<string, { categoryId: string | null; amount: number }[]>();
  const summary: EngineSummary = {
    rowsChanged: 0,
    pairsCreated: 0,
    cashSidesPosted: 0,
    refundsLinked: 0,
    questionsOpened: 0,
    sharedMerchantsAdded: 0,
    sweeps: 0,
    aiCalls: 0,
    aiFailed: false,
    status: { auto: 0, confirmed: 0, unconfirmed: 0 },
    maaserOwed: 0,
  };

  // 1. Merchant names.
  for (const r of rows) if (editable(r) && !r.merchant) r.merchant = normaliseMerchant(r.rawDescription);

  // 2. Strong signals: the family's rules, then their confirmed merchant mappings.
  const strong = new Set<string>();
  const confirmedMapping = new Map(hmRows.filter((h) => h.confirmed && h.categoryId).map((h) => [h.name, h.categoryId!]));
  for (const r of rows) {
    if (!editable(r) || r.transferGroupId || r.refundOfId) continue;
    const rule = ruleRows.find((rule) => ruleMatches(rule.conditions, r, keyOf(r)));
    const categoryId = rule
      ? (rule.actions.markAsTransfer ? cat("Transfer").id : rule.actions.categoryId)
      : confirmedMapping.get(keyOf(r));
    if (!categoryId || !catById.has(categoryId)) continue;
    r.categoryId = categoryId;
    r.status = "auto";
    r.confidence = rule ? 100 : 98;
    strong.add(r.id);
    if (rule?.actions.splitTemplate?.length) {
      const parts = allocateProRata(r.amount, rule.actions.splitTemplate.map((s) => s.share));
      plannedSplits.set(r.id, rule.actions.splitTemplate.map((s, i) => ({ categoryId: s.categoryId, amount: parts[i]! })));
    }
  }

  // 3. Transfer pairs between the family's own accounts.
  const pairable = (r: Tx) => {
    const account = acctById.get(r.accountId);
    if (!editable(r) || r.transferGroupId || r.refundOfId || r.amount === 0 || looksLikeRefund(r.rawDescription)) return false;
    if (!account || account.type === "loan" || account.type === "mortgage") return false;
    // Rows the family's rules file elsewhere (e.g. the mortgage) are never paired.
    if (strong.has(r.id) && catById.get(r.categoryId!)?.kind !== "transfer") return false;
    return true;
  };
  const positives = rows.filter((r) => pairable(r) && r.amount > 0);
  const used = new Set<string>();
  for (const n of rows.filter((r) => pairable(r) && r.amount < 0)) {
    const scored = positives
      .filter((p) => !used.has(p.id) && p.accountId !== n.accountId && p.amount === -n.amount && Math.abs(daysBetween(n.date, p.date)) <= PAIR_WINDOW_DAYS)
      .map((p) => ({ p, score: Math.abs(daysBetween(n.date, p.date)) * 10 - (hasTransferHint(n.rawDescription) ? 3 : 0) - (hasTransferHint(p.rawDescription) ? 3 : 0) }))
      .sort((a, b) => a.score - b.score);
    if (scored.length === 0) continue;
    const [best, second] = scored;
    if (second && second.score === best!.score) {
      // Two equally good partners: ask rather than guess.
      plannedQuestions.push({
        householdId,
        subjectType: "transaction",
        subjectId: n.id,
        type: "transfer",
        options: [
          ...scored.filter((s) => s.score === best!.score).map((s) => ({ key: `pair_with:${s.p.id}`, label: `${acctById.get(s.p.accountId)?.name ?? "Another account"} on ${s.p.date}` })),
          { key: "not_transfer", label: "It isn’t a transfer" },
        ],
      });
      continue;
    }
    const p = best!.p;
    used.add(p.id);
    used.add(n.id);
    const groupId = newId();
    const category = cat(transferCategoryFor(acctById.get(n.accountId)!.type, acctById.get(p.accountId)!.type));
    const sure = hasTransferHint(n.rawDescription) || hasTransferHint(p.rawDescription);
    for (const side of [n, p]) {
      side.transferGroupId = groupId;
      side.categoryId = category.id;
      side.status = sure ? "auto" : "unconfirmed";
      side.confidence = sure ? 95 : 70;
    }
    summary.pairsCreated++;
    if (!sure) {
      plannedQuestions.push({
        householdId,
        subjectType: "transfer_pair",
        subjectId: groupId,
        type: "transfer",
        options: [
          { key: "yes", label: "Yes, a move between our accounts" },
          { key: "no", label: "No, they aren’t linked" },
        ],
      });
    }
  }

  // 3b. Cash machine withdrawals with no wallet row yet: post the wallet side (rule 8).
  let wallet: Account | undefined = accts.find((a) => a.type === "cash_wallet");
  for (const r of rows) {
    const account = acctById.get(r.accountId);
    if (!editable(r) || r.transferGroupId || r.amount >= 0 || !account || account.type === "cash_wallet" || account.type === "credit_card") continue;
    if (!CASH_HINT.test(r.rawDescription)) continue;
    if (!wallet) {
      const now = nowIso();
      wallet = { id: newId(), householdId, type: "cash_wallet", name: "Cash wallet", institution: null, openingBalance: 0, openingBalanceDate: "1900-01-01", isLiquid: true, includeInNetWorth: true, isManual: false, createdAt: now, updatedAt: now, deletedAt: null };
      newAccounts.push(wallet);
    }
    const groupId = newId();
    const now = nowIso();
    newRows.push({
      id: newId(),
      householdId,
      accountId: wallet.id,
      date: r.date,
      amount: -r.amount,
      rawDescription: "Cash withdrawal",
      merchant: "Cash withdrawal",
      categoryId: cat("Cash withdrawal").id,
      source: "system",
      bookingStatus: "booked",
      dedupeKey: `system:cash:${r.id}`,
      transferGroupId: groupId,
      status: "auto",
      confidence: 95,
      createdAt: now,
      updatedAt: now,
    });
    r.transferGroupId = groupId;
    r.categoryId = cat("Cash withdrawal").id;
    r.status = "auto";
    r.confidence = 95;
    summary.cashSidesPosted++;
  }

  // 4. Everything else: shared merchants, web lookup, then the AI once per merchant.
  const needsCategory = rows.filter((r) => editable(r) && !r.transferGroupId && !r.refundOfId && !strong.has(r.id) && !r.categoryId);
  const groups = new Map<string, Tx[]>();
  for (const r of needsCategory) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
  const decisions = new Map<string, { categoryId: string | null; confidence: number }>();
  const forAi: string[] = [];
  for (const [key, members] of groups) {
    const known = shared.find((m) => m.matchPatterns.includes(key)) ?? newShared.find((m) => m.matchPatterns.includes(key));
    const suggested = known?.suggestedCategory ? catByName.get(known.suggestedCategory) : undefined;
    if (suggested) {
      decisions.set(key, { categoryId: suggested.id, confidence: 85 });
      continue;
    }
    if (!known && lineKind(members[0]!.rawDescription, members[0]!.amount) === "card") {
      try {
        // Only the normalised merchant name is sent (BUILD_PLAN R4).
        const lookup = lookupResponseSchema.safeParse(await provider.lookupMerchant(key));
        if (lookup.success && lookup.data.isBusiness) {
          const now = nowIso();
          // Shared rows come only from web lookups of card-style business lines (BUILD_PLAN R3).
          newShared.push({
            id: newId(),
            canonicalName: lookup.data.canonicalName.slice(0, 120),
            matchPatterns: [key],
            lookupResult: lookup.data,
            suggestedCategory: lookup.data.suggestedCategory,
            lookedUpAt: now,
            createdAt: now,
            updatedAt: now,
          });
          const cat2 = lookup.data.suggestedCategory ? catByName.get(lookup.data.suggestedCategory) : undefined;
          if (cat2) {
            decisions.set(key, { categoryId: cat2.id, confidence: 85 });
            continue;
          }
        }
      } catch {
        summary.aiFailed = true;
        continue;
      }
    }
    forAi.push(key);
  }
  if (forAi.length > 0) {
    const keyFor = new Map(forAi.map((key, i) => [`m${i}`, key]));
    const items = forAi.map((key, i) => {
      const sample = groups.get(key)![0]!;
      return buildCategoriseItem({
        key: `m${i}`,
        merchant: sample.merchant ?? key,
        description: sample.rawDescription,
        amount: sample.amount,
        date: sample.date,
        accountType: acctById.get(sample.accountId)?.type ?? "current",
      });
    });
    try {
      summary.aiCalls++;
      const parsed = categoriseResponseSchema.safeParse(await provider.categoriseMerchants(items, cats.map((c) => c.name)));
      if (!parsed.success) throw new Error("The AI answer wasn’t in the expected shape.");
      for (const result of parsed.data.results) {
        const key = keyFor.get(result.key); // exact keys only, never reinterpreted
        const category = catByName.get(result.category);
        if (key === undefined || !category) continue; // never trust an unknown key or category
        decisions.set(key, { categoryId: category.id, confidence: result.confidence });
      }
    } catch {
      summary.aiFailed = true;
    }
  }
  for (const [key, decision] of decisions) {
    const members = groups.get(key)!;
    const sure = decision.confidence >= AUTO_FILE_THRESHOLD;
    for (const r of members) {
      r.categoryId = decision.categoryId;
      r.status = sure ? "auto" : "unconfirmed";
      r.confidence = decision.confidence;
    }
    if (!sure) {
      // One question per merchant, covering all its rows (BUILD_PLAN R24).
      const existing = hmRows.find((h) => h.name === key) ?? newHouseholdMerchants.get(key);
      const hm =
        existing ??
        (() => {
          const now = nowIso();
          const created = { id: newId(), householdId, name: key, categoryId: decision.categoryId, confirmed: false, createdAt: now, updatedAt: now };
          newHouseholdMerchants.set(key, created);
          return created;
        })();
      const guess = decision.categoryId ? catById.get(decision.categoryId) : undefined;
      const isCharity = guess?.maaserEffect === "reduce";
      plannedQuestions.push({
        householdId,
        subjectType: "household_merchant",
        subjectId: hm.id!,
        type: isCharity ? "maaser" : "category",
        options: isCharity
          ? [
              { key: "yes", label: "Yes, it’s ma’aser" },
              { key: "no", label: "No" },
            ]
          : [...(guess ? [{ key: guess.id, label: guess.name }] : []), { key: "other", label: "Something else" }],
      });
    }
  }

  // 5. Refunds: linked to their purchase, in its category, never income (rule 4).
  const refundedSoFar = (purchaseId: string) => rows.filter((x) => x.refundOfId === purchaseId).reduce((s, x) => s + x.amount, 0);
  for (const r of rows) {
    if (!editable(r) || r.amount <= 0 || r.transferGroupId) continue;
    if (r.refundOfId) {
      // Already linked: keep it in step with its purchase's category.
      const purchase = byId.get(r.refundOfId);
      if (purchase?.categoryId && purchase.categoryId !== r.categoryId) r.categoryId = purchase.categoryId;
      continue;
    }
    const said = looksLikeRefund(r.rawDescription);
    const decided = r.categoryId ? catById.get(r.categoryId) : undefined;
    if (!said && (decided?.kind === "income" || strong.has(r.id))) continue;
    const key = merchantKey(normaliseMerchant(r.rawDescription));
    const purchases = rows
      .filter(
        (p) =>
          p.accountId === r.accountId &&
          p.amount < 0 &&
          !p.transferGroupId &&
          p.date <= r.date &&
          p.id !== r.id &&
          daysBetween(p.date, r.date) <= REFUND_WINDOW_DAYS &&
          merchantKey(normaliseMerchant(p.rawDescription)) === key,
      )
      .sort((a, b) => b.date.localeCompare(a.date));
    if (purchases.length === 0 && !said) continue;
    const remaining = (p: Tx) => -p.amount - refundedSoFar(p.id);
    const fits = purchases.filter((p) => remaining(p) >= r.amount);
    const exact = fits.find((p) => remaining(p) === r.amount);
    const fit = exact ?? fits[0];
    if (fit) {
      // Several purchases could each have been partly refunded: link the most recent, but ask.
      const unsure = !exact && fits.length > 1;
      r.refundOfId = fit.id;
      r.categoryId = fit.categoryId;
      r.status = fit.categoryId && fit.status !== "unconfirmed" && !unsure ? "auto" : "unconfirmed";
      r.confidence = unsure ? 60 : 90;
      if (unsure) {
        plannedQuestions.push({
          householdId,
          subjectType: "transaction",
          subjectId: r.id,
          type: "refund",
          options: [
            ...fits.slice(0, 5).map((p) => ({ key: `refund_of:${p.id}`, label: `${p.date}: ${(-p.amount / 100).toFixed(2)}` })),
            { key: "not_a_refund", label: "It isn’t a refund" },
          ],
        });
      }
      const purchaseSplits = splits.filter((s) => s.transactionId === fit.id);
      if (purchaseSplits.length > 0) {
        const parts = allocateProRata(r.amount, purchaseSplits.map((s) => -s.amount));
        plannedSplits.set(r.id, purchaseSplits.map((s, i) => ({ categoryId: s.categoryId, amount: parts[i]! })));
      }
      summary.refundsLinked++;
      continue;
    }
    // No purchase it fits: best-guess expense category and a question.
    const guess = purchases[0]?.categoryId ?? (decided?.kind === "expense" ? decided.id : cat("Household").id);
    r.categoryId = guess;
    r.status = "unconfirmed";
    r.confidence = 40;
    plannedQuestions.push({
      householdId,
      subjectType: "transaction",
      subjectId: r.id,
      type: "refund",
      options: [
        { key: "find_purchase", label: purchases.length ? "It refunds more than one purchase" : "Find the purchase" },
        { key: "not_a_refund", label: "It isn’t a refund" },
      ],
    });
  }

  // 6. Transfers with no partner after 10 days become a question (rule 3).
  for (const r of rows) {
    const category = r.categoryId ? catById.get(r.categoryId) : undefined;
    if (category?.kind !== "transfer" || r.transferGroupId || r.source === "system") continue;
    if (daysBetween(r.date, today) < UNPAIRED_TRANSFER_DAYS) continue;
    plannedQuestions.push({
      householdId,
      subjectType: "transaction",
      subjectId: r.id,
      type: "transfer",
      options: [
        { key: "own_account", label: "It went to another of our accounts" },
        { key: "not_transfer", label: "It isn’t a transfer" },
      ],
    });
  }

  // Write everything in one transaction, but only if nothing changed while we were deciding
  // (the family may have confirmed a row while the AI was answering): all or nothing.
  const changed = rows.filter((r) => {
    const before = original.find((o) => o.id === r.id)!;
    return (["merchant", "categoryId", "status", "confidence", "transferGroupId", "refundOfId"] as const).some((f) => r[f] !== before[f]);
  });
  await db.transaction(async (tx) => {
    if (changed.length > 0) {
      const current = await tx
        .select({ id: transactions.id, updatedAt: transactions.updatedAt, status: transactions.status, deletedAt: transactions.deletedAt })
        .from(transactions)
        .where(and(eq(transactions.householdId, householdId), inArray(transactions.id, changed.map((r) => r.id))));
      const now = new Map(current.map((c) => [c.id, c]));
      for (const r of changed) {
        const c = now.get(r.id);
        const before = original.find((o) => o.id === r.id)!;
        if (!c || c.deletedAt || c.updatedAt !== before.updatedAt || c.status !== before.status) throw new EngineConflictError();
      }
    }
    const now = nowIso();
    for (const a of newAccounts) await insertAudited(tx, accounts, a, { actor, reason: "Added a cash wallet for cash withdrawals" });
    for (const m of newShared) await insertAudited(tx, merchants, m, { actor, reason: "Merchant identified by web lookup" });
    summary.sharedMerchantsAdded = newShared.length;
    for (const hm of newHouseholdMerchants.values()) await insertAudited(tx, householdMerchants, hm, { actor, reason: "New merchant to ask the family about" });
    for (const row of newRows) await insertAudited(tx, transactions, row, { actor, reason: "Posted the cash wallet side of a cash withdrawal" });

    for (const r of changed) {
      const before = original.find((o) => o.id === r.id)!;
      const patch: Patch = {};
      for (const field of ["merchant", "categoryId", "status", "confidence", "transferGroupId", "refundOfId"] as const) {
        if (r[field] !== before[field]) (patch as Record<string, unknown>)[field] = r[field];
      }
      if (Object.keys(patch).length === 0) continue;
      await updateAudited(tx, transactions, { id: r.id, householdId }, { ...patch, updatedAt: now }, { actor, reason: "Sorted by the engine" });
      summary.rowsChanged++;
    }
    for (const [transactionId, lines] of plannedSplits) {
      const existing = splits.filter((s) => s.transactionId === transactionId);
      const same = existing.length === lines.length && existing.every((s, i) => s.amount === lines[i]!.amount && s.categoryId === lines[i]!.categoryId);
      if (!same) await setSplits(tx, { householdId, transactionId }, lines, { actor, reason: "Split to match its purchase or rule" });
    }
    for (const q of plannedQuestions) if (await openQuestion(tx, q, { actor, reason: "The engine wasn’t sure" })) summary.questionsOpened++;

    summary.sweeps = (await sweepCashWallets(tx, householdId, { today, actor })).length;
    await rebuildLedgers(tx, householdId, { today, actor });
  });

  const final = await db
    .select({ status: transactions.status })
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), isNull(transactions.deletedAt)));
  for (const f of final) summary.status[f.status]++;
  summary.maaserOwed = await maaserOwed(db, householdId);
  return summary;
}

function ruleMatches(c: RuleConditions, r: Tx, key: string): boolean {
  if (c.merchant !== undefined && merchantKey(c.merchant) !== key) return false;
  if (c.descriptionPattern !== undefined && !merchantKey(r.rawDescription).includes(merchantKey(c.descriptionPattern))) return false;
  if (c.amountMin !== undefined && r.amount < c.amountMin) return false;
  if (c.amountMax !== undefined && r.amount > c.amountMax) return false;
  if (c.accountId !== undefined && r.accountId !== c.accountId) return false;
  if (c.direction === "in" && r.amount <= 0) return false;
  if (c.direction === "out" && r.amount >= 0) return false;
  return true;
}

/** Open questions of a household, for reports. */
export async function openQuestionCounts(db: Db, householdId: string) {
  const rows = await db
    .select({ type: questions.type })
    .from(questions)
    .where(and(eq(questions.householdId, householdId), inArray(questions.status, ["open", "sent"])));
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.type] = (counts[r.type] ?? 0) + 1;
  return counts;
}
