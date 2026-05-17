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
});
