import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearRateLimitBuckets } from "../../routeUtils";
import plansRouter from "../plans";
import { createTestApp, TEST_USER_ID } from "./testUtils";

/**
 * CL15 (CODEBASE_ANALYSIS_2026-10-03): PATCH /api/v1/plans/days/:dayId/structure
 * saves the rows that follow a renumbered step with the blocks. Relinks sent
 * without structureBlocks are refused, as on PATCH /api/v1/workouts/:id; they
 * used to fall through to a blocks default of [] and clear the day's blocks.
 */

vi.mock("../../clerkAuth", async () => (await import("./testUtils")).mockClerkAuthModule());
vi.mock("../../types", async () => (await import("./testUtils")).mockTypesModule());
vi.mock("../../middleware/aibudget", async () =>
  (await import("./testUtils")).mockAiBudgetModule(),
);
const { replacePlanDayStructure } = vi.hoisted(() => ({ replacePlanDayStructure: vi.fn() }));
vi.mock("../../storage", () => ({ storage: { users: { getUser: vi.fn() } } }));
vi.mock("../../queue", () => ({
  queue: {
    send: vi.fn(() => Promise.resolve()),
    sendDebounced: vi.fn().mockResolvedValue(null),
  },
  sendJobNoRetry: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../services/planGenerationService", () => ({ createPendingPlan: vi.fn() }));
vi.mock("../../services/athleteFactsService", () => ({ moveStatementsToCard: vi.fn() }));
vi.mock("../../services/planService", () => ({
  importPlanFromCSV: vi.fn(),
  createSamplePlan: vi.fn(),
  updatePlanDayWithCleanup: vi.fn(),
  updatePlanDayStatus: vi.fn(),
  updatePlanDayRecordingMove: vi.fn(),
}));
vi.mock("../../services/workoutService", () => ({
  deriveMissingPlanDaySetsFromStructure: vi.fn(),
  reparsePlanDay: vi.fn(),
  reparsePlanDayFromImage: vi.fn(),
  replacePlanDayStructure,
}));

const STRUCTURE_PATH = "/api/v1/plans/days/day-1/structure";
// The rows of a removed step are unlinked; nothing is left to save.
const relink = {
  setId: "set-1",
  fromBlockId: "block-emom",
  fromStepNumber: 1,
  blockId: null,
  stepNumber: null,
};

describe("PATCH /api/v1/plans/days/:dayId/structure relinks (CL15)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimitBuckets();
    replacePlanDayStructure.mockResolvedValue({ exerciseSets: [], structureBlocks: [] });
  });

  it("saves the rows a block save relinks with the blocks, and rejects a malformed relink", async () => {
    const app = createTestApp(plansRouter);

    const response = await request(app)
      .patch(STRUCTURE_PATH)
      .send({ structureBlocks: [], relinks: [relink] });

    expect(response.status).toBe(200);
    expect(replacePlanDayStructure).toHaveBeenCalledWith("day-1", TEST_USER_ID, [], [relink]);

    const halfLink = await request(app)
      .patch(STRUCTURE_PATH)
      .send({ structureBlocks: [], relinks: [{ ...relink, blockId: "block-emom" }] });
    expect(halfLink.status).toBe(400);
    expect(replacePlanDayStructure).toHaveBeenCalledTimes(1);
  });

  it("rejects relinks sent without structureBlocks instead of clearing the day's blocks", async () => {
    const response = await request(createTestApp(plansRouter))
      .patch(STRUCTURE_PATH)
      .send({ relinks: [relink] });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(replacePlanDayStructure).not.toHaveBeenCalled();
  });

  // Older clients send no relinks; their bodies keep saving as before.
  it.each([
    ["an empty body", {}],
    ["empty relinks alone", { relinks: [] }],
    ["structureBlocks alone", { structureBlocks: [] }],
  ])("still saves %s, with blocks defaulting to []", async (_label, body) => {
    const response = await request(createTestApp(plansRouter)).patch(STRUCTURE_PATH).send(body);

    expect(response.status).toBe(200);
    expect(replacePlanDayStructure).toHaveBeenCalledWith("day-1", TEST_USER_ID, [], []);
  });
});
