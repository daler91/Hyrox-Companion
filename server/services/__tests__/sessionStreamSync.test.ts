import type { Job } from "pg-boss";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IStorage } from "../../storage";
import type { PendingStreamCandidate } from "../../storage/sessionStreams";
import { streamFromStretches } from "../sessionGrades/testFixtures";

const mocks = vi.hoisted(() => ({
  fetchStravaActivityStreams: vi.fn(),
  getValidAccessToken: vi.fn(),
  getStravaSyncCooldownUntil: vi.fn(),
  startStravaSyncCooldown: vi.fn(),
  enqueueSessionStreams: vi.fn(),
  isStravaAutoSyncEnabled: vi.fn(() => true),
  createQueue: vi.fn(),
  work: vi.fn(),
}));

vi.mock("../../strava", () => ({
  fetchStravaActivityStreams: mocks.fetchStravaActivityStreams,
  getValidAccessToken: mocks.getValidAccessToken,
}));
vi.mock("../stravaAutoSync", () => ({
  getStravaSyncCooldownUntil: mocks.getStravaSyncCooldownUntil,
  startStravaSyncCooldown: mocks.startStravaSyncCooldown,
}));
vi.mock("../stravaSyncQueue", () => ({ isStravaAutoSyncEnabled: mocks.isStravaAutoSyncEnabled }));
vi.mock("../sessionStreamQueue", () => ({
  SESSION_STREAMS_QUEUE: "session-streams",
  enqueueSessionStreams: mocks.enqueueSessionStreams,
}));
vi.mock("../../queue", () => ({
  queue: { createQueue: mocks.createQueue, work: mocks.work },
  jobDataKeys: (job: { data?: object }) => Object.keys(job.data ?? {}),
  runBatch: async (_name: string, jobs: unknown[], fn: (job: unknown) => Promise<unknown>) => {
    for (const job of jobs) await fn(job);
  },
  runWithTimeout: (_label: string, fn: (signal: AbortSignal) => Promise<unknown>) =>
    fn(new AbortController().signal),
}));
vi.mock("../../logger", () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() };
  logger.child.mockReturnValue(logger);
  return { logger };
});

import {
  registerSessionStreamWorker,
  runSessionStreamBackfillScan,
  runSessionStreamJob,
  SESSION_STREAM_READS_PER_15_MIN,
  SESSION_STREAM_SCAN_USERS_PER_TICK,
  SESSION_STREAMS_PER_JOB,
} from "../sessionStreamSync";

const NOW = new Date("2026-09-26T12:00:00Z");
const USER = "user-1";
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function candidate(overrides: Partial<PendingStreamCandidate> = {}): PendingStreamCandidate {
  return {
    workoutLogId: "log-1",
    stravaActivityId: "9001",
    date: "2026-09-24",
    logFocus: "Run",
    deviceActivity: null,
    planDayId: "day-1",
    planFocus: "Threshold Run",
    planMainWorkout: "15 min easy, 3 x 10 min @ 4:50/km with 2 min jog, 10 min easy",
    attempts: 0,
    ...overrides,
  };
}

function makeStorage(candidates: PendingStreamCandidate[], attemptsSoFar = 0) {
  const sessionStreams = {
    countAttemptsSince: vi.fn().mockResolvedValue(attemptsSoFar),
    listPendingForUser: vi.fn().mockResolvedValue(candidates),
    listUsersWithPendingStreams: vi.fn().mockResolvedValue([]),
    upsertResult: vi.fn().mockResolvedValue(undefined),
  };
  const storage = {
    sessionStreams,
    workouts: { getExerciseSetsByPlanDays: vi.fn().mockResolvedValue(new Map()) },
    users: { setStravaReauthRequired: vi.fn().mockResolvedValue(undefined) },
  };
  return { storage: storage as unknown as IStorage, sessionStreams, users: storage.users };
}

const okStream = streamFromStretches([{ seconds: 1200, paceSecPerKm: 300, hr: 150 }]);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isStravaAutoSyncEnabled.mockReturnValue(true);
  mocks.getStravaSyncCooldownUntil.mockResolvedValue(null);
  mocks.startStravaSyncCooldown.mockResolvedValue(NOW.getTime() + 900_000);
  mocks.getValidAccessToken.mockResolvedValue({ ok: true, accessToken: "token" });
  mocks.fetchStravaActivityStreams.mockResolvedValue({ ok: true, streams: okStream });
  mocks.enqueueSessionStreams.mockResolvedValue({ enqueued: true, jobId: "job" });
});

describe("runSessionStreamJob", () => {
  it("fetches, downsamples and stores the stream of a gradeable run", async () => {
    const { storage, sessionStreams } = makeStorage([candidate()]);

    const result = await runSessionStreamJob(storage, { userId: USER, trigger: "sync" }, log, NOW);

    expect(result).toEqual({ status: "done", fetched: 1, skipped: 0, failed: 0 });
    expect(mocks.fetchStravaActivityStreams).toHaveBeenCalledWith("token", "9001");
    const [row] = sessionStreams.upsertResult.mock.calls[0];
    expect(row).toMatchObject({ userId: USER, workoutLogId: "log-1", status: "ok", attempts: 0 });
    expect(row.samples.bucketSeconds).toBe(15);
    // Only runs from the last six months, failed rows retried after six hours.
    const [, window] = sessionStreams.listPendingForUser.mock.calls[0];
    expect(window.since).toBe("2026-03-30");
    expect(window.retryBefore).toEqual(new Date("2026-09-26T06:00:00Z"));
  });

  it("marks runs we do not grade as skipped without spending a Strava read", async () => {
    const { storage, sessionStreams } = makeStorage([
      candidate({ workoutLogId: "intervals", planFocus: "VO2 Intervals", planMainWorkout: "6 x 800 m" }),
      candidate({
        workoutLogId: "ride",
        logFocus: "Ride",
        planFocus: "Easy Run",
        deviceActivity: { provider: "strava", raw: { sport_type: "Ride" }, filledColumns: [], linkedAt: "" } as never,
      }),
    ]);

    const result = await runSessionStreamJob(storage, { userId: USER, trigger: "sync" }, log, NOW);

    expect(result).toEqual({ status: "done", fetched: 0, skipped: 2, failed: 0 });
    expect(mocks.fetchStravaActivityStreams).not.toHaveBeenCalled();
    expect(sessionStreams.upsertResult.mock.calls.map(([row]) => row.status)).toEqual(["skipped", "skipped"]);
  });

  it("stops at the per-job cap and leaves the rest for the next job", async () => {
    const many = Array.from({ length: 9 }, (_, i) => candidate({ workoutLogId: `log-${i}`, stravaActivityId: String(i) }));
    const { storage } = makeStorage(many);

    const result = await runSessionStreamJob(storage, { userId: USER, trigger: "scan" }, log, NOW);

    expect(result).toMatchObject({ fetched: SESSION_STREAMS_PER_JOB });
    expect(mocks.fetchStravaActivityStreams).toHaveBeenCalledTimes(SESSION_STREAMS_PER_JOB);
  });

  it("never spends more than the remaining read budget", async () => {
    const many = Array.from({ length: 5 }, (_, i) => candidate({ workoutLogId: `log-${i}` }));
    const { storage } = makeStorage(many, SESSION_STREAM_READS_PER_15_MIN - 2);

    await runSessionStreamJob(storage, { userId: USER, trigger: "scan" }, log, NOW);

    expect(mocks.fetchStravaActivityStreams).toHaveBeenCalledTimes(2);
  });

  it("does nothing once the budget is spent, during a cooldown, or under the kill switch", async () => {
    const { storage } = makeStorage([candidate()], SESSION_STREAM_READS_PER_15_MIN);
    await expect(runSessionStreamJob(storage, { userId: USER, trigger: "sync" }, log, NOW)).resolves.toEqual({
      status: "budget",
    });

    mocks.getStravaSyncCooldownUntil.mockResolvedValue(NOW.getTime() + 60_000);
    await expect(runSessionStreamJob(storage, { userId: USER, trigger: "sync" }, log, NOW)).resolves.toEqual({
      status: "cooldown",
    });

    mocks.isStravaAutoSyncEnabled.mockReturnValue(false);
    await expect(runSessionStreamJob(storage, { userId: USER, trigger: "sync" }, log, NOW)).resolves.toEqual({
      status: "disabled",
    });
    expect(mocks.fetchStravaActivityStreams).not.toHaveBeenCalled();
  });

  it("records a 404 as unavailable and a server error as a failed attempt", async () => {
    const { storage, sessionStreams } = makeStorage([
      candidate({ workoutLogId: "gone" }),
      candidate({ workoutLogId: "flaky", attempts: 1 }),
    ]);
    mocks.fetchStravaActivityStreams
      .mockResolvedValueOnce({ ok: false, reason: "not_found" })
      .mockResolvedValueOnce({ ok: false, reason: "failed", status: 503 });

    const result = await runSessionStreamJob(storage, { userId: USER, trigger: "sync" }, log, NOW);

    expect(result).toEqual({ status: "done", fetched: 2, skipped: 0, failed: 1 });
    const rows = sessionStreams.upsertResult.mock.calls.map(([row]) => row);
    expect(rows[0]).toMatchObject({ workoutLogId: "gone", status: "unavailable", lastError: "http_404" });
    expect(rows[1]).toMatchObject({ workoutLogId: "flaky", status: "failed", attempts: 2, lastError: "http_503" });
  });

  it("arms the shared Strava cooldown on a 429 and records nothing against the run", async () => {
    const { storage, sessionStreams } = makeStorage([candidate(), candidate({ workoutLogId: "log-2" })]);
    mocks.fetchStravaActivityStreams.mockResolvedValue({ ok: false, reason: "rate_limited", retryAfterSeconds: 120 });

    const result = await runSessionStreamJob(storage, { userId: USER, trigger: "sync" }, log, NOW);

    expect(result).toEqual({ status: "rate_limited", cooldownUntil: NOW.getTime() + 900_000 });
    expect(mocks.startStravaSyncCooldown).toHaveBeenCalledWith(120);
    expect(mocks.fetchStravaActivityStreams).toHaveBeenCalledTimes(1);
    expect(sessionStreams.upsertResult).not.toHaveBeenCalled();
  });

  it("tombstones the connection when Strava rejects the token", async () => {
    const { storage, users } = makeStorage([candidate()]);
    mocks.fetchStravaActivityStreams.mockResolvedValue({ ok: false, reason: "reauth_required" });

    await expect(runSessionStreamJob(storage, { userId: USER, trigger: "sync" }, log, NOW)).resolves.toEqual({
      status: "reauth_required",
    });
    expect(users.setStravaReauthRequired).toHaveBeenCalledWith(USER);
  });

  it("passes a token failure through without fetching", async () => {
    const { storage } = makeStorage([candidate()]);
    mocks.getValidAccessToken.mockResolvedValue({ ok: false, reason: "not_connected" });

    await expect(runSessionStreamJob(storage, { userId: USER, trigger: "sync" }, log, NOW)).resolves.toEqual({
      status: "not_connected",
    });
    expect(mocks.fetchStravaActivityStreams).not.toHaveBeenCalled();
  });
});

describe("runSessionStreamBackfillScan", () => {
  it("queues a fetch for a capped number of athletes with pending streams", async () => {
    const { storage, sessionStreams } = makeStorage([]);
    sessionStreams.listUsersWithPendingStreams.mockResolvedValue(["a", "b"]);

    const result = await runSessionStreamBackfillScan(storage, NOW);

    expect(result).toEqual({ usersChecked: 2, enqueued: 2, skipped: null });
    const [window] = sessionStreams.listUsersWithPendingStreams.mock.calls[0];
    expect(window.limit).toBe(SESSION_STREAM_SCAN_USERS_PER_TICK);
    expect(mocks.enqueueSessionStreams).toHaveBeenCalledWith("a", "scan");
  });

  it("skips the tick under the kill switch, a cooldown, or a spent budget", async () => {
    const { storage } = makeStorage([], SESSION_STREAM_READS_PER_15_MIN);
    await expect(runSessionStreamBackfillScan(storage, NOW)).resolves.toMatchObject({ skipped: "budget" });
    mocks.getStravaSyncCooldownUntil.mockResolvedValue(NOW.getTime() + 1);
    await expect(runSessionStreamBackfillScan(storage, NOW)).resolves.toMatchObject({ skipped: "cooldown" });
    mocks.isStravaAutoSyncEnabled.mockReturnValue(false);
    await expect(runSessionStreamBackfillScan(storage, NOW)).resolves.toMatchObject({ skipped: "disabled" });
    expect(mocks.enqueueSessionStreams).not.toHaveBeenCalled();
  });
});

describe("registerSessionStreamWorker", () => {
  it("runs each job for its athlete and skips jobs with no user", async () => {
    const { storage } = makeStorage([]);
    await registerSessionStreamWorker(storage);
    const [queueName, handler] = mocks.work.mock.calls[0] as [string, (jobs: Job[]) => Promise<void>];
    expect(queueName).toBe("session-streams");

    await handler([
      { id: "1", data: { userId: USER, trigger: "sync" } } as Job,
      { id: "2", data: {} } as Job,
    ]);

    const sessionStreams = storage.sessionStreams as unknown as { listPendingForUser: ReturnType<typeof vi.fn> };
    expect(sessionStreams.listPendingForUser).toHaveBeenCalledTimes(1);
    expect(sessionStreams.listPendingForUser.mock.calls[0][0]).toBe(USER);
  });
});
