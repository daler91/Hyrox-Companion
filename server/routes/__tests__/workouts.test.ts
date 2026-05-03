import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearRateLimitBuckets } from "../../routeUtils";
import workoutsRouter from "../workouts/index";
import { createTestApp } from "./testUtils";

vi.mock("../../clerkAuth", () => ({
  isAuthenticated: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.auth = { userId: "test_user_id" };
    next();
  },
}));

vi.mock("../../types", () => ({
  getUserId: () => "test_user_id",
}));

vi.mock("../../middleware/aibudget", () => ({
  aiBudgetCheck: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../storage", () => ({
  storage: {
    workouts: {
      listWorkoutLogs: vi.fn(),
      getExerciseSetsByWorkoutLog: vi.fn(),
      getWorkoutStructureByWorkoutLog: vi.fn(),
      getWorkoutLog: vi.fn(),
      deleteWorkoutLog: vi.fn(),
      updateWorkoutLog: vi.fn(),
    },
    timeline: {
      getTimeline: vi.fn(),
    },
    users: {
      getUser: vi.fn(),
      getCustomExercises: vi.fn(),
    },
  },
}));

vi.mock("../../queue", () => ({ queue: { send: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("../../services/workoutUseCases", () => ({
  createWorkout: vi.fn(),
  updateWorkoutUseCase: vi.fn(),
}));
vi.mock("../../services/workoutService", () => ({
  reparseWorkout: vi.fn(),
  reparseWorkoutFromImage: vi.fn(),
  batchReparseWorkouts: vi.fn(),
  autoHydrateExerciseSetsFromTextIfNeeded: vi.fn(),
}));

vi.mock("../../services/structuredExerciseHealth", () => ({ incrementStructuredExerciseCounter: vi.fn().mockResolvedValue(undefined) }));

vi.mock("../../services/exportService", () => ({
  generateCSV: vi.fn(),
  generateJSON: vi.fn(),
}));

type ContractCase = {
  name: string;
  method: "get" | "post" | "patch" | "delete";
  path: string;
  body?: Record<string, unknown>;
  expectedStatus: number;
  expectedFields: string[];
};

const endpointFixtureCases: ContractCase[] = [
  { name: "workouts list", method: "get", path: "/api/v1/workouts", expectedStatus: 200, expectedFields: ["0.id"] },
    { name: "workout update", method: "patch", path: "/api/v1/workouts/workout-1", body: { notes: "updated" }, expectedStatus: 200, expectedFields: ["id", "notes"] },
  { name: "workout delete", method: "delete", path: "/api/v1/workouts/workout-1", expectedStatus: 200, expectedFields: ["success"] },
  { name: "workout reparse", method: "post", path: "/api/v1/workouts/workout-1/reparse", body: {}, expectedStatus: 200, expectedFields: ["saved", "setCount", "exercises"] },
  { name: "timeline list", method: "get", path: "/api/v1/timeline", expectedStatus: 200, expectedFields: ["0.id", "0.type"] },
  { name: "export json", method: "get", path: "/api/v1/export?format=json", expectedStatus: 200, expectedFields: ["exportedAt", "workouts"] },
];

describe("Workouts Routes", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    clearRateLimitBuckets();
    app = createTestApp(workoutsRouter);

    const [{ storage }, { createWorkout, updateWorkoutUseCase }, { reparseWorkout }, { generateCSV, generateJSON }] = await Promise.all([
      import("../../storage"),
      import("../../services/workoutUseCases"),
      import("../../services/workoutService"),
      import("../../services/exportService"),
    ]);

    vi.mocked(storage.workouts.listWorkoutLogs).mockResolvedValue([{ id: "workout-1", userId: "test_user_id", date: "2026-01-02", notes: "steady" }] as never);
    vi.mocked(storage.workouts.getWorkoutLog).mockResolvedValue({ id: "workout-1", userId: "test_user_id", mainWorkout: "Engine" } as never);
    vi.mocked(storage.workouts.getExerciseSetsByWorkoutLog).mockResolvedValue([] as never);
    vi.mocked(storage.workouts.getWorkoutStructureByWorkoutLog).mockResolvedValue([] as never);
    vi.mocked(storage.workouts.deleteWorkoutLog).mockResolvedValue(true);
    vi.mocked(storage.workouts.updateWorkoutLog).mockResolvedValue({ id: "workout-1", notes: "updated" } as never);
    vi.mocked(storage.timeline.getTimeline).mockResolvedValue([{ id: "timeline-1", type: "workout", date: "2026-01-02" }] as never);
    vi.mocked(storage.users.getUser).mockResolvedValue({ id: "test_user_id", weightUnit: "kg" } as never);
    vi.mocked(storage.users.getCustomExercises).mockResolvedValue([] as never);

    vi.mocked(createWorkout).mockResolvedValue({ id: "created-1", date: "2026-01-02" } as never);
    vi.mocked(updateWorkoutUseCase).mockResolvedValue({ id: "workout-1", notes: "updated" } as never);
    vi.mocked(reparseWorkout).mockResolvedValue({ exercises: [{ exerciseName: "row" }], setCount: 1 } as never);

    vi.mocked(generateCSV).mockResolvedValue("id,date\nworkout-1,2026-01-02");
    vi.mocked(generateJSON).mockResolvedValue({ exportedAt: "2026-01-02T10:00:00.000Z", workouts: [{ id: "workout-1" }] } as never);
  });

  it("keeps endpoint contract parity for CRUD/reparse/timeline/export", async () => {
    for (const testCase of endpointFixtureCases) {
      const started = performance.now();
      let req = request(app)[testCase.method](testCase.path);
      if (testCase.body) req = req.send(testCase.body);
      const response = await req;
      const elapsedMs = Number((performance.now() - started).toFixed(2));
      console.info(`[route-contract] ${testCase.name} ${testCase.method.toUpperCase()} ${testCase.path} => ${response.status} in ${elapsedMs}ms`);

      expect(response.status, testCase.name).toBe(testCase.expectedStatus);
      for (const fieldPath of testCase.expectedFields) {
        expect(response.body, `${testCase.name} field ${fieldPath}`).toHaveProperty(fieldPath);
      }
    }
  });

  it("preserves shared error contract for key regression paths", async () => {
    const { storage } = await import("../../storage");
    vi.mocked(storage.workouts.listWorkoutLogs).mockRejectedValueOnce(new Error("db down"));
    vi.mocked(storage.workouts.getWorkoutLog).mockResolvedValueOnce(null as never);

    const listResponse = await request(app).get("/api/v1/workouts");
    expect(listResponse.status).toBe(500);
    expect(listResponse.body).toEqual({ error: "Internal Server Error", code: "INTERNAL_SERVER_ERROR" });

    const reparseNotFound = await request(app).post("/api/v1/workouts/missing/reparse").send({});
    expect(reparseNotFound.status).toBe(404);
    expect(reparseNotFound.body).toEqual({ error: "Workout not found", code: "NOT_FOUND" });
  });


  it("prefers structured exercise_sets for workout reads when both legacy text and sets exist", async () => {
    const { storage } = await import("../../storage");
    vi.mocked(storage.workouts.getWorkoutLog).mockResolvedValueOnce({
      id: "workout-legacy-mixed",
      userId: "test_user_id",
      mainWorkout: "Back squat 5x5 @ 100kg",
    } as never);
    vi.mocked(storage.workouts.getExerciseSetsByWorkoutLog).mockResolvedValueOnce([
      { id: "set-1", workoutLogId: "workout-legacy-mixed", exerciseName: "Back Squat", reps: 5, weight: "110", setNumber: 1, sortOrder: 0 },
    ] as never);

    const response = await request(app).get("/api/v1/workouts/workout-legacy-mixed");

    expect(response.status).toBe(200);
    expect(response.body.mainWorkout).toBe("Back squat 5x5 @ 100kg");
    expect(response.body.exerciseSets).toHaveLength(1);
    expect(response.body.exerciseSets[0].exerciseName).toBe("Back Squat");
  });

  it("text-only patch is rejected and parse remains explicit", async () => {
    const [{ storage }, { updateWorkoutUseCase }, { reparseWorkout }] = await Promise.all([
      import("../../storage"),
      import("../../services/workoutUseCases"),
      import("../../services/workoutService"),
    ]);
    vi.mocked(updateWorkoutUseCase).mockResolvedValueOnce({ id: "workout-1", notes: "edited text" } as never);

    const patchResponse = await request(app).patch("/api/v1/workouts/workout-1").send({ mainWorkout: "edited legacy text" });
    expect(patchResponse.status).toBe(422);
    expect(storage.workouts.getExerciseSetsByWorkoutLog).not.toHaveBeenCalledWith("workout-1");
    expect(reparseWorkout).not.toHaveBeenCalled();

    const reparseResponse = await request(app).post("/api/v1/workouts/workout-1/reparse").send({});
    expect(reparseResponse.status).toBe(200);
    expect(reparseWorkout).toHaveBeenCalledTimes(1);
  });

  it("lazy hydration on repeated reads is idempotent (no duplicate set creation)", async () => {
    const [{ storage }, { autoHydrateExerciseSetsFromTextIfNeeded }] = await Promise.all([
      import("../../storage"),
      import("../../services/workoutService"),
    ]);

    vi.mocked(storage.workouts.getExerciseSetsByWorkoutLog)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ id: "set-1", workoutLogId: "workout-1", exerciseName: "Run", setNumber: 1, sortOrder: 0 }] as never)
      .mockResolvedValueOnce([{ id: "set-1", workoutLogId: "workout-1", exerciseName: "Run", setNumber: 1, sortOrder: 0 }] as never);

    await request(app).get("/api/v1/workouts/workout-1");
    await request(app).get("/api/v1/workouts/workout-1");

    expect(autoHydrateExerciseSetsFromTextIfNeeded).toHaveBeenCalledTimes(1);
  });
  

  it("rejects text-only workout create/update on non-legacy routes", async () => {
    const createRes = await request(app).post("/api/v1/workouts").send({ date: "2026-01-02", focus: "Conditioning", mainWorkout: "just text" });
    expect(createRes.status).toBe(422);
    expect(createRes.body.code).toBe("STRUCTURED_ROWS_REQUIRED");

    const updateRes = await request(app).patch("/api/v1/workouts/workout-1").send({ accessory: "also text-only" });
    expect(updateRes.status).toBe(422);
    expect(updateRes.body.code).toBe("STRUCTURED_ROWS_REQUIRED");
  });

  it("accepts text/photo parse when rows are persisted (write-through)", async () => {
    const { reparseWorkout, reparseWorkoutFromImage } = await import("../../services/workoutService");
    vi.mocked(reparseWorkout).mockResolvedValueOnce({ exercises: [{ exerciseName: "row" }], setCount: 2 } as never);
    vi.mocked(reparseWorkoutFromImage).mockResolvedValueOnce({ exercises: [{ exerciseName: "wall ball" }], setCount: 1 } as never);

    const textRes = await request(app).post("/api/v1/workouts/workout-1/reparse").send({});
    expect(textRes.status).toBe(200);
    expect(textRes.body.saved).toBe(true);
    expect(textRes.body.setCount).toBeGreaterThan(0);

    const photoRes = await request(app).post("/api/v1/workouts/workout-1/reparse-from-image").send({ imageBase64: "Zm9v", mimeType: "image/png" });
    expect(photoRes.status).toBe(200);
    expect(photoRes.body.saved).toBe(true);
    expect(photoRes.body.setCount).toBeGreaterThan(0);
  });


  it("does not persist prescribed text overrides when parse write-through fails", async () => {
    const [{ storage }, { reparseWorkout }] = await Promise.all([
      import("../../storage"),
      import("../../services/workoutService"),
    ]);
    vi.mocked(reparseWorkout).mockResolvedValueOnce(null as never);

    const response = await request(app)
      .post("/api/v1/workouts/workout-1/reparse")
      .send({ prescribedMainWorkout: "new prescribed text" });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe("PARSE_WRITE_THROUGH_REQUIRED");
    expect(storage.workouts.updateWorkoutLog).not.toHaveBeenCalledWith(
      "workout-1",
      expect.objectContaining({ prescribedMainWorkout: "new prescribed text" }),
      "test_user_id",
    );
  });
it("captures representative high-frequency endpoint timings", async () => {
    const samples = 6;
    const timings: Array<{ endpoint: string; elapsedMs: number }> = [];

    for (let i = 0; i < samples; i++) {
      const workoutStart = performance.now();
      const workoutRes = await request(app).get("/api/v1/workouts");
      timings.push({ endpoint: "GET /api/v1/workouts", elapsedMs: Number((performance.now() - workoutStart).toFixed(2)) });
      expect(workoutRes.status).toBe(200);

      const timelineStart = performance.now();
      const timelineRes = await request(app).get("/api/v1/timeline");
      timings.push({ endpoint: "GET /api/v1/timeline", elapsedMs: Number((performance.now() - timelineStart).toFixed(2)) });
      expect(timelineRes.status).toBe(200);
    }

    const grouped = timings.reduce<Record<string, number[]>>((acc, entry) => {
      acc[entry.endpoint] ??= [];
      acc[entry.endpoint].push(entry.elapsedMs);
      return acc;
    }, {});

    for (const [endpoint, values] of Object.entries(grouped)) {
      const avgMs = Number((values.reduce((sum, current) => sum + current, 0) / values.length).toFixed(2));
      const maxMs = Math.max(...values);
      console.info(`[perf-fixture] ${endpoint} samples=${values.length} avg=${avgMs}ms max=${maxMs}ms`);
      expect(avgMs).toBeLessThan(250);
    }
  });
});
