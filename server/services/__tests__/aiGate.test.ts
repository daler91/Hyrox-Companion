import { beforeEach, describe, expect, it, vi } from "vitest";

const envState = vi.hoisted(() => ({ AI_FEATURES_ENABLED: "true" }));

vi.mock("../../env", () => ({ env: envState }));
vi.mock("../../storage", () => ({ storage: { users: { getUser: vi.fn() } } }));
vi.mock("../aiUsageService", () => ({ checkAiBudget: vi.fn() }));

import { storage } from "../../storage";
import { resolveAiBlocker } from "../aiGate";
import { checkAiBudget } from "../aiUsageService";

const getUser = vi.mocked(storage.users.getUser);
const mockBudget = vi.mocked(checkAiBudget);

/**
 * The one AI gate behind the nightly coach insights, nutrition insights,
 * overview analysis and the race predictor (R5). The first check that blocks
 * is the reason, and the checks after it do not run.
 */
describe("resolveAiBlocker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envState.AI_FEATURES_ENABLED = "true";
    getUser.mockResolvedValue({ aiCoachEnabled: true } as never);
    mockBudget.mockResolvedValue({ allowed: true } as never);
  });

  it("returns null when AI is on, consented and within budget", async () => {
    await expect(resolveAiBlocker("user-1")).resolves.toBeNull();
    expect(getUser).toHaveBeenCalledWith("user-1");
    expect(mockBudget).toHaveBeenCalledWith("user-1");
  });

  it("reports ai_disabled without reading the user or the budget", async () => {
    envState.AI_FEATURES_ENABLED = "false";

    await expect(resolveAiBlocker("user-1")).resolves.toBe("ai_disabled");
    expect(getUser).not.toHaveBeenCalled();
    expect(mockBudget).not.toHaveBeenCalled();
  });

  it.each([
    ["consent off", { aiCoachEnabled: false }],
    ["consent unset", { aiCoachEnabled: null }],
    ["no user", undefined],
  ])("reports ai_consent_off without reading the budget (%s)", async (_label, user) => {
    getUser.mockResolvedValue(user as never);

    await expect(resolveAiBlocker("user-1")).resolves.toBe("ai_consent_off");
    expect(mockBudget).not.toHaveBeenCalled();
  });

  it("reports ai_budget_exceeded when the budget is spent", async () => {
    mockBudget.mockResolvedValue({ allowed: false } as never);

    await expect(resolveAiBlocker("user-1")).resolves.toBe("ai_budget_exceeded");
  });

  it("throws when the budget cannot be confirmed", async () => {
    mockBudget.mockRejectedValue(new Error("db down"));

    await expect(resolveAiBlocker("user-1")).rejects.toThrow("db down");
  });

  it("uses a user the caller already holds instead of reading it", async () => {
    await expect(
      resolveAiBlocker("user-1", () => Promise.resolve({ aiCoachEnabled: false })),
    ).resolves.toBe("ai_consent_off");
    expect(getUser).not.toHaveBeenCalled();
  });
});
