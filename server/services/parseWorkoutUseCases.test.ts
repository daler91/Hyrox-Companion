import { beforeEach, describe, expect, it, vi } from "vitest";

import { storage } from "../storage";
import { batchReparseWorkoutsUseCase, reparseWorkoutFromImageUseCase, reparseWorkoutUseCase } from "./parseWorkoutUseCases";
import { batchReparseWorkouts, reparseWorkout, reparseWorkoutFromImage } from "./workoutService";

vi.mock("../storage", () => ({
  storage: {
    workouts: { getWorkoutLog: vi.fn(), updateWorkoutLog: vi.fn() },
    users: { getUser: vi.fn(), getCustomExercises: vi.fn() },
  },
}));
vi.mock("./structuredExerciseHealth", () => ({
  incrementStructuredExerciseCounter: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./workoutService", () => ({
  reparseWorkout: vi.fn(),
  reparseWorkoutFromImage: vi.fn(),
  batchReparseWorkouts: vi.fn(),
}));

const getWorkoutLog = vi.mocked(storage.workouts.getWorkoutLog);
const updateWorkoutLog = vi.mocked(storage.workouts.updateWorkoutLog);
const getUser = vi.mocked(storage.users.getUser);
const getCustomExercises = vi.mocked(storage.users.getCustomExercises);
const mockReparse = vi.mocked(reparseWorkout);
const mockReparseImage = vi.mocked(reparseWorkoutFromImage);
const mockBatch = vi.mocked(batchReparseWorkouts);

const WORKOUT = { id: "w1", mainWorkout: "5x5 squat", accessory: null, prescribedMainWorkout: null, prescribedAccessory: null };
const PARSE_OK = { exercises: [{ name: "squat" }], setCount: 5, saved: true, rejectedCount: 0, rejectionReasons: [], fallbackUsed: false };
const OK_RESPONSE = { exercises: PARSE_OK.exercises, saved: true, setCount: 5, rejectedCount: 0, rejectionReasons: [] };

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ weightUnit: "kg", distanceUnit: "km" } as never);
  getCustomExercises.mockResolvedValue([] as never);
  updateWorkoutLog.mockResolvedValue(undefined);
});

describe("reparseWorkoutUseCase", () => {
  it("returns not_found when the workout is missing", async () => {
    getWorkoutLog.mockResolvedValue(undefined);
    const outcome = await reparseWorkoutUseCase({ userId: "u1", workoutId: "missing", payload: {} });
    expect(outcome).toEqual({ status: "not_found" });
    expect(mockReparse).not.toHaveBeenCalled();
  });

  it("returns parse_failed and does NOT persist overrides when the parse yields no rows", async () => {
    getWorkoutLog.mockResolvedValue(WORKOUT as never);
    mockReparse.mockResolvedValue(null);
    const outcome = await reparseWorkoutUseCase({ userId: "u1", workoutId: "w1", payload: { prescribedMainWorkout: "new text" } });
    expect(outcome).toEqual({ status: "parse_failed" });
    expect(updateWorkoutLog).not.toHaveBeenCalled();
  });

  it("treats setCount 0 as parse_failed", async () => {
    getWorkoutLog.mockResolvedValue(WORKOUT as never);
    mockReparse.mockResolvedValue({ ...PARSE_OK, setCount: 0 } as never);
    const outcome = await reparseWorkoutUseCase({ userId: "u1", workoutId: "w1", payload: {} });
    expect(outcome.status).toBe("parse_failed");
  });

  it("persists prescribed-text overrides only on success and reparses the override text", async () => {
    getWorkoutLog.mockResolvedValue(WORKOUT as never);
    mockReparse.mockResolvedValue(PARSE_OK as never);
    const outcome = await reparseWorkoutUseCase({ userId: "u1", workoutId: "w1", payload: { prescribedMainWorkout: "new text" } });
    expect(outcome).toEqual({ status: "ok", response: OK_RESPONSE });
    expect(updateWorkoutLog).toHaveBeenCalledWith("w1", { prescribedMainWorkout: "new text" }, "u1");
    expect(mockReparse).toHaveBeenCalledWith(expect.objectContaining({ mainWorkout: "new text" }), expect.anything());
  });

  it("does NOT call updateWorkoutLog when no overrides are supplied", async () => {
    getWorkoutLog.mockResolvedValue(WORKOUT as never);
    mockReparse.mockResolvedValue(PARSE_OK as never);
    const outcome = await reparseWorkoutUseCase({ userId: "u1", workoutId: "w1", payload: {} });
    expect(outcome.status).toBe("ok");
    expect(updateWorkoutLog).not.toHaveBeenCalled();
  });
});

describe("reparseWorkoutFromImageUseCase", () => {
  const image = { imageBase64: "x", mimeType: "image/png" };

  it("returns not_found when the workout is missing", async () => {
    getWorkoutLog.mockResolvedValue(undefined);
    const outcome = await reparseWorkoutFromImageUseCase({ userId: "u1", workoutId: "missing", image });
    expect(outcome).toEqual({ status: "not_found" });
    expect(mockReparseImage).not.toHaveBeenCalled();
  });

  it("returns the response on success", async () => {
    getWorkoutLog.mockResolvedValue(WORKOUT as never);
    mockReparseImage.mockResolvedValue(PARSE_OK as never);
    const outcome = await reparseWorkoutFromImageUseCase({ userId: "u1", workoutId: "w1", image });
    expect(outcome).toEqual({ status: "ok", response: OK_RESPONSE });
  });

  it("returns parse_failed when the image parse yields no rows", async () => {
    getWorkoutLog.mockResolvedValue(WORKOUT as never);
    mockReparseImage.mockResolvedValue(null);
    const outcome = await reparseWorkoutFromImageUseCase({ userId: "u1", workoutId: "w1", image });
    expect(outcome.status).toBe("parse_failed");
  });
});

describe("batchReparseWorkoutsUseCase", () => {
  it("delegates to the service and returns its stats", async () => {
    mockBatch.mockResolvedValue({ total: 3, parsed: 2, failed: 1 });
    const result = await batchReparseWorkoutsUseCase({ userId: "u1" });
    expect(result).toEqual({ total: 3, parsed: 2, failed: 1 });
    expect(mockBatch).toHaveBeenCalledWith("u1");
  });
});
