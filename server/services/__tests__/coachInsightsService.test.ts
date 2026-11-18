import { beforeEach, describe, expect, it, vi } from "vitest";

import { chatWithCoach } from "../../gemini/index";
import { storage } from "../../storage";
import { buildAIContext } from "../aiContextService";
import { checkAiBudget } from "../aiUsageService";
import { generateCoachInsightsIfAllowed } from "../coachInsightsService";

vi.mock("../../storage", () => ({ storage: { users: { getUser: vi.fn() } } }));
vi.mock("../../gemini/index", () => ({ chatWithCoach: vi.fn() }));
vi.mock("../../ai/providers/config", () => ({ getTextAiConfig: vi.fn(() => ({ provider: "gemini" })) }));
vi.mock("../aiContextService", () => ({ buildAIContext: vi.fn() }));
vi.mock("../aiUsageService", () => ({ checkAiBudget: vi.fn() }));
vi.mock("../ragRetrieval", () => ({ sanitizeRagInfo: vi.fn((info: unknown) => info) }));
vi.mock("../../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

/**
 * The nightly coach-insights refresh gates itself on consent and the AI
 * budget. When the budget lookup fails it throws instead of calling the model:
 * the recompute job fails, releases its daily claim and is retried
 * (processRecomputeAnalyticsJob). It used to log the failure and make the call.
 */
describe("generateCoachInsightsIfAllowed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.users.getUser).mockResolvedValue({ aiCoachEnabled: true } as never);
  });

  it("skips without calling the model when the athlete is over budget", async () => {
    vi.mocked(checkAiBudget).mockResolvedValue({ allowed: false } as never);

    await expect(generateCoachInsightsIfAllowed("user-1")).resolves.toEqual({
      ok: false,
      reason: "ai_budget_exceeded",
    });
    expect(buildAIContext).not.toHaveBeenCalled();
    expect(chatWithCoach).not.toHaveBeenCalled();
  });

  it("throws without calling the model when the budget cannot be confirmed", async () => {
    vi.mocked(checkAiBudget).mockRejectedValue(new Error("db down"));

    await expect(generateCoachInsightsIfAllowed("user-1")).rejects.toThrow("db down");
    expect(buildAIContext).not.toHaveBeenCalled();
    expect(chatWithCoach).not.toHaveBeenCalled();
  });
});
