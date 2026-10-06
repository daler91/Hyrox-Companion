import { describe, expect, it, vi } from "vitest";

import { getChatHistoryUseCase } from "./chatHistory.usecase";

describe("getChatHistoryUseCase", () => {
  it("returns messages and computes next cursor", async () => {
    const ts = new Date("2026-01-01T00:00:00.000Z");
    const storage = {
      getChatMessages: vi.fn().mockResolvedValue([{ id: "m-1", timestamp: ts }]),
    };

    const result = await getChatHistoryUseCase(storage, { userId: "user-1", before: ts.toISOString(), beforeId: "m-2", limit: 1 });

    expect(storage.getChatMessages).toHaveBeenCalled();
    expect(result.nextCursor).toEqual({ timestamp: ts.toISOString(), id: "m-1" });
  });

  // CL56 (CODEBASE_ANALYSIS_2026-10-03): a cursor on a short page offered
  // "Load older messages" with nothing older to load.
  it("returns no cursor for a page shorter than the limit", async () => {
    const ts = new Date("2026-01-01T00:00:00.000Z");
    const storage = {
      getChatMessages: vi.fn().mockResolvedValue([{ id: "m-1", timestamp: ts }]),
    };

    const result = await getChatHistoryUseCase(storage, { userId: "user-1", limit: 2 });

    expect(result.nextCursor).toBeUndefined();
  });

  it("pages by 50 rows when no limit is given, and cursors a full page", async () => {
    const ts = new Date("2026-01-01T00:00:00.000Z");
    const page = Array.from({ length: 50 }, (_unused, index) => ({ id: `m-${index}`, timestamp: ts }));
    const storage = { getChatMessages: vi.fn().mockResolvedValue(page) };

    const result = await getChatHistoryUseCase(storage, { userId: "user-1" });

    expect(storage.getChatMessages).toHaveBeenCalledWith("user-1", expect.objectContaining({ limit: 50 }));
    expect(result.nextCursor).toEqual({ timestamp: ts.toISOString(), id: "m-0" });
  });

  it("reads a workout's own thread, or the general conversation without one", async () => {
    const storage = { getChatMessages: vi.fn().mockResolvedValue([]) };

    await getChatHistoryUseCase(storage, { userId: "user-1", focusPlanDayId: "day-1" });
    await getChatHistoryUseCase(storage, { userId: "user-1" });

    expect(storage.getChatMessages).toHaveBeenNthCalledWith(1, "user-1", expect.objectContaining({
      thread: { planDayId: "day-1", workoutLogId: undefined },
    }));
    expect(storage.getChatMessages).toHaveBeenNthCalledWith(2, "user-1", expect.objectContaining({
      thread: { planDayId: undefined, workoutLogId: undefined },
    }));
  });
});
