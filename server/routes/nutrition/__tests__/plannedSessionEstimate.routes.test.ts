import { Router } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearRateLimitBuckets } from "../../../routeUtils";
import { getPlannedSessionEstimate } from "../../../services/sessionEstimate/plannedSessionEstimate";
import { storage } from "../../../storage";
import { createTestApp, TEST_USER_ID } from "../../__tests__/testUtils";
import { registerNutritionSummaryRoutes } from "../nutritionSummary.routes";

vi.mock("../../../clerkAuth", async () =>
  (await import("../../__tests__/testUtils")).mockClerkAuthModule(),
);
vi.mock("../../../types", async () =>
  (await import("../../__tests__/testUtils")).mockTypesModule(),
);
vi.mock("../../../services/sessionEstimate/plannedSessionEstimate", () => ({
  getPlannedSessionEstimate: vi.fn(),
}));
// The REAL consent middleware is left in place (nutrition.routes.test.ts
// stubs it), so a route that still mounted it would answer 403 here.
vi.mock("../../../storage", async () =>
  (await import("../../__tests__/testUtils")).mockStorageModule({ users: ["getUser"] }),
);

// C28 (CODEBASE_ANALYSIS_2026-10-03): the estimate's deterministic and
// pace-personalised layers are not AI, and its AI nudge checks consent inline,
// so the route must not 403 an athlete who has AI coaching switched off.
describe("GET /api/v1/nutrition/planned-session-estimate/:planDayId (C28)", () => {
  const estimate = {
    planDayId: "pd1",
    durationMin: 62,
    rpe: 6,
    rationale: null,
    source: "structure",
    refined: false,
  };

  function buildApp() {
    const router = Router();
    registerNutritionSummaryRoutes(router);
    return createTestApp(router);
  }

  beforeEach(() => {
    vi.resetAllMocks();
    clearRateLimitBuckets();
    vi.mocked(storage.users.getUser).mockResolvedValue({
      id: TEST_USER_ID,
      aiCoachEnabled: false,
    } as never);
  });

  it("serves the estimate to an athlete with AI coaching off", async () => {
    vi.mocked(getPlannedSessionEstimate).mockResolvedValue(estimate as never);

    const res = await request(buildApp()).get("/api/v1/nutrition/planned-session-estimate/pd1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(estimate);
    expect(getPlannedSessionEstimate).toHaveBeenCalledWith("pd1", TEST_USER_ID);
  });

  it("still 404s a plan day the athlete does not own", async () => {
    vi.mocked(getPlannedSessionEstimate).mockResolvedValue(null);

    const res = await request(buildApp()).get(
      "/api/v1/nutrition/planned-session-estimate/someone-elses",
    );

    expect(res.status).toBe(404);
  });
});
