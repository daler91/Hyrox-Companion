import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pool: { connect: vi.fn() },
  withPgAdvisoryLock: vi.fn(),
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

vi.mock("./logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { CRON_LOCK_KEYS, runCronJobWithLock } from "./cron";

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
