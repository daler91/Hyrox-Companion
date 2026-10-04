import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendDebounced: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../queue", () => ({
  queue: { sendDebounced: mocks.sendDebounced },
  DEFAULT_JOB_OPTIONS: { retryLimit: 3, retryBackoff: true, expireInSeconds: 3600 },
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
  mocks.sendDebounced.mockResolvedValue("job-1");
});

describe("enqueueAutoCoach", () => {
  it("keys the job per athlete so concurrent triggers coalesce into one coach run", async () => {
    // The singleton key is the whole coalescing guarantee. A producer that
    // keyed it differently would give one athlete two parallel coach passes —
    // and two AI bills — for a single edit.
    await enqueueAutoCoach("user-1", "logged-sets-edited");

    expect(mocks.sendDebounced).toHaveBeenCalledWith(
      AUTO_COACH_QUEUE,
      { userId: "user-1", trigger: "logged-sets-edited" },
      { retryLimit: 3, retryBackoff: true, expireInSeconds: 3600 },
      AUTO_COACH_DEBOUNCE_SECONDS,
      "auto-coach:user-1",
    );
  });

  // AI12 (CODEBASE_ANALYSIS_2026-10-03): singletonKey + singletonSeconds alone
  // is pg-boss's THROTTLE. A trigger landing after the window's job had
  // started — a typo'd set corrected 30 s later — was dropped, so no pass ever
  // saw the correction. sendDebounced (singletonNextSlot) queues one more pass
  // in the next window instead.
  it("debounces rather than throttles, so a late trigger in a busy window still gets a pass", async () => {
    await enqueueAutoCoach("user-1", "logged-sets-edited");

    expect(mocks.sendDebounced).toHaveBeenCalledTimes(1);
    const [, , options] = mocks.sendDebounced.mock.calls[0];
    // The window and key travel as sendDebounced's own arguments, never as a
    // bare singletonSeconds in the options (which would make it a throttle again).
    expect(options).not.toHaveProperty("singletonSeconds");
  });

  it("resolves null when this window and the next already hold a pass", async () => {
    mocks.sendDebounced.mockResolvedValue(null);

    await expect(enqueueAutoCoach("user-1", "workout-created")).resolves.toBeNull();
  });

  it("gives two athletes their own key, so one editing never suppresses the other's run", async () => {
    await enqueueAutoCoach("user-1", "workout-created");
    await enqueueAutoCoach("user-2", "workout-created");

    const [firstKey, secondKey] = mocks.sendDebounced.mock.calls.map((call) => call[4] as string);
    expect(firstKey).toBe("auto-coach:user-1");
    expect(secondKey).toBe("auto-coach:user-2");
  });

  it("surfaces the rejection so a caller holding companion state can roll it back", async () => {
    // createWorkoutAndScheduleCoaching pre-sets isAutoCoaching inside its
    // transaction; if the enqueue is swallowed here the client polls forever.
    mocks.sendDebounced.mockRejectedValue(new Error("pg-boss down"));

    await expect(enqueueAutoCoach("user-1", "workout-created")).rejects.toThrow("pg-boss down");
  });
});

describe("enqueueAutoCoachInBackground", () => {
  it("logs a failed enqueue instead of rejecting — the caller's write already committed", async () => {
    mocks.sendDebounced.mockRejectedValue(new Error("pg-boss down"));

    expect(() => enqueueAutoCoachInBackground("user-1", "plan-day-completed")).not.toThrow();
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalled());

    expect(mocks.error.mock.calls[0][0]).toMatchObject({ trigger: "plan-day-completed" });
  });
});
