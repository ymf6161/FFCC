import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { households, jobs } from "@/db/schema";
import { backoffMs, claimNext, enqueue, isSortingPaused, PAUSED_AFTER_MS } from "@/jobs/queue";
import { runOnce } from "@/jobs/runner";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { createTestDb } from "./helpers";

let db: Db;
let cleanup: () => void;
beforeAll(async () => ({ db, cleanup } = await createTestDb()));
afterAll(() => cleanup());

async function freshHousehold() {
  const now = nowIso();
  const id = newId();
  await db.insert(households).values({ id, name: "H", createdAt: now, updatedAt: now });
  return id;
}

async function drain() {
  while (await claimNext(db, new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000))) {
    /* clear anything left by earlier tests */
  }
  await db.update(jobs).set({ status: "done" });
}

describe("job queue", () => {
  it("runs a due job once and marks it done", async () => {
    await drain();
    const job = await enqueue(db, { type: "noop" });
    const result = await runOnce(db);
    expect(result).toEqual({ jobId: job.id, type: "noop", outcome: "done" });
    const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row?.status).toBe("done");
    expect(row?.attempts).toBe(1);
    expect(await runOnce(db)).toBeNull();
  });

  it("never lets two workers claim the same job", async () => {
    await drain();
    await enqueue(db, { type: "noop" });
    const claims = await Promise.all(Array.from({ length: 8 }, () => claimNext(db)));
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("does not run a job before its run_after time", async () => {
    await drain();
    await enqueue(db, { type: "noop", runAfter: new Date(Date.now() + 60_000) });
    expect(await claimNext(db)).toBeNull();
  });

  it("retries a failing job with backoff, then stops at max attempts", async () => {
    await drain();
    const job = await enqueue(db, { type: "always-fails", maxAttempts: 2 });
    const handlers = { "always-fails": async () => Promise.reject(new Error("AI is down")) };

    const first = await runOnce(db, handlers);
    expect(first?.outcome).toBe("retry");
    let [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row?.status).toBe("pending");
    expect(row?.lastError).toBe("AI is down");
    expect(new Date(row!.runAfter).getTime()).toBeGreaterThan(Date.now() + 20_000);

    // Make it due again and fail it a second time.
    await db.update(jobs).set({ runAfter: new Date(0).toISOString() }).where(eq(jobs.id, job.id));
    const second = await runOnce(db, handlers);
    expect(second?.outcome).toBe("failed");
    [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row?.status).toBe("failed");
    expect(row?.attempts).toBe(2);
  });

  it("fails a job whose type has no handler instead of crashing the worker", async () => {
    await drain();
    await enqueue(db, { type: "unknown-type", maxAttempts: 1 });
    const result = await runOnce(db);
    expect(result?.outcome).toBe("failed");
  });

  it("reclaims a job whose worker died mid-run", async () => {
    await drain();
    const job = await enqueue(db, { type: "noop" });
    await claimNext(db); // worker claims it, then "dies"
    expect(await claimNext(db)).toBeNull();
    const later = new Date(Date.now() + 16 * 60 * 1000);
    const reclaimed = await claimNext(db, later);
    expect(reclaimed?.id).toBe(job.id);
    expect(reclaimed?.attempts).toBe(2);
  });

  it("grows the backoff and caps it at an hour", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(30)).toBe(3_600_000);
  });
});

describe("isSortingPaused", () => {
  it("is false with no jobs and flips once the oldest due job has waited 10 minutes", async () => {
    const householdId = await freshHousehold();
    const now = new Date();
    expect(await isSortingPaused(db, householdId, now)).toBe(false);

    await enqueue(db, { type: "noop", householdId, runAfter: new Date(now.getTime() - PAUSED_AFTER_MS + 60_000) });
    expect(await isSortingPaused(db, householdId, now)).toBe(false);

    await enqueue(db, { type: "noop", householdId, runAfter: new Date(now.getTime() - PAUSED_AFTER_MS - 1000) });
    expect(await isSortingPaused(db, householdId, now)).toBe(true);
  });

  it("only looks at the given household's jobs", async () => {
    const a = await freshHousehold();
    const b = await freshHousehold();
    await enqueue(db, { type: "noop", householdId: a, runAfter: new Date(Date.now() - 2 * PAUSED_AFTER_MS) });
    expect(await isSortingPaused(db, a)).toBe(true);
    expect(await isSortingPaused(db, b)).toBe(false);
  });
});
