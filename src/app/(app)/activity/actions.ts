"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MockAiProvider, getAiProvider } from "@/ai";
import {
  addDetail,
  confirmTransaction,
  countFiledAs,
  createRuleFromCorrection,
  removeDetail,
  saveSplits,
  setCategory,
  setNotes,
} from "@/activity/edits";
import { requireSession } from "@/auth/session";
import { getDb } from "@/db";
import { runEngine } from "@/engine/run";
import { ukDate } from "@/lib/time";
import { parseAmountToPence } from "@/money";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const id = z.string().min(1).max(64);
const KNOWN =
  /doesn’t exist in this household|Choose a category first|no merchant name|need to add up to the payment|Give it a name|can’t be changed here|stays in a transfer category|goes in a spending category|can’t be split|not transfers\./;

/** Our own messages are shown; anything else is logged by type only (never bank data). */
function fail(what: string, error: unknown): { ok: false; error: string } {
  if (error instanceof Error && KNOWN.test(error.message)) return { ok: false, error: error.message };
  console.error(`[activity:${what}] failed: ${error instanceof Error ? error.name : typeof error}`);
  return { ok: false, error: "That didn’t save. Please try again." };
}

async function session() {
  const { householdId, userId } = await requireSession();
  return { householdId, actor: { type: "user" as const, id: userId } };
}

const refresh = (transactionId?: string) => {
  revalidatePath("/activity");
  if (transactionId) revalidatePath(`/activity/${transactionId}`);
  revalidatePath("/");
};

export async function changeCategoryAction(input: { transactionId: string; categoryId: string }): Promise<Result<{ merchant: string | null; categoryName: string; offerRule: boolean }>> {
  const parsed = z.object({ transactionId: id, categoryId: id }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a category." };
  const { householdId, actor } = await session();
  try {
    const change = await setCategory(await getDb(), { householdId, ...parsed.data, actor });
    refresh(parsed.data.transactionId);
    return { ok: true, ...change };
  } catch (e) {
    return fail("category", e);
  }
}

export async function confirmAction(input: { transactionId: string }): Promise<Result> {
  const parsed = z.object({ transactionId: id }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That payment couldn’t be found." };
  const { householdId, actor } = await session();
  try {
    await confirmTransaction(await getDb(), { householdId, ...parsed.data, actor });
    refresh(parsed.data.transactionId);
    return { ok: true };
  } catch (e) {
    return fail("confirm", e);
  }
}

export async function createRuleAction(input: { transactionId: string }): Promise<Result<{ merchant: string; categoryName: string; appliedTo: number }>> {
  const parsed = z.object({ transactionId: id }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That payment couldn’t be found." };
  const { householdId, actor } = await session();
  try {
    const db = await getDb();
    const rule = await createRuleFromCorrection(db, { householdId, ...parsed.data, actor });
    // Apply it now to the merchant's other payments that aren't confirmed yet.
    let provider;
    try {
      provider = getAiProvider();
    } catch {
      provider = new MockAiProvider();
    }
    // The rule is saved either way; if this run fails, the next engine run applies it.
    let appliedTo = 0;
    try {
      await runEngine(db, householdId, { today: ukDate(), provider, actor });
      appliedTo = await countFiledAs(db, householdId, rule.candidateIds, rule.categoryId);
    } catch (e) {
      console.error(`[activity:rule-apply] failed: ${e instanceof Error ? e.name : typeof e}`);
    }
    refresh(parsed.data.transactionId);
    return { ok: true, merchant: rule.merchant, categoryName: rule.categoryName, appliedTo };
  } catch (e) {
    return fail("rule", e);
  }
}

const splitLine = z.object({ categoryId: id, amount: z.string().max(20) });

export async function saveSplitsAction(input: { transactionId: string; amount: number; lines: { categoryId: string; amount: string }[] }): Promise<Result> {
  const parsed = z.object({ transactionId: id, amount: z.number().int(), lines: z.array(splitLine).max(20) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Each line needs a category and an amount." };
  const sign = parsed.data.amount < 0 ? -1 : 1;
  const lines = [];
  for (const line of parsed.data.lines) {
    const amount = parseAmountToPence(line.amount);
    if (!amount.ok) return { ok: false, error: amount.error };
    lines.push({ categoryId: line.categoryId, amount: sign * amount.pence });
  }
  const { householdId, actor } = await session();
  try {
    await saveSplits(await getDb(), { householdId, transactionId: parsed.data.transactionId, lines, actor });
    refresh(parsed.data.transactionId);
    return { ok: true };
  } catch (e) {
    return fail("splits", e);
  }
}

export async function notesAction(input: { transactionId: string; notes: string }): Promise<Result> {
  const parsed = z.object({ transactionId: id, notes: z.string().max(1000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Notes can be up to 1,000 characters." };
  const { householdId, actor } = await session();
  try {
    await setNotes(await getDb(), { householdId, ...parsed.data, actor });
    refresh(parsed.data.transactionId);
    return { ok: true };
  } catch (e) {
    return fail("notes", e);
  }
}

/** The most rows Activity shows at once (and so can select). */
const MAX_SHOWN = 5000;
const kind = z.enum(["tag", "event", "person"]);

export async function addDetailAction(input: { kind: string; name: string; transactionIds: string[] }): Promise<Result<{ added: number }>> {
  const parsed = z.object({ kind, name: z.string().trim().min(1, "Give it a name.").max(80), transactionIds: z.array(id).min(1, "Choose at least one payment.").max(MAX_SHOWN, "That’s too many at once. Narrow the list first.") }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Give it a name." };
  const { householdId, actor } = await session();
  try {
    const added = await addDetail(await getDb(), { householdId, ...parsed.data, actor });
    refresh(parsed.data.transactionIds.length === 1 ? parsed.data.transactionIds[0] : undefined);
    return { ok: true, added };
  } catch (e) {
    return fail("detail", e);
  }
}

export async function removeDetailAction(input: { kind: string; detailId: string; transactionId: string }): Promise<Result> {
  const parsed = z.object({ kind, detailId: id, transactionId: id }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That couldn’t be removed." };
  const { householdId, actor } = await session();
  try {
    await removeDetail(await getDb(), { householdId, ...parsed.data, actor });
    refresh(parsed.data.transactionId);
    return { ok: true };
  } catch (e) {
    return fail("detail", e);
  }
}
