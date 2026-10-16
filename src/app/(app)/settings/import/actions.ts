"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { insertAudited } from "@/audit";
import { requireSession } from "@/auth/session";
import { getDb } from "@/db";
import { listBankProfiles } from "@/db/queries";
import { accounts } from "@/db/schema";
import { parseCsv } from "@/import/csv";
import { detectLayout } from "@/import/detect";
import { bankProfileMappingSchema } from "@/import/mapping";
import { prepareImport, runImport } from "@/import/pipeline";
import { undoImport } from "@/import/undo";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { NEW_ACCOUNT_TYPES } from "./shared";

/** 5 MB: a year of a busy account is well under 1 MB. */
const MAX_CSV_CHARS = 5_000_000;

const csvTextSchema = z
  .string()
  .min(1, "This file is empty.")
  .max(MAX_CSV_CHARS, "This file is too large. Try exporting a shorter date range.");
const fileNameSchema = z.string().trim().min(1).max(200);
const targetSchema = z.union([
  z.object({ accountId: z.string().min(1) }),
  z.object({ newAccount: z.object({ name: z.string().trim().min(1, "Give the account a name.").max(60), type: z.enum(NEW_ACCOUNT_TYPES) }) }),
]);

export type ActionError = { ok: false; error: string };

/**
 * Logs that something failed without its message: database errors can carry
 * SQL parameters, which would put bank descriptions in the logs (CLAUDE.md).
 */
function logFailure(what: string, error: unknown) {
  const name = error instanceof Error ? error.name : typeof error;
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  console.error(`[${what}] failed: ${name}${code ? ` (${code})` : ""}`);
}
const fail = (error: string): ActionError => ({ ok: false, error });
const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Something in the form needs checking.";

export type AnalyseResult =
  | {
      ok: true;
      headers: string[];
      headerRow: number;
      recognisedAs: string | null;
      mapping: Record<string, unknown>;
      sampleRows: string[][];
      rowCount: number;
    }
  | ActionError;

/** Step 1 → 2: find the header row and recognise the layout. Writes nothing. */
export async function analyseUpload(input: { csvText: string }): Promise<AnalyseResult> {
  const { householdId } = await requireSession();
  const parsed = csvTextSchema.safeParse(input.csvText);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const rows = parseCsv(parsed.data);
  if (rows.length < 2) return fail("We couldn’t find any rows in this file. It may not be a CSV. Try exporting it again from your bank.");
  const profiles = await listBankProfiles(await getDb(), householdId);
  const detection = detectLayout(rows, profiles);
  return {
    ok: true,
    headers: detection.headers,
    headerRow: detection.headerRow,
    recognisedAs: detection.recognisedAs,
    mapping: detection.mapping,
    sampleRows: rows.slice(detection.headerRow + 1, detection.headerRow + 4),
    rowCount: Math.max(0, rows.length - detection.headerRow - 1),
  };
}

/** Header row changed by the family: re-read the column names. */
export async function headersAt(input: { csvText: string; headerRow: number }): Promise<{ ok: true; headers: string[] } | ActionError> {
  await requireSession();
  const parsed = z.object({ csvText: csvTextSchema, headerRow: z.number().int().min(0).max(50) }).safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  return { ok: true, headers: parseCsv(parsed.data.csvText)[parsed.data.headerRow] ?? [] };
}

export type PreviewRow = {
  rowNumber: number;
  date: string;
  description: string;
  amount: number;
  balance: number | null;
  status: "new" | "duplicate" | "near_duplicate";
};

export type PreviewResult =
  | {
      ok: true;
      counts: { total: number; new: number; duplicate: number; nearDuplicate: number; error: number };
      rows: PreviewRow[];
      errors: { rowNumber: number; reason: string }[];
      firstDate: string | null;
      lastDate: string | null;
      moneyIn: number;
      moneyOut: number;
    }
  | ActionError;

/** Step 3: a dry run of the import with the chosen mapping. Writes nothing. */
export async function previewImportAction(input: { target: unknown; csvText: string; mapping: unknown }): Promise<PreviewResult> {
  const { householdId } = await requireSession();
  const parsed = z.object({ target: targetSchema, csvText: csvTextSchema, mapping: bankProfileMappingSchema }).safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { target, csvText, mapping } = parsed.data;
  const accountId = "accountId" in target ? target.accountId : null;
  const prepared = await prepareImport(await getDb(), { householdId, accountId, csvText, mapping });
  if (prepared.rows.length === 0 && prepared.errors[0]?.rowNumber === 0) return fail(prepared.errors[0].reason);
  return {
    ok: true,
    counts: prepared.counts,
    rows: prepared.rows.slice(0, 20).map((r) => ({
      rowNumber: r.rowNumber,
      date: r.date,
      description: r.description,
      amount: r.amount,
      balance: r.balance ?? null,
      status: r.status,
    })),
    errors: prepared.errors.slice(0, 20),
    firstDate: prepared.firstDate,
    lastDate: prepared.lastDate,
    // Whole-file totals, so the sign check still works when everything is already imported.
    moneyIn: prepared.rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0),
    moneyOut: prepared.rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0),
  };
}

/** Step 4: import, creating the account first if asked, in one transaction. */
export async function confirmImportAction(input: {
  target: unknown;
  fileName: string;
  csvText: string;
  mapping: unknown;
  profileName: string;
}): Promise<ActionError> {
  const { householdId, userId } = await requireSession();
  const parsed = z
    .object({
      target: targetSchema,
      fileName: fileNameSchema,
      csvText: csvTextSchema,
      mapping: bankProfileMappingSchema,
      profileName: z.string().trim().max(80),
    })
    .safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { target, fileName, csvText, mapping, profileName } = parsed.data;
  const actor = { type: "user" as const, id: userId };
  const db = await getDb();

  let batchId: string;
  try {
    batchId = await db.transaction(async (tx) => {
      let accountId: string;
      if ("accountId" in target) {
        accountId = target.accountId;
      } else {
        const now = nowIso();
        const type = target.newAccount.type;
        const account = await insertAudited(
          tx,
          accounts,
          {
            id: newId(),
            householdId,
            type,
            name: target.newAccount.name,
            openingBalance: 0,
            openingBalanceDate: "1900-01-01",
            isLiquid: type !== "credit_card",
            includeInNetWorth: true,
            isManual: false,
            createdAt: now,
            updatedAt: now,
          },
          { actor, reason: "Added an account while importing" },
        );
        accountId = account.id;
      }
      const result = await runImport(tx, { householdId, accountId, fileName, csvText, mapping, profileName, actor });
      return result.batchId;
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("That account")) return fail(error.message);
    logFailure("import", error);
    return fail("The import didn’t finish, and nothing was saved. Please try again.");
  }
  redirect(`/settings/imports/${batchId}?done=1`);
}

/** Undo an import after the family has confirmed in place. */
export async function undoImportAction(input: { batchId: string }): Promise<ActionError> {
  const { householdId, userId } = await requireSession();
  const parsed = z.object({ batchId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return fail("That import couldn’t be found.");
  try {
    await undoImport(await getDb(), { householdId, batchId: parsed.data.batchId, actor: { type: "user", id: userId } });
  } catch (error) {
    if (error instanceof Error && /already been undone|doesn’t exist/.test(error.message)) return fail(error.message);
    logFailure("undo", error);
    return fail("The undo didn’t finish, and nothing was changed. Please try again.");
  }
  redirect(`/settings/imports/${parsed.data.batchId}?undone=1`);
}
