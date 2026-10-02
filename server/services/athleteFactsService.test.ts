import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { storage } from "../storage";
import { moveStatementsToCard } from "./athleteFactsService";

vi.mock("../storage", () => ({
  storage: {
    users: { getUser: vi.fn(), updateUserPreferences: vi.fn() },
    athleteFacts: { seed: vi.fn() },
  },
}));

describe("moveStatementsToCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("puts each sentence on the card as a constraint, due for review in 90 days, then drops the older note", async () => {
    vi.mocked(storage.users).getUser.mockResolvedValue({ userTimezone: "UTC", trainingConstraints: "Bad left knee" } as never);
    vi.mocked(storage.athleteFacts.seed).mockResolvedValue({ added: 2, skipped: 0 });

    const result = await moveStatementsToCard("user-1", "Bad left knee. No sled at my gym.", "plan_generation");

    expect(result).toEqual({ added: 2, skipped: 0 });
    expect(storage.athleteFacts.seed).toHaveBeenCalledWith(
      "user-1",
      [
        { fact: "Bad left knee.", category: "constraint", source: "plan_generation" },
        { fact: "No sled at my gym.", category: "constraint", source: "plan_generation" },
      ],
      "2026-12-30",
    );
    expect(vi.mocked(storage.users).updateUserPreferences.mock.calls).toContainEqual(["user-1", { trainingConstraints: null }]);
  });

  it("keeps the older note while some of it didn't fit on the card", async () => {
    vi.mocked(storage.users).getUser.mockResolvedValue({ trainingConstraints: "Bad left knee" } as never);
    vi.mocked(storage.athleteFacts.seed).mockResolvedValue({ added: 0, skipped: 1 });

    await moveStatementsToCard("user-1", "Bad left knee", "plan_generation");

    expect(vi.mocked(storage.users).updateUserPreferences.mock.calls).toEqual([]);
  });

  it("leaves preferences alone for an athlete with no older note", async () => {
    vi.mocked(storage.users).getUser.mockResolvedValue({ trainingConstraints: null } as never);
    vi.mocked(storage.athleteFacts.seed).mockResolvedValue({ added: 0, skipped: 0 });

    await moveStatementsToCard("user-1", "", "plan_generation");

    expect(storage.athleteFacts.seed).toHaveBeenCalledWith("user-1", [], expect.any(String));
    expect(vi.mocked(storage.users).updateUserPreferences.mock.calls).toEqual([]);
  });
});
