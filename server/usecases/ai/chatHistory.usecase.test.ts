import { describe, expect, it, vi } from "vitest";

import { getChatHistoryUseCase } from "./chatHistory.usecase";

describe("getChatHistoryUseCase", () => {
  it("returns messages and computes next cursor", async () => {
    const ts = new Date("2026-01-01T00:00:00.000Z");
    const storage = {
      getChatMessages: vi.fn().mockResolvedValue([{ id: "m-1", timestamp: ts }]),
    };

    const result = await getChatHistoryUseCase(storage, { userId: "user-1", before: ts.toISOString(), beforeId: "m-2", limit: 10 });

    expect(storage.getChatMessages).toHaveBeenCalled();
    expect(result.nextCursor).toEqual({ timestamp: ts.toISOString(), id: "m-1" });
  });
});
