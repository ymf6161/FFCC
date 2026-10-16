import type { Db } from "@/db";
import type { Job } from "./queue";

export type JobHandler = (job: Job, db: Db) => Promise<void>;

/**
 * Job types and their handlers. Phase 2 queues `categorise_batch` after an
 * import and `ledger_rebuild` after an undo; the engine that does this work
 * arrives in Phase 3, so for now they complete without changing anything.
 */
export const handlers: Record<string, JobHandler> = {
  noop: async () => {},
  categorise_batch: async () => {},
  ledger_rebuild: async () => {},
};
