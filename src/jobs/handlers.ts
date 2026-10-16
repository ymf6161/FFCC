import { AiUnavailableError, type AiProvider, getAiProvider } from "@/ai";
import type { Db } from "@/db";
import { rebuildLedgers } from "@/engine/ledgers";
import { runEngine } from "@/engine/run";
import { ukDate } from "@/lib/time";
import type { Job } from "./queue";

export type JobHandler = (job: Job, db: Db) => Promise<void>;

/**
 * Job types and their handlers. An import queues `categorise_batch`; an undo
 * queues `ledger_rebuild`. If the AI fails, rows stay unconfirmed and the job
 * is retried with backoff (BUILD_PLAN R2).
 */
export function makeHandlers(provider: () => AiProvider = getAiProvider): Record<string, JobHandler> {
  return {
    noop: async () => {},
    categorise_batch: async (job, db) => {
      if (!job.householdId) throw new Error("categorise_batch needs a household");
      const summary = await runEngine(db, job.householdId, { today: ukDate(), provider: provider() });
      if (summary.aiFailed) throw new AiUnavailableError("The AI didn’t answer; sorted what we could and will try again.");
    },
    ledger_rebuild: async (job, db) => {
      if (!job.householdId) throw new Error("ledger_rebuild needs a household");
      const fromDate = typeof job.payload.fromDate === "string" ? job.payload.fromDate : undefined;
      await db.transaction((tx) => rebuildLedgers(tx, job.householdId!, { fromDate, today: ukDate(), actor: { type: "system", id: "worker" } }));
    },
  };
}

export const handlers = makeHandlers();
