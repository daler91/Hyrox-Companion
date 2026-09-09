import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

import { CRON_LOCK_KEYS, runCronJobWithLock, startCron } from "./cron";
import { env } from "./env";
import { logger } from "./logger";

describe("cron advisory lock wiring", () => {
  it("uses distinct stable advisory lock keys for every scheduled job", () => {
    const lockKeys = Object.values(CRON_LOCK_KEYS);

    expect(new Set(lockKeys).size).toBe(lockKeys.length);
  });

  it("delegates scheduled work through the requested advisory lock", async () => {
    const run = vi.fn().mockResolvedValue("done");
    mocks.withPgAdvisoryLock.mockResolvedValueOnce({ acquired: false, value: undefined });

    await runCronJobWithLock("dailyEmail", run);

    expect(mocks.withPgAdvisoryLock).toHaveBeenCalledWith(
      mocks.pool,
      { key: CRON_LOCK_KEYS.dailyEmail, name: "dailyEmail" },
      run,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("swallows advisory-lock acquisition failures and reports skipped execution", async () => {
    const run = vi.fn().mockResolvedValue("done");
    mocks.withPgAdvisoryLock.mockRejectedValueOnce(new Error("connect failed"));

    const result = await runCronJobWithLock("dailyEmail", run);

    expect(result).toEqual({ acquired: false, value: undefined });
    expect(run).not.toHaveBeenCalled();
  });

  it("logs an error when advisory lock execution fails", async () => {
    const run = vi.fn().mockResolvedValue("done");
    const error = new Error("connect failed");
    mocks.withPgAdvisoryLock.mockRejectedValueOnce(error);

    const { logger } = await import("./logger");

    const result = await runCronJobWithLock("dailyEmail", run);

    expect(result).toEqual({ acquired: false, value: undefined });
    expect(logger.error).toHaveBeenCalledWith(
      { context: "cron", err: error, job: "dailyEmail" },
      "Cron advisory lock execution failed"
    );
  });

});

describe("nutrition reminders cron job", () => {
  let nutritionRemindersCallback: () => Promise<void>;

  beforeAll(() => {
    // The advisory lock always "acquires" and runs the protected work, so
    // these tests exercise the callback's own gate/success/error handling.
    mocks.withPgAdvisoryLock.mockImplementation((_pool, _opts, run) => run());

    startCron({} as never);

    // "25 * * * *" is the nutrition-reminders schedule and is unique among
    // startCron's registered jobs — grab its handler by that expression.
    const call = mocks.cronSchedule.mock.calls.find(([expression]) => expression === "25 * * * *");
    if (!call) throw new Error("nutrition reminders job was not scheduled");
    nutritionRemindersCallback = call[1];
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

describe("strava auto-sync cron jobs", () => {
  let scanCallback: () => Promise<void>;
  let ensureCallback: () => Promise<void>;

  beforeAll(() => {
    mocks.withPgAdvisoryLock.mockImplementation((_pool, _opts, run) => run());

    // No-op when an earlier describe already started the scheduler; the
    // registered callbacks are still on the schedule mock either way.
    startCron({} as never);

    const scanCall = mocks.cronSchedule.mock.calls.find(
      ([expression]) => expression === "7,22,37,52 * * * *",
    );
    if (!scanCall) throw new Error("strava auto-sync scan was not scheduled");
    scanCallback = scanCall[1];

    const ensureCall = mocks.cronSchedule.mock.calls.find(
      ([expression]) => expression === "20 */6 * * *",
    );
    if (!ensureCall) throw new Error("strava webhook ensure was not scheduled");
    ensureCallback = ensureCall[1];
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
