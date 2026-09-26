import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IStorage } from "../../storage";

const mocks = vi.hoisted(() => ({ enqueueSessionStreams: vi.fn(), warn: vi.fn() }));

vi.mock("../sessionStreamQueue", () => ({ enqueueSessionStreams: mocks.enqueueSessionStreams }));
vi.mock("../../logger", () => ({ logger: { warn: mocks.warn } }));

import { requestSessionStreamForLog } from "../sessionStreamHooks";

const clearSkippedForLog = vi.fn();
const storage = { sessionStreams: { clearSkippedForLog } } as unknown as IStorage;

beforeEach(() => {
  vi.clearAllMocks();
  clearSkippedForLog.mockResolvedValue(undefined);
  mocks.enqueueSessionStreams.mockResolvedValue({ enqueued: true, jobId: "job" });
});

describe("requestSessionStreamForLog", () => {
  it("re-opens a skipped verdict and queues a fetch for a plan-linked Strava log", async () => {
    await requestSessionStreamForLog(
      storage,
      "user-1",
      { id: "log-1", planDayId: "day-1", stravaActivityId: "9001" },
      "link",
    );
    expect(clearSkippedForLog).toHaveBeenCalledWith("log-1", "user-1");
    expect(mocks.enqueueSessionStreams).toHaveBeenCalledWith("user-1", "link");
  });

  it("does nothing for a log without a plan day or a recording", async () => {
    await requestSessionStreamForLog(storage, "user-1", { id: "a", planDayId: null, stravaActivityId: "1" }, "assign");
    await requestSessionStreamForLog(storage, "user-1", { id: "b", planDayId: "d", stravaActivityId: null }, "assign");
    await requestSessionStreamForLog(storage, "user-1", null, "assign");
    expect(mocks.enqueueSessionStreams).not.toHaveBeenCalled();
  });

  it("never lets a queue failure break the link that already happened", async () => {
    mocks.enqueueSessionStreams.mockRejectedValue(new Error("queue down"));
    await expect(
      requestSessionStreamForLog(storage, "user-1", { id: "log-1", planDayId: "d", stravaActivityId: "1" }, "link"),
    ).resolves.toBeUndefined();
    expect(mocks.warn).toHaveBeenCalled();
  });
});
