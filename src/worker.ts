/**
 * The background worker: `bun run worker`.
 * Polls the jobs table and runs due jobs one at a time. Stop with Ctrl+C.
 */
import { createDb } from "@/db";
import { runOnce } from "@/jobs/runner";

const POLL_MS = 1000;

async function main() {
  const db = await createDb();
  let stopping = false;
  const stop = () => {
    if (!stopping) console.log("[worker] stopping after the current job");
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  console.log("[worker] started; waiting for jobs");
  while (!stopping) {
    const result = await runOnce(db).catch((error: unknown) => {
      console.error("[worker] error:", error instanceof Error ? error.message : error);
      return null;
    });
    if (result) {
      // Ids and types only; never log job payloads (they may hold bank data).
      console.log(`[worker] ${result.type} ${result.jobId}: ${result.outcome}`);
      continue;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  process.exit(0);
}

void main();
