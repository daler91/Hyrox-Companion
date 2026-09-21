import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pool: { connect: vi.fn() },
  withPgAdvisoryLock: vi.fn(),
  cronSchedule: vi.fn(),
  runNutritionReminderCron: vi.fn(),
  runStravaAutoSyncScan: vi.fn(),
  ensureStravaWebhookSubscription: vi.fn(),
}));

vi.mock("./advisoryLock", () => ({
  withPgAdvisoryLock: mocks.withPgAdvisoryLock,
}));

vi.mock("./db", () => ({
  pool: mocks.pool,
}));

vi.mock("./emailScheduler", () => ({
  runEmailCronJob: vi.fn(),
}));

vi.mock("./queue", () => ({
  queue: { getQueues: vi.fn() },
}));

vi.mock("./services/structuredExerciseHealth", () => ({
  runStructuredExerciseDailyRollup: vi.fn(),
}));

vi.mock("./services/analyticsRecomputeScheduler", () => ({
  runAnalyticsRecomputeScan: vi.fn(),
}));

vi.mock("./services/nutrition/foodEmbeddings", () => ({
  embedMissingFoods: vi.fn(),
  pruneDanglingFoodEmbeddings: vi.fn(),
}));

vi.mock("./services/nutrition/reminders", () => ({
  runNutritionReminderCron: mocks.runNutritionReminderCron,
}));

vi.mock("./sharedRuntimeState", () => ({
  cleanupExpiredSharedRuntimeState: vi.fn(),
}));

vi.mock("./services/stravaAutoSync", () => ({
  runStravaAutoSyncScan: mocks.runStravaAutoSyncScan,
}));

vi.mock("./stravaWebhook", () => ({
  ensureStravaWebhookSubscription: mocks.ensureStravaWebhookSubscription,
}));

// A real schedule would fire on a timer; the wiring tests below need to grab
// the callback itself and invoke it directly, keyed by its (unique) cron
// expression so each scheduled job's handler can be tested in isolation.
vi.mock("node-cron", () => ({
  default: { schedule: mocks.cronSchedule },
}));

vi.mock("./env", () => ({
  env: { NUTRITION_ENABLED: "false" },
}));

vi.mock("./logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { CRON_LOCK_KEYS, runCronJobWithLock, startCron, stopCron } from "./cron";
import { runEmailCronJob } from "./emailScheduler";
import { env } from "./env";
import { logger } from "./logger";

// node-cron is mocked with a bare vi.fn(), so `cron.schedule` returns
// undefined, startCron's "already running" guard never trips, and every call
// re-registers every job. Each describe below starts the scheduler with its
// own storage stub, so the schedule mock is cleared FIRST: the lookup then only
// sees this call's registrations, and the handler it returns closes over this
// describe's storage whichever order the describes run in. (A first-match
// `.find` over the accumulated history handed the strava tests a handler built
// over the recycle-bin stub whenever --sequence.shuffle ran that describe
// first; see #2011.) Cron expressions are unique per job, so exactly one
// registration must match.
function startCronWith(storage: object): (expression: string) => () => Promise<void> {
  mocks.cronSchedule.mockClear();
  startCron(storage as never);
  const registered = [...mocks.cronSchedule.mock.calls];

  return (expression) => {
    const matches = registered.filter(([scheduled]) => scheduled === expression);
    const [match] = matches;
    if (matches.length !== 1 || !match) {
      throw new Error(`expected exactly one job scheduled for "${expression}", found ${matches.length}`);
    }
    return match[1] as () => Promise<void>;
  };
}

describe("cron advisory lock wiring", () => {
  it("uses distinct stable advisory lock keys for every scheduled job", () => {
    const lockKeys = Object.values(CRON_LOCK_KEYS);

    expect(new Set(lockKeys).size).toBe(lockKeys.length);
  });

  it("delegates scheduled work through the requested advisory lock", async () => {
    const run = vi.fn().mockResolvedValue("done");
    mocks.withPgAdvisoryLock.mockResolvedValueOnce({ acquired: false, value: undefined });

    await runCronJobWithLock("emailScheduler", run);

    expect(mocks.withPgAdvisoryLock).toHaveBeenCalledWith(
      mocks.pool,
      { key: CRON_LOCK_KEYS.emailScheduler, name: "emailScheduler" },
      run,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("swallows advisory-lock acquisition failures and reports skipped execution", async () => {
    const run = vi.fn().mockResolvedValue("done");
    mocks.withPgAdvisoryLock.mockRejectedValueOnce(new Error("connect failed"));

    const result = await runCronJobWithLock("emailScheduler", run);

    expect(result).toEqual({ acquired: false, value: undefined });
    expect(run).not.toHaveBeenCalled();
  });

  it("logs an error when advisory lock execution fails", async () => {
    const run = vi.fn().mockResolvedValue("done");
    const error = new Error("connect failed");
    mocks.withPgAdvisoryLock.mockRejectedValueOnce(error);

    const { logger } = await import("./logger");

    const result = await runCronJobWithLock("emailScheduler", run);

    expect(result).toEqual({ acquired: false, value: undefined });
    expect(logger.error).toHaveBeenCalledWith(
      { context: "cron", err: error, job: "emailScheduler" },
      "Cron advisory lock execution failed"
    );
  });

});

describe("email scheduler cron job", () => {
  let emailCallback: () => Promise<void>;

  beforeAll(() => {
    mocks.withPgAdvisoryLock.mockImplementation((_pool, _opts, run) => run());
    // "0 * * * *": the email scan ticks hourly and gates per athlete on their
    // local notify hour, rather than once a day at a fixed UTC time.
    emailCallback = startCronWith({})("0 * * * *");
  });

  beforeEach(() => {
    vi.mocked(runEmailCronJob).mockReset();
    mocks.withPgAdvisoryLock.mockClear();
    vi.mocked(logger.info).mockClear();
    vi.mocked(logger.error).mockClear();
  });

  it("runs the scan under the email scheduler lock and logs the outcome", async () => {
    vi.mocked(runEmailCronJob).mockResolvedValueOnce({ usersChecked: 4, emailsSent: 2, details: [] });

    await emailCallback();

    expect(mocks.withPgAdvisoryLock).toHaveBeenCalledWith(
      mocks.pool,
      { key: CRON_LOCK_KEYS.emailScheduler, name: "emailScheduler" },
      expect.any(Function),
    );
    expect(runEmailCronJob).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      { context: "cron", usersChecked: 4, emailsSent: 2, details: [] },
      "Email cron complete: 2 sent, 4 checked",
    );
  });

  it("logs and swallows a failing scan so the scheduler keeps ticking", async () => {
    const error = new Error("db down");
    vi.mocked(runEmailCronJob).mockRejectedValueOnce(error);

    await expect(emailCallback()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith({ context: "cron", err: error }, "Email cron job failed");
  });
});

describe("startup email catch-up", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.withPgAdvisoryLock.mockImplementation((_pool, _opts, run) => run());
    mocks.withPgAdvisoryLock.mockClear();
    vi.mocked(runEmailCronJob).mockReset();
    vi.mocked(runEmailCronJob).mockResolvedValue({ usersChecked: 0, emailsSent: 0, details: [] });
  });

  afterEach(async () => {
    await stopCron();
    vi.useRealTimers();
  });

  it("runs one scan 30s after boot whatever the UTC hour", async () => {
    // 03:00 UTC — under the old daily 09:00 schedule no catch-up would run.
    vi.setSystemTime(new Date("2026-07-20T03:00:00Z"));
    startCronWith({});

    await vi.advanceTimersByTimeAsync(30_000);

    expect(mocks.withPgAdvisoryLock).toHaveBeenCalledWith(
      mocks.pool,
      { key: CRON_LOCK_KEYS.startupEmailCatchUp, name: "startupEmailCatchUp" },
      expect.any(Function),
    );
    expect(runEmailCronJob).toHaveBeenCalledTimes(1);
  });

  it("is cancelled by stopCron before it fires", async () => {
    startCronWith({});

    await stopCron();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(runEmailCronJob).not.toHaveBeenCalled();
  });
});

describe("nutrition reminders cron job", () => {
  let nutritionRemindersCallback: () => Promise<void>;

  beforeAll(() => {
    // The advisory lock always "acquires" and runs the protected work, so
    // these tests exercise the callback's own gate/success/error handling.
    mocks.withPgAdvisoryLock.mockImplementation((_pool, _opts, run) => run());

    // "25 * * * *" is the nutrition-reminders schedule.
    const scheduled = startCronWith({});
    nutritionRemindersCallback = scheduled("25 * * * *");
  });

  beforeEach(() => {
    mocks.runNutritionReminderCron.mockReset();
    mocks.withPgAdvisoryLock.mockClear();
    vi.mocked(logger.info).mockClear();
    vi.mocked(logger.error).mockClear();
  });

  it("no-ops before the lock when the nutrition module is disabled", async () => {
    env.NUTRITION_ENABLED = "false";

    await nutritionRemindersCallback();

    expect(mocks.withPgAdvisoryLock).not.toHaveBeenCalled();
    expect(mocks.runNutritionReminderCron).not.toHaveBeenCalled();
  });

  it("runs the reminder cron and logs counts when reminders were sent", async () => {
    env.NUTRITION_ENABLED = "true";
    mocks.runNutritionReminderCron.mockResolvedValueOnce({ remindersSent: 3, usersChecked: 5 });

    await nutritionRemindersCallback();

    expect(mocks.runNutritionReminderCron).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      { context: "cron", remindersSent: 3, usersChecked: 5 },
      "Nutrition reminders: sent 3 for 5 opted-in user(s)",
    );
  });

  it("stays quiet when the run sends no reminders", async () => {
    env.NUTRITION_ENABLED = "true";
    mocks.runNutritionReminderCron.mockResolvedValueOnce({ remindersSent: 0, usersChecked: 5 });

    await nutritionRemindersCallback();

    expect(logger.info).not.toHaveBeenCalled();
  });

  it("logs and swallows an error from the reminder runner instead of throwing", async () => {
    env.NUTRITION_ENABLED = "true";
    const error = new Error("db unavailable");
    mocks.runNutritionReminderCron.mockRejectedValueOnce(error);

    await expect(nutritionRemindersCallback()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      { context: "cron", err: error },
      "Nutrition reminder cron failed",
    );
  });
});

describe("recycle bin purge cron job", () => {
  let purgeCallback: () => Promise<void>;
  const storage = { recycleBin: { purgeExpired: vi.fn() } };

  beforeAll(() => {
    mocks.withPgAdvisoryLock.mockImplementation((_pool, _opts, run) => run());

    const scheduled = startCronWith(storage);
    purgeCallback = scheduled("45 3 * * *");
  });

  beforeEach(() => {
    storage.recycleBin.purgeExpired.mockReset();
    mocks.withPgAdvisoryLock.mockClear();
    vi.mocked(logger.info).mockClear();
    vi.mocked(logger.error).mockClear();
  });

  it("holds its own advisory lock key", () => {
    expect(CRON_LOCK_KEYS.recycleBinPurge).toBe(42_010_018n);
  });

  it("runs the purge under the recycleBinPurge lock and logs the count when rows were removed", async () => {
    storage.recycleBin.purgeExpired.mockResolvedValueOnce(3);

    await purgeCallback();

    expect(mocks.withPgAdvisoryLock).toHaveBeenCalledWith(
      mocks.pool,
      { key: CRON_LOCK_KEYS.recycleBinPurge, name: "recycleBinPurge" },
      expect.any(Function),
    );
    expect(logger.info).toHaveBeenCalledWith({ context: "cron", purged: 3 }, "Recycle bin purge: removed 3 expired item(s)");
  });

  it("stays quiet when nothing had expired", async () => {
    storage.recycleBin.purgeExpired.mockResolvedValueOnce(0);

    await purgeCallback();

    expect(logger.info).not.toHaveBeenCalled();
  });

  it("logs and swallows a purge failure instead of throwing into the scheduler", async () => {
    const error = new Error("db unavailable");
    storage.recycleBin.purgeExpired.mockRejectedValueOnce(error);

    await expect(purgeCallback()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith({ context: "cron", err: error, job: "recycleBinPurge" }, "Cron job failed");
  });
});

describe("strava auto-sync cron jobs", () => {
  let scanCallback: () => Promise<void>;
  let ensureCallback: () => Promise<void>;

  beforeAll(() => {
    mocks.withPgAdvisoryLock.mockImplementation((_pool, _opts, run) => run());

    const scheduled = startCronWith({});
    scanCallback = scheduled("7,22,37,52 * * * *");
    ensureCallback = scheduled("20 */6 * * *");
  });

  beforeEach(() => {
    mocks.runStravaAutoSyncScan.mockReset();
    mocks.ensureStravaWebhookSubscription.mockReset();
    mocks.withPgAdvisoryLock.mockClear();
    vi.mocked(logger.info).mockClear();
    vi.mocked(logger.error).mockClear();
  });

  it("runs the polling scan under its own advisory lock and logs what it enqueued", async () => {
    mocks.runStravaAutoSyncScan.mockResolvedValueOnce({ usersChecked: 3, enqueued: 2, skipped: null });

    await scanCallback();

    expect(mocks.withPgAdvisoryLock).toHaveBeenCalledWith(
      mocks.pool,
      { key: CRON_LOCK_KEYS.stravaAutoSync, name: "stravaAutoSync" },
      expect.any(Function),
    );
    expect(mocks.runStravaAutoSyncScan).toHaveBeenCalledWith({}, expect.any(Date));
    expect(logger.info).toHaveBeenCalledWith(
      { context: "cron", usersChecked: 3, enqueued: 2, skipped: null },
      "Strava auto-sync: enqueued 2 sync job(s) for 3 due connection(s)",
    );
  });

  it("stays quiet on a tick that enqueues nothing", async () => {
    mocks.runStravaAutoSyncScan.mockResolvedValueOnce({ usersChecked: 0, enqueued: 0, skipped: "cooldown" });

    await scanCallback();

    expect(logger.info).not.toHaveBeenCalled();
  });

  it("logs and swallows a scan failure instead of throwing into the scheduler", async () => {
    const error = new Error("db unavailable");
    mocks.runStravaAutoSyncScan.mockRejectedValueOnce(error);

    await expect(scanCallback()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      { context: "cron", err: error, job: "stravaAutoSync" },
      "Cron job failed",
    );
  });

  it("re-verifies the webhook subscription under its own advisory lock", async () => {
    mocks.ensureStravaWebhookSubscription.mockResolvedValueOnce({ status: "active", subscriptionId: 1 });

    await ensureCallback();

    expect(mocks.withPgAdvisoryLock).toHaveBeenCalledWith(
      mocks.pool,
      { key: CRON_LOCK_KEYS.stravaWebhookEnsure, name: "stravaWebhookEnsure" },
      expect.any(Function),
    );
    expect(mocks.ensureStravaWebhookSubscription).toHaveBeenCalledWith(logger);
  });
});
