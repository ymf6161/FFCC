import type { Db } from "@/db";
import type { Job } from "./queue";

export type JobHandler = (job: Job, db: Db) => Promise<void>;

/**
 * Job types and their handlers. Phase 1 has only `noop`, which proves the
 * loop works end to end. Later phases add categorise, pair transfers, etc.
 */
export const handlers: Record<string, JobHandler> = {
  noop: async () => {},
};
