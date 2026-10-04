import { beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "../env";
import { parseExercisesFromText } from "../gemini";
import { storage } from "../storage";
import { checkAiBudget } from "./aiUsageService";
import { createWorkoutAndScheduleCoaching } from "./workoutService";
import { createWorkout } from "./workoutUseCases";

vi.mock("../ai/providers", () => ({ isTextAiProviderConfigured: () => true }));
vi.mock("../gemini", () => ({ parseExercisesFromText: vi.fn() }));
vi.mock("../storage", () => ({
  storage: {
    users: { getUser: vi.fn() },
    analytics: { getExerciseSetsForPersonalRecords: vi.fn() },
  },
}));
vi.mock("./aiUsageService", () => ({ checkAiBudget: vi.fn() }));
vi.mock("./workoutService", () => ({
  createWorkoutAndScheduleCoaching: vi.fn(),
  updateWorkout: vi.fn(),
  assignWorkoutPlanDay: vi.fn(),
}));

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
