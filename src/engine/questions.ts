import { and, eq, inArray } from "drizzle-orm";
import { type AuditContext, insertAudited } from "@/audit";
import type { Executor } from "@/db";
import { questions, type questionSubjects, type questionTypes } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";

export type QuestionInput = {
  householdId: string;
  subjectType: (typeof questionSubjects)[number];
  subjectId: string;
  type: (typeof questionTypes)[number];
  options: { key: string; label: string }[];
};

/** Opens a question unless one is already open for the same subject and type (BUILD_PLAN R24). */
export async function openQuestion(ex: Executor, q: QuestionInput, ctx: AuditContext): Promise<boolean> {
  const [existing] = await ex
    .select({ id: questions.id })
    .from(questions)
    .where(
      and(
        eq(questions.householdId, q.householdId),
        eq(questions.subjectType, q.subjectType),
        eq(questions.subjectId, q.subjectId),
        eq(questions.type, q.type),
        inArray(questions.status, ["open", "sent"]),
      ),
    )
    .limit(1);
  if (existing) return false;
  const now = nowIso();
  await insertAudited(ex, questions, { id: newId(), ...q, createdAt: now, updatedAt: now }, ctx);
  return true;
}
