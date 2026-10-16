import type { Db } from "@/db";
import { handlers as defaultHandlers, type JobHandler } from "./handlers";
import { claimNext, complete, fail } from "./queue";

export type RunResult = { jobId: string; type: string; outcome: "done" | "retry" | "failed" } | null;

/** Claims and runs one due job. Returns null when nothing is due. */
export async function runOnce(db: Db, handlers: Record<string, JobHandler> = defaultHandlers): Promise<RunResult> {
  const job = await claimNext(db);
  if (!job) return null;
  const handler = handlers[job.type];
  try {
    if (!handler) throw new Error(`No handler for job type "${job.type}"`);
    await handler(job, db);
    await complete(db, job.id);
    return { jobId: job.id, type: job.type, outcome: "done" };
  } catch (error) {
    const outcome = await fail(db, job, error);
    return { jobId: job.id, type: job.type, outcome };
  }
}
