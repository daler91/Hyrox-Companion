import type express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getLatestWorkoutDate, regenerateAndStoreRacePrediction } from "../../services/analyticsPersistence";
import { storage } from "../../storage";
import analyticsRouter from "../analytics";
import { createTestApp, resetRouteTestState } from "./testUtils";

vi.mock("../../clerkAuth", () => ({
  isAuthenticated: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.auth = { userId: "test_user_id" };
    next();
  },
}));

vi.mock("../../types", () => ({ getUserId: () => "test_user_id" }));

vi.mock("../../db", () => ({ db: { execute: vi.fn() } }));

vi.mock("../../storage", () => ({
  storage: {
    analyticsResults: { get: vi.fn() },
    workouts: { listWorkoutLogs: vi.fn().mockResolvedValue([]) },
    analytics: {},
    users: { getUser: vi.fn() },
  },
}));

// Mock the persistence service so the route test never loads the AI/db chain and
// we can assert whether a fresh regeneration was triggered. computeStale uses
// the real (pure) implementation.
vi.mock("../../services/analyticsPersistence", async () => {
  const staleness = await vi.importActual<typeof import("../../services/analyticsStaleness")>(
    "../../services/analyticsStaleness",
  );
  return {
    computeStale: staleness.computeStale,
    getLatestWorkoutDate: vi.fn().mockResolvedValue(null),
    regenerateAndStoreRacePrediction: vi.fn(),
  };
});

// Minimal but shape-valid stored prediction payload.
const STORED_PAYLOAD = {
  totalFinishSeconds: 4200,
  segments: [],
  transitionSeconds: 300,
  aiUsed: false,
  overallConfidence: "medium",
  narrative: null,
  division: "open",
  gender: null,
  genderAssumed: true,
  ageGroup: null,
  ageGroupAssumed: true,
  percentile: null,
  dataCompleteness: { stationsWithData: 4, totalStations: 8, hasRunData: true },
  generatedAt: "2026-06-01T00:00:00.000Z",
};

describe("GET /api/v1/race-prediction (stored-first)", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetRouteTestState();
    app = createTestApp(analyticsRouter);
  });

  it("returns the stored prediction (flagged stale) without regenerating", async () => {
    vi.mocked(storage.analyticsResults.get).mockResolvedValue({ // NOSONAR partial mock of the full AnalyticsResult row; only these fields are read here
      payload: STORED_PAYLOAD,
      generatedAt: new Date("2026-06-01T00:00:00.000Z"),
      lastWorkoutDateAtGeneration: "2026-06-01",
    } as never);
    vi.mocked(getLatestWorkoutDate).mockResolvedValue("2026-06-03"); // newer → stale

    const res = await request(app).get("/api/v1/race-prediction");

    expect(res.status).toBe(200);
    expect(res.body.totalFinishSeconds).toBe(4200);
    expect(res.body.stale).toBe(true);
    expect(res.body.generatedAt).toBe("2026-06-01T00:00:00.000Z");
    expect(regenerateAndStoreRacePrediction).not.toHaveBeenCalled();
  });

  it("regenerates and persists when ?refresh=1 (never reads the stored row)", async () => {
    vi.mocked(regenerateAndStoreRacePrediction).mockResolvedValue({ // NOSONAR partial mock of the regeneration result
      ...STORED_PAYLOAD,
      totalFinishSeconds: 3900,
      generatedAt: "2026-06-05T00:00:00.000Z",
    } as never);

    const res = await request(app).get("/api/v1/race-prediction?refresh=1");

    expect(res.status).toBe(200);
    expect(res.body.totalFinishSeconds).toBe(3900);
    expect(res.body.stale).toBe(false);
    expect(regenerateAndStoreRacePrediction).toHaveBeenCalledTimes(1);
    expect(storage.analyticsResults.get).not.toHaveBeenCalled();
  });

  it("regenerates when no stored prediction exists yet", async () => {
    vi.mocked(storage.analyticsResults.get).mockResolvedValue(undefined);
    vi.mocked(regenerateAndStoreRacePrediction).mockResolvedValue({ // NOSONAR partial mock of the regeneration result
      ...STORED_PAYLOAD,
      totalFinishSeconds: 4100,
      generatedAt: "2026-06-05T00:00:00.000Z",
    } as never);

    const res = await request(app).get("/api/v1/race-prediction");

    expect(res.status).toBe(200);
    expect(res.body.totalFinishSeconds).toBe(4100);
    expect(res.body.stale).toBe(false);
    expect(regenerateAndStoreRacePrediction).toHaveBeenCalledTimes(1);
  });
});
