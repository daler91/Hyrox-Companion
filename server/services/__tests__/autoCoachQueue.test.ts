import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../queue", () => ({
  queue: { send: mocks.send },
  DEFAULT_JOB_OPTIONS: { retryLimit: 3, retryBackoff: true, expireInMinutes: 60 },
}));
vi.mock("../../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: mocks.error },
}));

import {
  AUTO_COACH_DEBOUNCE_SECONDS,
  AUTO_COACH_QUEUE,
  enqueueAutoCoach,
  enqueueAutoCoachInBackground,
} from "../autoCoachQueue";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockResolvedValue("job-1");
});

describe("enqueueAutoCoach", () => {
  it("keys the job per athlete so concurrent triggers coalesce into one coach run", async () => {
    // The singleton key is the whole coalescing guarantee. A producer that
    // keyed it differently would give one athlete two parallel coach passes —
    // and two AI bills — for a single edit.
    await enqueueAutoCoach("user-1", "logged-sets-edited");

    expect(mocks.send).toHaveBeenCalledWith(
      AUTO_COACH_QUEUE,
      { userId: "user-1", trigger: "logged-sets-edited" },
      {
        retryLimit: 3,
        retryBackoff: true,
        expireInMinutes: 60,
        singletonKey: "auto-coach:user-1",
        singletonSeconds: AUTO_COACH_DEBOUNCE_SECONDS,
      },
    );
  });

  it("gives two athletes their own key, so one editing never suppresses the other's run", async () => {
    await enqueueAutoCoach("user-1", "workout-created");
    await enqueueAutoCoach("user-2", "workout-created");

    const [firstKey, secondKey] = mocks.send.mock.calls.map(
      (call) => (call[2] as { singletonKey: string }).singletonKey,
    );
    expect(firstKey).toBe("auto-coach:user-1");
    expect(secondKey).toBe("auto-coach:user-2");
  });

  it("surfaces the rejection so a caller holding companion state can roll it back", async () => {
    // createWorkoutAndScheduleCoaching pre-sets isAutoCoaching inside its
    // transaction; if the enqueue is swallowed here the client polls forever.
    mocks.send.mockRejectedValue(new Error("pg-boss down"));

    await expect(enqueueAutoCoach("user-1", "workout-created")).rejects.toThrow("pg-boss down");
  });
});

describe("enqueueAutoCoachInBackground", () => {
  it("logs a failed enqueue instead of rejecting — the caller's write already committed", async () => {
    mocks.send.mockRejectedValue(new Error("pg-boss down"));

    expect(() => enqueueAutoCoachInBackground("user-1", "plan-day-completed")).not.toThrow();
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalled());

    expect(mocks.error.mock.calls[0][0]).toMatchObject({ trigger: "plan-day-completed" });
  });
});
