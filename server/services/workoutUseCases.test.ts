import { beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "../env";
import { parseExercisesFromText } from "../gemini";
import { storage } from "../storage";
import { checkAiBudget } from "./aiUsageService";
import { invalidateAnalyticsCachesForUser } from "./analyticsRouteCache";
import { assignWorkoutPlanDay, createWorkoutAndScheduleCoaching, updateWorkout } from "./workoutService";
import { refreshDerivedStateAfterLoggedSetChange } from "./workoutService/loggedSetChange";
import { assignWorkoutPlanDayUseCase, createWorkout, updateWorkoutUseCase } from "./workoutUseCases";

vi.mock("../ai/providers", () => ({ isTextAiProviderConfigured: () => true }));
vi.mock("../gemini", () => ({ parseExercisesFromText: vi.fn() }));
vi.mock("../storage", () => ({
  storage: {
    users: { getUser: vi.fn() },
    analytics: { getExerciseSetsForPersonalRecords: vi.fn() },
  },
}));
vi.mock("./aiUsageService", () => ({ checkAiBudget: vi.fn() }));
vi.mock("./analyticsRouteCache", () => ({ invalidateAnalyticsCachesForUser: vi.fn() }));
vi.mock("./workoutService", () => ({
  createWorkoutAndScheduleCoaching: vi.fn(),
  updateWorkout: vi.fn(),
  assignWorkoutPlanDay: vi.fn(),
}));
vi.mock("./workoutService/loggedSetChange", () => ({ refreshDerivedStateAfterLoggedSetChange: vi.fn() }));

const USER_ID = "user-1";
const TEXT_ONLY = { date: "2026-10-01", focus: "Strength", mainWorkout: "5x5 back squat @ 100kg" };
const PARSED = [{ exerciseName: "back_squat", category: "strength", sets: [{ reps: 5, weight: 100 }] }];

// P15 (CODEBASE_ANALYSIS_2026-10-03): with the structured-write gate rolled
// back, a text-only create reaches this legacy parse. POST /workouts has no AI
// middleware, so the use case checks consent, budget and the kill switch.
describe("createWorkout legacy text parse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.AI_FEATURES_ENABLED = "true";
    vi.mocked(storage.users.getUser).mockResolvedValue({ id: USER_ID, aiCoachEnabled: true, weightUnit: "kg", distanceUnit: "km" } as never);
    vi.mocked(checkAiBudget).mockResolvedValue({ allowed: true, warning: false, currentCostCents: 0, limitCents: 200 });
    vi.mocked(parseExercisesFromText).mockResolvedValue(PARSED as never);
    vi.mocked(createWorkoutAndScheduleCoaching).mockResolvedValue({ id: "w1", exerciseSets: [] } as never);
  });

  it("parses the text of an athlete who opted in and is within budget", async () => {
    await createWorkout({ userId: USER_ID, payload: TEXT_ONLY });

    expect(checkAiBudget).toHaveBeenCalledWith(USER_ID);
    expect(parseExercisesFromText).toHaveBeenCalledWith(TEXT_ONLY.mainWorkout, { weightUnit: "kg", distanceUnit: "km" }, undefined, USER_ID);
    expect(createWorkoutAndScheduleCoaching).toHaveBeenCalledWith(expect.objectContaining({ mainWorkout: TEXT_ONLY.mainWorkout }), PARSED, USER_ID, undefined);
  });

  it.each([
    ["has not opted in to AI", () => vi.mocked(storage.users.getUser).mockResolvedValue({ id: USER_ID, aiCoachEnabled: false } as never)],
    ["is over the daily AI budget", () => vi.mocked(checkAiBudget).mockResolvedValue({ allowed: false, warning: true, currentCostCents: 210, limitCents: 200, deniedBy: "user" })],
    ["cannot have the budget confirmed", () => vi.mocked(checkAiBudget).mockRejectedValue(new Error("db down"))],
    ["is on a deployment with AI switched off", () => { env.AI_FEATURES_ENABLED = "false"; }],
  ])("saves the text without an AI parse when the athlete %s", async (_case, arrange) => {
    arrange();

    await createWorkout({ userId: USER_ID, payload: TEXT_ONLY });

    expect(parseExercisesFromText).not.toHaveBeenCalled();
    expect(createWorkoutAndScheduleCoaching).toHaveBeenCalledWith(expect.objectContaining({ mainWorkout: TEXT_ONLY.mainWorkout }), undefined, USER_ID, undefined);
  });
});

// D10 (CODEBASE_ANALYSIS_2026-10-03): the analytics routes cache an athlete's
// logs and sets for minutes; each write must drop them before it answers.
describe("workout use cases drop the athlete's cached analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createWorkoutAndScheduleCoaching).mockResolvedValue({ id: "w1", exerciseSets: [] } as never);
  });

  it("after a create", async () => {
    await createWorkout({ userId: USER_ID, payload: { ...TEXT_ONLY, exercises: PARSED } });

    expect(invalidateAnalyticsCachesForUser).toHaveBeenCalledWith(USER_ID);
  });

  it.each([
    ["an update", () => updateWorkoutUseCase({ userId: USER_ID, workoutId: "w1", payload: { notes: "felt good" } }), updateWorkout],
    ["a plan-day assignment", () => assignWorkoutPlanDayUseCase({ userId: USER_ID, workoutId: "w1", planDayId: "pd-1" }), assignWorkoutPlanDay],
  ] as const)("after %s that found the workout, and not after one that did not", async (_label, run, write) => {
    vi.mocked(write).mockResolvedValueOnce({ id: "w1" } as never);
    await run();
    expect(invalidateAnalyticsCachesForUser).toHaveBeenCalledWith(USER_ID);

    vi.clearAllMocks();
    vi.mocked(write).mockResolvedValueOnce(null);
    await run();
    expect(invalidateAnalyticsCachesForUser).not.toHaveBeenCalled();
  });
});

// C32 (CODEBASE_ANALYSIS_2026-10-03): a PATCH carrying `exercises` replaces
// every logged set, so it re-derives adherence and re-queues the coach like a
// single set edit does; a column-only PATCH leaves the sets, and both, alone.
describe("updateWorkoutUseCase re-derives what the replaced sets fed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateWorkout).mockResolvedValue({ id: "w1" } as never);
  });

  it("after a PATCH that replaces the sets", async () => {
    await updateWorkoutUseCase({ userId: USER_ID, workoutId: "w1", payload: { exercises: PARSED } });

    expect(refreshDerivedStateAfterLoggedSetChange).toHaveBeenCalledWith("w1", USER_ID);
  });

  it("not after a column-only PATCH, nor one that found no workout", async () => {
    await updateWorkoutUseCase({ userId: USER_ID, workoutId: "w1", payload: { notes: "felt good" } });
    vi.mocked(updateWorkout).mockResolvedValueOnce(null);
    await updateWorkoutUseCase({ userId: USER_ID, workoutId: "w1", payload: { exercises: PARSED } });

    expect(refreshDerivedStateAfterLoggedSetChange).not.toHaveBeenCalled();
  });
});
