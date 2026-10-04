import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { storage } from "../../storage";
import { registerWorkoutMafRoutes } from "../workouts/workoutsMaf.routes";
import { TEST_USER_ID } from "./testUtils";

vi.mock("../../clerkAuth", async () => (await import("./testUtils")).mockClerkAuthModule());

vi.mock("../../types", async () => (await import("./testUtils")).mockTypesModule());

vi.mock("../../routeUtils", () => ({
  rateLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  asyncHandler:
    (fn: (req: unknown, res: unknown, next: unknown) => Promise<unknown>) =>
    (req: unknown, res: unknown, next: (err?: unknown) => void) =>
      Promise.resolve(fn(req, res, next)).catch(next),
  sendNotFound: vi.fn(),
  validateBody: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Only the GET history route is under test; the mutation routes are not mounted.
vi.mock("../_helpers/protectedRouteBuilder", () => ({
  protectedDelete: vi.fn(),
  protectedPatch: vi.fn(),
  protectedPost: vi.fn(),
}));

vi.mock("../../services/mafTestService", () => ({
  recordMafTestFromWorkout: vi.fn(),
  updateMafTestForWorkout: vi.fn(),
}));

vi.mock("../../storage", async () =>
  (await import("./testUtils")).mockStorageModule({
    mafTests: ["listTestResults", "listWorkoutAnalysis", "getWorkoutDates"],
  }),
);

describe("GET /api/v1/maf-tests", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    const router = express.Router();
    registerWorkoutMafRoutes(router);
    app.use(router);
  });

  it("returns each tagged workout's date so the charts can date tests by the run (CL4)", async () => {
    const tests = [
      { id: "t1", conditions: { source: "tagged_workout", workoutLogId: "w1" } },
      { id: "t2", conditions: { source: "tagged_workout", workoutLogId: "w2" } },
      { id: "t-untagged", conditions: null },
    ];
    const analysis = [
      { id: "a1", workoutLogId: "w1" },
      { id: "a-orphan", workoutLogId: "w3" },
      { id: "a-deleted", workoutLogId: null },
    ];
    const workoutDates = { w1: "2026-01-10", w2: "2026-03-14", w3: "2026-05-09" };
    vi.mocked(storage.mafTests.listTestResults).mockResolvedValue(tests as never);
    vi.mocked(storage.mafTests.listWorkoutAnalysis).mockResolvedValue(analysis as never);
    vi.mocked(storage.mafTests.getWorkoutDates).mockResolvedValue(workoutDates);

    const response = await request(app).get("/api/v1/maf-tests");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ tests, analysis, workoutDates });
    expect(storage.mafTests.getWorkoutDates).toHaveBeenCalledWith(TEST_USER_ID, ["w1", "w2", "w3"]);
  });
});
