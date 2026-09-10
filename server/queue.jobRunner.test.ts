// Importing queue.ts triggers `new PgBoss(...)` at module load, which would
// try to connect to a real DB. Mock pg-boss to a no-op class so the import
// resolves cleanly and we can exercise the pure job-running helpers below.
import type { Job } from "pg-boss";
import { describe, expect, it, vi } from "vitest";

vi.mock("pg-boss", () => ({
  default: class { on() { /* no-op: pg-boss event emitter stub */ } },
  PgBoss: class { on() { /* no-op: pg-boss event emitter stub */ } },
}));
vi.mock("./logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./env", () => ({ env: { DATABASE_URL: "postgres://u:p@h:5432/db" } }));
vi.mock("./storage", () => ({ storage: {} }));
vi.mock("./emailScheduler", () => ({ processMissedWorkoutReminder: vi.fn(), processWeeklySummary: vi.fn() }));
vi.mock("./services/coachService", () => ({ triggerAutoCoach: vi.fn() }));
vi.mock("./services/planGenerationService", () => ({ executePlanGeneration: vi.fn() }));
vi.mock("./services/ragService", () => ({ embedCoachingMaterial: vi.fn() }));
vi.mock("./db", () => ({ pool: { query: vi.fn().mockResolvedValue({ rowCount: 0 }) } }));

import { jobDataKeys, runBatch, runWithTimeout, withTrace } from "./queue";
import { runWithRequestContext } from "./requestContext";

/**
 * withTrace, jobDataKeys, runWithTimeout and runBatch were promoted from
 * module-private to exported this week so server/services/stravaAutoSync.ts
 * and stravaSyncQueue.ts could reuse them — every existing test of those
 * consumers stubs them out (see stravaAutoSync.test.ts / stravaSyncQueue.test.ts),
 * so the helpers' own behavior, including the per-job wall-clock timeout and
 * the batch failure-aggregation that pg-boss retries depend on, had nothing
 * exercising it directly.
 */

describe("withTrace", () => {
  it("passes the payload through unchanged when there is no active request context", () => {
    expect(withTrace({ foo: "bar" })).toEqual({ foo: "bar" });
  });

  it("stamps the active request's correlation id onto the payload", () => {
    const stamped = runWithRequestContext({ requestId: "req-42" }, () => withTrace({ foo: "bar" }));
    expect(stamped).toEqual({ foo: "bar", __requestId: "req-42" });
  });
});

describe("jobDataKeys", () => {
  it("lists the field names present on a job payload, without their values", () => {
    expect(jobDataKeys({ data: { userId: "u1", trigger: "poll" } } as Job)).toEqual([
      "userId",
      "trigger",
    ]);
  });

  it("returns no keys when the job carries no data object", () => {
    expect(jobDataKeys({ data: undefined } as unknown as Job)).toEqual([]);
  });
});

describe("runWithTimeout", () => {
  it("resolves with the wrapped function's result when it finishes before the timeout", async () => {
    await expect(runWithTimeout("test-queue", async () => "ok")).resolves.toBe("ok");
  });

  it("rejects and aborts the signal once the job exceeds its wall-clock budget", async () => {
    vi.useFakeTimers();
    try {
      let sawAbort = false;
      const hungJob = (signal: AbortSignal) =>
        new Promise(() => {
          signal.addEventListener("abort", () => {
            sawAbort = true;
          });
          // Never resolves on its own — only the timeout settles this promise.
        });

      const result = runWithTimeout("test-queue", hungJob);
      const assertion = expect(result).rejects.toThrow(/test-queue job exceeded 50min timeout/);
      await vi.advanceTimersByTimeAsync(50 * 60 * 1000);
      await assertion;
      expect(sawAbort).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("runBatch", () => {
  it("runs every job to completion and resolves when all succeed", async () => {
    const jobs = [{ id: "1", data: {} }, { id: "2", data: {} }] as Job[];
    const processed: string[] = [];

    await expect(
      runBatch("test-queue", jobs, async (job) => {
        processed.push(job.id);
      }),
    ).resolves.toBeUndefined();
    expect(processed.sort()).toEqual(["1", "2"]);
  });

  it("throws an aggregated error when part of the batch fails, without abandoning the rest", async () => {
    const jobs = [{ id: "1", data: {} }, { id: "2", data: {} }, { id: "3", data: {} }] as Job[];
    const processed: string[] = [];

    await expect(
      runBatch("test-queue", jobs, async (job) => {
        processed.push(job.id);
        if (job.id === "2") throw new Error("boom");
      }),
    ).rejects.toThrow("Batch processing failed for 1/3 test-queue jobs");
    // Promise.allSettled semantics: one poison job doesn't stop the others.
    expect(processed.sort()).toEqual(["1", "2", "3"]);
  });
});
