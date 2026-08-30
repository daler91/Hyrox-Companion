import express, { Router } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestApp, resetRouteTestState } from "../__tests__/testUtils";
import { registerWorkoutCrudRoutes, uniqueIds } from "./workoutsCrud.routes";

describe("uniqueIds", () => {
  it("should return an empty array when given an empty array", () => {
    expect(uniqueIds([])).toEqual([]);
  });

  it("should return the same array if all elements are unique", () => {
    expect(uniqueIds(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("should remove duplicate ids", () => {
    expect(uniqueIds(["a", "b", "a", "c", "b"])).toEqual(["a", "b", "c"]);
  });

  it("should handle arrays with a single element", () => {
    expect(uniqueIds(["a"])).toEqual(["a"]);
  });

  it("should handle arrays with all identical elements", () => {
    expect(uniqueIds(["a", "a", "a"])).toEqual(["a"]);
  });

  it("should preserve the order of the first occurrence of each element", () => {
    expect(uniqueIds(["c", "a", "b", "c", "b", "a"])).toEqual(["c", "a", "b"]);
  });
});

// Mock the clerkAuth middleware to simulate authentication, mirroring
vi.mock("../../clerkAuth", async () => (await import("../__tests__/testUtils")).mockClerkAuthModule());

vi.mock("../../types", async () => (await import("../__tests__/testUtils")).mockTypesModule());

// deriveMissingWorkoutSetsFromStructure does real `db.select`/`db.transaction`
// work under the hood — mock it so the derive-branch test doesn't need a real
// Postgres connection.
vi.mock("../../services/workoutService", () => ({
  deriveMissingWorkoutSetsFromStructure: vi.fn(),
  updateWorkoutStructureBlockScore: vi.fn(),
}));

vi.mock("../../storage", async () =>
  (await import("../__tests__/testUtils")).mockStorageModule({
    workouts: ["listWorkoutLogs", "getExerciseSetsByWorkoutLog", "getWorkoutStructureByWorkoutLog", "getWorkoutLog", "mutateExerciseSetUpdate", "mutateExerciseSetAdd", "mutateExerciseSetDelete"],
  }),
);

import { deriveMissingWorkoutSetsFromStructure } from "../../services/workoutService";
import { storage } from "../../storage";

function buildApp(): express.Express {
  const router = Router();
  registerWorkoutCrudRoutes(router);
  return createTestApp(router);
}

describe("GET /api/v1/workouts/latest", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetAllMocks();
    await resetRouteTestState();
    app = buildApp();
  });

  it("returns 404 when the user has no workouts", async () => {
    vi.mocked(storage.workouts.listWorkoutLogs).mockResolvedValue([]);

    const response = await request(app).get("/api/v1/workouts/latest");

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: "No workouts found" });
    expect(storage.workouts.getExerciseSetsByWorkoutLog).not.toHaveBeenCalled();
  });

  it("returns the latest workout merged with its exercise sets and structure blocks", async () => {
    vi.mocked(storage.workouts.listWorkoutLogs).mockResolvedValue([
      { id: "log-1", focus: "Long Run" },
    ] as never);
    vi.mocked(storage.workouts.getExerciseSetsByWorkoutLog).mockResolvedValue([
      { id: "set-1", exerciseName: "running" },
    ] as never);
    vi.mocked(storage.workouts.getWorkoutStructureByWorkoutLog).mockResolvedValue([
      { id: "block-1" },
    ] as never);

    const response = await request(app).get("/api/v1/workouts/latest");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: "log-1",
      focus: "Long Run",
      exerciseSets: [{ id: "set-1", exerciseName: "running" }],
      structureBlocks: [{ id: "block-1" }],
    });
    expect(storage.workouts.getExerciseSetsByWorkoutLog).toHaveBeenCalledWith("log-1");
    expect(storage.workouts.getWorkoutStructureByWorkoutLog).toHaveBeenCalledWith("log-1");
  });
});

describe("GET /api/v1/workouts/:id", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetAllMocks();
    await resetRouteTestState();
    app = buildApp();
  });

  it("returns 404 for a workout the user doesn't own or that doesn't exist", async () => {
    vi.mocked(storage.workouts.getWorkoutLog).mockResolvedValue(undefined);

    const response = await request(app).get("/api/v1/workouts/missing-id");

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: "Workout not found" });
  });

  it("returns exercise sets as-is when they already exist", async () => {
    vi.mocked(storage.workouts.getWorkoutLog).mockResolvedValue({ id: "log-1" } as never);
    vi.mocked(storage.workouts.getExerciseSetsByWorkoutLog).mockResolvedValue([
      { id: "set-1" },
    ] as never);
    vi.mocked(storage.workouts.getWorkoutStructureByWorkoutLog).mockResolvedValue([
      { id: "block-1" },
    ] as never);

    const response = await request(app).get("/api/v1/workouts/log-1");

    expect(response.status).toBe(200);
    expect(response.body.exerciseSets).toEqual([{ id: "set-1" }]);
    expect(deriveMissingWorkoutSetsFromStructure).not.toHaveBeenCalled();
  });

  it("derives missing exercise sets from structure blocks and re-fetches when none exist yet", async () => {
    vi.mocked(storage.workouts.getWorkoutLog).mockResolvedValue({ id: "log-1" } as never);
    // First read: no exercise sets yet but structure blocks exist → derive branch.
    // Second read (post-derive): the derived sets are now present.
    vi.mocked(storage.workouts.getExerciseSetsByWorkoutLog)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ id: "derived-set-1" }] as never);
    vi.mocked(storage.workouts.getWorkoutStructureByWorkoutLog).mockResolvedValue([
      { id: "block-1" },
    ] as never);
    vi.mocked(deriveMissingWorkoutSetsFromStructure).mockResolvedValue(1);

    const response = await request(app).get("/api/v1/workouts/log-1");

    expect(response.status).toBe(200);
    expect(response.body.exerciseSets).toEqual([{ id: "derived-set-1" }]);
    expect(deriveMissingWorkoutSetsFromStructure).toHaveBeenCalledWith("log-1", "test_user_id");
    expect(storage.workouts.getExerciseSetsByWorkoutLog).toHaveBeenCalledTimes(2);
  });
});
