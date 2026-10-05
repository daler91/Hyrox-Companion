// Importing queue.ts triggers `new PgBoss(...)` at module load, which would
// try to connect to a real DB. Mock pg-boss to a no-op class so the import
// resolves cleanly and we can exercise the pure helpers below. Connection-string
// building and the job-running helpers share this preamble, so they share a file
// rather than duplicating it.
import type { Job } from "pg-boss";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pg-boss", () => ({
  default: class { on() { /* no-op: pg-boss event emitter stub */ } },
  PgBoss: class { on() { /* no-op: pg-boss event emitter stub */ } },
}));
vi.mock("./logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() } }));
vi.mock("./env", () => ({ env: { DATABASE_URL: "postgres://u:p@h:5432/db" } }));
vi.mock("./storage", () => ({ storage: {} }));
vi.mock("./emailScheduler", () => ({ processMissedWorkoutReminder: vi.fn(), processWeeklySummary: vi.fn() }));
vi.mock("./services/coachService", () => ({ triggerAutoCoach: vi.fn() }));
vi.mock("./services/planGenerationService", () => ({ executePlanGeneration: vi.fn() }));
vi.mock("./services/ragService", () => ({ embedCoachingMaterial: vi.fn() }));
vi.mock("./db", () => ({ pool: { query: vi.fn().mockResolvedValue({ rowCount: 0 }) } }));
vi.mock("./services/trainingContextCache", () => ({ invalidateTrainingContext: vi.fn() }));
vi.mock("./services/recomputeAnalyticsDispatch", () => ({ dispatchRecomputeAnalytics: vi.fn() }));

import { PGBOSS_STATEMENT_TIMEOUT_MS } from "./constants";
import { pool } from "./db";
import {
  buildQueueConnectionString,
  DEFAULT_JOB_OPTIONS,
  jobDataKeys,
  NO_RETRY_JOB_OPTIONS,
  processRecomputeAnalyticsJob,
  purgeUserJobs,
  runBatch,
  runWithTimeout,
  withTrace,
} from "./queue";
import { runWithRequestContext } from "./requestContext";
import { dispatchRecomputeAnalytics } from "./services/recomputeAnalyticsDispatch";
import { invalidateTrainingContext } from "./services/trainingContextCache";
import { storage } from "./storage";

describe("buildQueueConnectionString (W12)", () => {
  it("appends a PG statement_timeout option matching PGBOSS_STATEMENT_TIMEOUT_MS", () => {
    const url = new URL(buildQueueConnectionString("postgres://u:p@h:5432/db"));
    expect(url.searchParams.get("options")).toBe(`-c statement_timeout=${PGBOSS_STATEMENT_TIMEOUT_MS}`);
  });

  it("preserves an operator-supplied options param by prepending it", () => {
    const url = new URL(
      buildQueueConnectionString("postgres://u:p@h:5432/db?options=-c%20search_path%3Dpublic"),
    );
    const opts = url.searchParams.get("options") ?? "";
    expect(opts).toContain("-c search_path=public");
    expect(opts).toContain(`-c statement_timeout=${PGBOSS_STATEMENT_TIMEOUT_MS}`);
    // Our option must come AFTER the existing one so it wins on conflict
    // (libpq applies options left-to-right; later -c overrides earlier).
    expect(opts.indexOf("statement_timeout")).toBeGreaterThan(opts.indexOf("search_path"));
  });

  it("preserves other URL components (host/port/db/user/password/query params)", () => {
    const result = buildQueueConnectionString("postgres://user:pass@host:5432/mydb?sslmode=require");
    const url = new URL(result);
    expect(url.username).toBe("user");
    expect(url.password).toBe("pass");
    expect(url.hostname).toBe("host");
    expect(url.port).toBe("5432");
    expect(url.pathname).toBe("/mydb");
    expect(url.searchParams.get("sslmode")).toBe("require");
  });

  it("uses a timeout below the 60-minute pg-boss job expiry so PG kills before pg-boss reaps", () => {
    expect(PGBOSS_STATEMENT_TIMEOUT_MS).toBeLessThan(DEFAULT_JOB_OPTIONS.expireInSeconds * 1000);
    // And above the longest legitimate job query (plan-gen retries ~5min).
    expect(PGBOSS_STATEMENT_TIMEOUT_MS).toBeGreaterThan(10 * 60 * 1000);
  });
});

describe("job options (D9)", () => {
  // pg-boss 12 reads `expireInSeconds` only. The options used to say
  // `expireInMinutes: 60`, which pg-boss ignored, so every job fell back to the
  // 15-minute queue default: a long plan generation was failed (and a
  // retrying job re-dispatched) while its first run was still going.
  it.each([
    ["DEFAULT_JOB_OPTIONS", DEFAULT_JOB_OPTIONS],
    ["NO_RETRY_JOB_OPTIONS", NO_RETRY_JOB_OPTIONS],
  ])("%s expires jobs after 60 minutes, in the option pg-boss reads", (_name, options) => {
    expect(options).toMatchObject({ expireInSeconds: 60 * 60 });
    expect(options).not.toHaveProperty("expireInMinutes");
  });
});

describe("purgeUserJobs (W17 — erase queued job payloads on account deletion)", () => {
  it("deletes the user's pending pg-boss jobs filtered by data->>'userId'", async () => {
    vi.mocked(pool.query).mockClear();
    await purgeUserJobs("user-9");
    expect(pool.query).toHaveBeenCalledWith(
      "DELETE FROM pgboss.job WHERE data->>'userId' = $1",
      ["user-9"],
    );
  });
});

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

  it("drops the coach chat's cached context for each athlete a job ran for, even a failed one", async () => {
    vi.mocked(invalidateTrainingContext).mockClear();
    const jobs = [
      { id: "1", data: { userId: "user-1" } },
      { id: "2", data: { userId: "user-2" } },
      { id: "3", data: {} },
    ] as Job[];

    await expect(
      runBatch("test-queue", jobs, (job) => (job.id === "2" ? Promise.reject(new Error("boom")) : Promise.resolve())),
    ).rejects.toThrow();

    expect(vi.mocked(invalidateTrainingContext).mock.calls.map(([userId]) => userId).sort((a, b) => a.localeCompare(b))).toEqual([
      "user-1",
      "user-2",
    ]);
  });
});

describe("processRecomputeAnalyticsJob (D37)", () => {
  const job = {
    id: "job-1",
    data: { userId: "user-1", feature: "coach_insights", localDate: "2026-10-03" },
  } as unknown as Job;
  const markRecomputedOn = vi.fn();
  const releaseRecomputedOn = vi.fn();

  beforeEach(() => {
    markRecomputedOn.mockReset().mockResolvedValue(true);
    releaseRecomputedOn.mockReset();
    vi.mocked(dispatchRecomputeAnalytics).mockReset();
    Object.assign(storage, {
      users: { getUser: vi.fn().mockResolvedValue({ id: "user-1" }) },
      analyticsResults: { markRecomputedOn, releaseRecomputedOn },
    });
  });

  it("keeps the once-per-day claim when the recompute succeeds", async () => {
    vi.mocked(dispatchRecomputeAnalytics).mockResolvedValue();

    await processRecomputeAnalyticsJob(job);

    expect(markRecomputedOn).toHaveBeenCalledWith("user-1", "coach_insights", "2026-10-03");
    expect(releaseRecomputedOn).not.toHaveBeenCalled();
  });

  it("releases the claim and rethrows on failure so a pg-boss retry can run", async () => {
    const failure = new Error("Gemini 503");
    vi.mocked(dispatchRecomputeAnalytics).mockRejectedValue(failure);

    await expect(processRecomputeAnalyticsJob(job)).rejects.toBe(failure);

    expect(releaseRecomputedOn).toHaveBeenCalledWith("user-1", "coach_insights", "2026-10-03");
  });

  it("still rethrows the original error when releasing the claim fails", async () => {
    const failure = new Error("Gemini 503");
    vi.mocked(dispatchRecomputeAnalytics).mockRejectedValue(failure);
    releaseRecomputedOn.mockRejectedValue(new Error("db down"));

    await expect(processRecomputeAnalyticsJob(job)).rejects.toBe(failure);
  });

  it("does not dispatch or release when another delivery already holds the claim", async () => {
    markRecomputedOn.mockResolvedValue(false);

    await processRecomputeAnalyticsJob(job);

    expect(dispatchRecomputeAnalytics).not.toHaveBeenCalled();
    expect(releaseRecomputedOn).not.toHaveBeenCalled();
  });
});
