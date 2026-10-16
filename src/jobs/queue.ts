import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import type { Executor } from "@/db";
import { jobs } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";

/**
 * A durable job queue in the `jobs` table (BUILD_PLAN section 3, R2).
 * Jobs must be idempotent: a job can run more than once after a crash.
 *
 * Job state changes are plumbing, not financial data, so they are not
 * audit-logged; the work a job does is audited by the code it calls.
 */

export type Job = typeof jobs.$inferSelect;

/** If a job has been running this long, its worker is presumed dead and it may be claimed again. */
export const STALE_LOCK_MS = 15 * 60 * 1000;
/** Home shows "sorting paused" when the oldest due job has waited this long. */
export const PAUSED_AFTER_MS = 10 * 60 * 1000;
export const WORKER_STOPPED = "The worker stopped while running this job.";

export async function enqueue(
  ex: Executor,
  job: {
    type: string;
    householdId?: string | null;
    payload?: Record<string, unknown>;
    runAfter?: Date;
    maxAttempts?: number;
  },
): Promise<Job> {
  const now = nowIso();
  const [row] = await ex
    .insert(jobs)
    .values({
      id: newId(),
      type: job.type,
      householdId: job.householdId ?? null,
      payload: job.payload ?? {},
      runAfter: (job.runAfter ?? new Date()).toISOString(),
      maxAttempts: job.maxAttempts ?? 5,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row!;
}

/**
 * Claims the oldest due job. The claim is a conditional update on the job's
 * previous state, so two workers can never both claim the same job.
 */
export async function claimNext(ex: Executor, now: Date = new Date()): Promise<Job | null> {
  const nowText = now.toISOString();
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MS).toISOString();
  for (let tries = 0; tries < 10; tries++) {
    const [candidate] = await ex
      .select()
      .from(jobs)
      .where(
        or(
          and(eq(jobs.status, "pending"), lte(jobs.runAfter, nowText)),
          and(eq(jobs.status, "running"), lte(jobs.lockedAt, staleBefore)),
        ),
      )
      .orderBy(asc(jobs.runAfter))
      .limit(1);
    if (!candidate) return null;
    const lockCondition =
      candidate.lockedAt === null ? isNull(jobs.lockedAt) : eq(jobs.lockedAt, candidate.lockedAt);
    const unchanged = and(eq(jobs.id, candidate.id), eq(jobs.status, candidate.status), lockCondition);

    // A job whose worker died on every attempt would otherwise take each new worker down with it.
    if (candidate.status === "running" && candidate.attempts >= candidate.maxAttempts) {
      await ex
        .update(jobs)
        .set({ status: "failed", lockedAt: null, lastError: WORKER_STOPPED, updatedAt: nowText })
        .where(unchanged);
      continue;
    }

    const [claimed] = await ex
      .update(jobs)
      .set({ status: "running", lockedAt: nowText, attempts: candidate.attempts + 1, updatedAt: nowText })
      .where(unchanged)
      .returning();
    if (claimed) return claimed;
    // Someone else claimed it first; look again.
  }
  return null;
}

export async function complete(ex: Executor, jobId: string): Promise<void> {
  const now = nowIso();
  await ex.update(jobs).set({ status: "done", lockedAt: null, lastError: null, updatedAt: now }).where(eq(jobs.id, jobId));
}

/** Exponential backoff: 30s, 1m, 2m, 4m … capped at 1 hour. */
export function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 60 * 60 * 1000);
}

/** Records a failure. Retries later with backoff, or stops for good at max attempts. */
export async function fail(ex: Executor, job: Job, error: unknown, now: Date = new Date()): Promise<"retry" | "failed"> {
  const message = error instanceof Error ? error.message : String(error);
  const finalFailure = job.attempts >= job.maxAttempts;
  await ex
    .update(jobs)
    .set({
      status: finalFailure ? "failed" : "pending",
      lockedAt: null,
      lastError: message.slice(0, 2000),
      runAfter: finalFailure ? job.runAfter : new Date(now.getTime() + backoffMs(job.attempts)).toISOString(),
      updatedAt: now.toISOString(),
    })
    .where(eq(jobs.id, job.id));
  return finalFailure ? "failed" : "retry";
}

/**
 * True when this household has a job that has waited more than 10 minutes to
 * start, or one that has been "running" for more than 10 minutes: either way
 * the worker is stopped or stuck (BUILD_PLAN R29).
 */
export async function isSortingPaused(ex: Executor, householdId: string, now: Date = new Date()): Promise<boolean> {
  const threshold = new Date(now.getTime() - PAUSED_AFTER_MS).toISOString();
  const [row] = await ex
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.householdId, householdId),
        or(
          and(eq(jobs.status, "pending"), lte(jobs.runAfter, threshold)),
          and(eq(jobs.status, "running"), lte(jobs.lockedAt, threshold)),
        ),
      ),
    )
    .limit(1);
  return row !== undefined;
}
