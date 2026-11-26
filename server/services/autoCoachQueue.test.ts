import { beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "../logger";
import { queue } from "../queue";
import type { IStorage } from "../storage";
import { enqueueMissedSessionCoachInBackground } from "./autoCoachQueue";

vi.mock("../queue", () => ({
  queue: { sendDebounced: vi.fn().mockResolvedValue("job-1") },
  DEFAULT_JOB_OPTIONS: {},
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe("enqueueMissedSessionCoachInBackground", () => {
  const keepAwaitingCoachAfterMiss = vi.fn();
  const storage = { plans: { keepAwaitingCoachAfterMiss } } as unknown as IStorage;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queues the pass, and leaves the waiting list alone when the queue takes it", async () => {
    enqueueMissedSessionCoachInBackground(storage, "u1", "plan-1", "plan-day-skipped");
    await vi.waitFor(() => expect(queue.sendDebounced).toHaveBeenCalledTimes(1));

    const [name, data] = vi.mocked(queue.sendDebounced).mock.calls[0];
    expect([name, data]).toEqual(["auto-coach", { userId: "u1", trigger: "plan-day-skipped" }]);
    expect(keepAwaitingCoachAfterMiss).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  // No log is on its way after a skip or a let-go: a lost pass would leave
  // the sessions after it climbing past the missed step.
  it("puts the plan on the sweep's waiting list when the queue refuses the pass", async () => {
    const refused = new Error("queue unavailable");
    vi.mocked(queue.sendDebounced).mockRejectedValueOnce(refused);

    enqueueMissedSessionCoachInBackground(storage, "u1", "plan-1", "missed-session-let-go");

    await vi.waitFor(() => expect(keepAwaitingCoachAfterMiss).toHaveBeenCalledWith(["plan-1"]));
    expect(logger.error).toHaveBeenCalledWith(
      { err: refused, trigger: "missed-session-let-go" },
      "Failed to queue auto-coach job",
    );
  });

  it("only logs when the day has no plan to wait on", async () => {
    vi.mocked(queue.sendDebounced).mockRejectedValueOnce(new Error("queue unavailable"));

    enqueueMissedSessionCoachInBackground(storage, "u1", null, "plan-day-skipped");

    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1));
    expect(keepAwaitingCoachAfterMiss).not.toHaveBeenCalled();
  });
});
