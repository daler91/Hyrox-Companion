import { beforeEach, describe, expect, it, vi } from "vitest";

import { storage } from "../storage";
import {
  CHAT_READ_TOOLS,
  type ChatToolContext,
  chatToolsFor,
  chatToolStatus,
  PROPOSE_PLAN_CHANGES,
  runChatTool,
} from "./chatTools";
import { retrieveCoachingContext } from "./ragRetrieval";

vi.mock("../storage", () => ({
  storage: {
    analytics: {
      getWorkoutLogsByDateRange: vi.fn(),
      getAllExerciseSetsWithDates: vi.fn(),
      getExerciseSetsForPersonalRecords: vi.fn(),
    },
    timeline: { getUpcomingPlannedDays: vi.fn() },
  },
}));
vi.mock("./ragRetrieval", () => ({ retrieveCoachingContext: vi.fn() }));

const CTX: ChatToolContext = {
  userId: "user-1",
  today: "2026-10-01",
  weightUnit: "kg",
  distanceUnit: "km",
  log: { warn: vi.fn(), error: vi.fn() },
};

const call = (name: string, args: Record<string, unknown> = {}) => ({ id: "call-1", name, arguments: args });
const run = async (name: string, args?: Record<string, unknown>) =>
  JSON.parse(await runChatTool(call(name, args), CTX)) as Record<string, unknown>;

function set(overrides: Record<string, unknown>) {
  return {
    id: "set",
    workoutLogId: "log-1",
    date: "2026-07-14",
    exerciseName: "back_squat",
    customLabel: null,
    category: "strength",
    setNumber: 1,
    reps: 5,
    weight: 100,
    weightUnit: "kg",
    distance: null,
    time: null,
    notes: null,
    sortOrder: 0,
    ...overrides,
  };
}

describe("the tools offered", () => {
  it("include plan changes only where a proposal can be shown", () => {
    expect(chatToolsFor({ planChanges: true }).map((tool) => tool.name)).toContain(PROPOSE_PLAN_CHANGES);
    expect(chatToolsFor({ planChanges: false })).toEqual(CHAT_READ_TOOLS);
  });
});

describe("get_workouts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.analytics).getAllExerciseSetsWithDates.mockResolvedValue([]);
    vi.mocked(storage.timeline).getUpcomingPlannedDays.mockResolvedValue([]);
  });

  it("lists the logged sessions in the range, newest first, with their sets", async () => {
    vi.mocked(storage.analytics).getWorkoutLogsByDateRange.mockResolvedValue([
      { id: "log-1", date: "2026-07-14", focus: "Lower", mainWorkout: "Squats", duration: 60, rpe: 8, notes: 'RPE <8 & felt "fresh"' },
      { id: "log-2", date: "2026-07-21", focus: "Easy run", mainWorkout: "5k easy", duration: 30, rpe: 3, notes: null },
    ] as never);
    vi.mocked(storage.analytics).getAllExerciseSetsWithDates.mockResolvedValue([set({})] as never);

    const result = await run("get_workouts", { from: "2026-07-01", to: "2026-07-31" });

    expect(vi.mocked(storage.analytics).getWorkoutLogsByDateRange.mock.calls).toContainEqual(["user-1", "2026-07-01", "2026-07-31"]);
    const workouts = result.workouts as Array<{ date: string; exercises: string; note?: string }>;
    expect(workouts).toHaveLength(2);
    expect(workouts.at(0)).toEqual({ date: "2026-07-21", focus: "Easy run", durationMin: 30, rpe: 3, exercises: "5k easy" });
    expect(workouts.at(1)?.date).toBe("2026-07-14");
    expect(workouts.at(1)?.exercises).toContain("5 reps, 100 kg");
    // The athlete's own text is sanitised like any other text that reaches a prompt.
    expect(workouts.at(1)?.note).toBe('RPE &lt;8 &amp; felt "fresh"');
    // A range in the past has nothing planned in it.
    expect(vi.mocked(storage.timeline).getUpcomingPlannedDays.mock.calls).toEqual([]);
  });

  it("shows a set logged in kg in lbs for an athlete who has since switched (AI9)", async () => {
    vi.mocked(storage.analytics).getWorkoutLogsByDateRange.mockResolvedValue([
      { id: "log-1", date: "2026-07-14", focus: "Lower", mainWorkout: "Squats", duration: 60, rpe: 8, notes: null },
    ] as never);
    vi.mocked(storage.analytics).getAllExerciseSetsWithDates.mockResolvedValue([
      set({ weight: 140, weightUnit: "kg" }),
    ] as never);

    const raw = await runChatTool(call("get_workouts", { from: "2026-07-01", to: "2026-07-31" }), {
      ...CTX,
      weightUnit: "lbs",
      distanceUnit: "miles",
    });
    const workouts = (JSON.parse(raw) as { workouts: Array<{ exercises: string }> }).workouts;

    expect(workouts.at(0)?.exercises).toBe("Back Squat: 5 reps, 309 lbs");
  });

  it("includes planned sessions in a range that reaches ahead", async () => {
    vi.mocked(storage.analytics).getWorkoutLogsByDateRange.mockResolvedValue([]);
    vi.mocked(storage.timeline).getUpcomingPlannedDays.mockResolvedValue([
      { date: "2026-10-05", focus: "Long run", mainWorkout: "90 min easy" },
      { date: "2026-12-01", focus: "Out of range", mainWorkout: "x" },
    ] as never);

    const result = await run("get_workouts", { from: "2026-10-01", to: "2026-10-31" });

    expect(result.planned).toEqual([{ date: "2026-10-05", focus: "Long run", workout: "90 min easy" }]);
  });

  it("refuses a range longer than 92 days, or backwards, without reading anything", async () => {
    expect((await run("get_workouts", { from: "2026-01-01", to: "2026-06-30" })).error).toMatch(/Invalid arguments/);
    expect((await run("get_workouts", { from: "2026-07-31", to: "2026-07-01" })).error).toMatch(/Invalid arguments/);
    expect(vi.mocked(storage.analytics).getWorkoutLogsByDateRange.mock.calls).toEqual([]);
  });
});

describe("get_exercise_history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("finds an exercise by its name or custom label, a session per log, newest first", async () => {
    vi.mocked(storage.analytics).getAllExerciseSetsWithDates.mockResolvedValue([
      set({ workoutLogId: "log-1", date: "2026-07-14", weight: 100 }),
      set({ workoutLogId: "log-1", date: "2026-07-14", setNumber: 2, weight: 100 }),
      set({ workoutLogId: "log-2", date: "2026-08-04", weight: 105 }),
      set({ workoutLogId: "log-3", date: "2026-08-10", exerciseName: "custom:pause_squat", customLabel: "Pause back squat" }),
      set({ workoutLogId: "log-4", date: "2026-08-11", exerciseName: "deadlift" }),
    ] as never);

    const result = await run("get_exercise_history", { exercise: "Back Squat" });

    expect(vi.mocked(storage.analytics).getAllExerciseSetsWithDates.mock.calls).toContainEqual(["user-1", "2026-04-04", "2026-10-01"]);
    expect((result.sessions as Array<{ date: string }>).map((session) => session.date)).toEqual([
      "2026-08-10",
      "2026-08-04",
      "2026-07-14",
    ]);
  });

  it("says so when the exercise was never logged in the window", async () => {
    vi.mocked(storage.analytics).getAllExerciseSetsWithDates.mockResolvedValue([]);

    const result = await run("get_exercise_history", { exercise: "sled push", months: 2 });

    expect(result.sessions).toEqual([]);
    expect(result.note).toBe("No logged sets of that exercise since 2026-08-02.");
  });

  // AI9 (CODEBASE_ANALYSIS_2026-10-03): a set is shown in the athlete's
  // current unit through its L4 stamp, not as the raw number under that label.
  it("shows sets logged in kg in lbs for an athlete who has since switched", async () => {
    vi.mocked(storage.analytics).getAllExerciseSetsWithDates.mockResolvedValue([
      set({ workoutLogId: "log-1", date: "2026-07-14", weight: 140, weightUnit: "kg" }),
      set({ workoutLogId: "log-2", date: "2026-09-14", weight: 315, weightUnit: "lbs" }),
    ] as never);

    const raw = await runChatTool(call("get_exercise_history", { exercise: "back squat" }), {
      ...CTX,
      weightUnit: "lbs",
      distanceUnit: "miles",
    });
    const sessions = (JSON.parse(raw) as { sessions: Array<{ date: string; sets: string }> }).sessions;

    expect(sessions).toEqual([
      { date: "2026-09-14", sets: "Back Squat: 5 reps, 315 lbs" },
      { date: "2026-07-14", sets: "Back Squat: 5 reps, 309 lbs" },
    ]);
  });
});

describe("get_personal_records", () => {
  it("lists each exercise's headline best with its date, weighted lifts first", async () => {
    vi.mocked(storage.analytics).getExerciseSetsForPersonalRecords.mockResolvedValue([
      set({ exerciseName: "back_squat", reps: 5, weight: 120, date: "2026-08-04" }),
      set({ exerciseName: "rowing", category: "functional", reps: null, weight: null, time: 3.75, distance: 1000, date: "2026-09-01" }),
    ] as never);

    const result = await run("get_personal_records");

    expect(vi.mocked(storage.analytics).getExerciseSetsForPersonalRecords.mock.calls).toContainEqual(["user-1", undefined, undefined, { onlyTraining: true }]);
    const records = result.records as Array<{ exercise: string; best: string; date: string }>;
    expect(records[0]).toMatchObject({ exercise: "back squat", date: "2026-08-04" });
    expect(records[0].best).toMatch(/^e1RM 140kg$/);
    expect(records[1]).toMatchObject({ exercise: "rowing", date: "2026-09-01" });
  });

  it("falls back to max weight for a load logged without reps, and max distance (in its stored unit, metres) for a distance without a time", async () => {
    vi.mocked(storage.analytics).getExerciseSetsForPersonalRecords.mockResolvedValue([
      set({ exerciseName: "sled_push", category: "functional", reps: null, weight: 150, date: "2026-08-10" }),
      set({ exerciseName: "skierg", category: "functional", reps: null, weight: null, time: null, distance: 2000, date: "2026-09-05" }),
    ] as never);

    const result = await run("get_personal_records");

    const records = result.records as Array<{ exercise: string; best: string; date: string }>;
    expect(records).toEqual([
      { exercise: "sled push", best: "max weight 150kg", date: "2026-08-10" },
      { exercise: "skierg", best: "max distance 2000m", date: "2026-09-05" },
    ]);
  });
});

describe("search_coaching_materials", () => {
  it("returns the matching excerpts, sanitised", async () => {
    vi.mocked(retrieveCoachingContext).mockResolvedValue({
      retrievedChunks: ['[Hyrox pacing notes] Run the first km at <90% & "easy".'],
      ragInfo: { source: "rag", chunkCount: 1 },
    });

    const result = await run("search_coaching_materials", { query: "pacing the first run" });

    expect(retrieveCoachingContext).toHaveBeenCalledWith("user-1", "pacing the first run", CTX.log);
    expect(result.excerpts).toEqual(['[Hyrox pacing notes] Run the first km at &lt;90% &amp; "easy".']);
  });

  it("falls back to the whole coaching materials when no chunks were retrieved", async () => {
    vi.mocked(retrieveCoachingContext).mockResolvedValue({
      coachingMaterials: [{ title: "Race plan", content: "Negative split <5k" }],
      ragInfo: { source: "full", chunkCount: 0 },
    } as never);

    const result = await run("search_coaching_materials", { query: "race" });

    expect(result.excerpts).toEqual(["Race plan\nNegative split &lt;5k"]);
    expect(result).not.toHaveProperty("note");
  });

  it("says nothing matched when the athlete has no relevant notes", async () => {
    vi.mocked(retrieveCoachingContext).mockResolvedValue({ ragInfo: { source: "none", chunkCount: 0 } } as never);

    const result = await run("search_coaching_materials", { query: "anything" });

    expect(result.excerpts).toEqual([]);
    expect(result.note).toBe("Nothing in the athlete's coaching notes matched.");
  });
});

describe("chatToolStatus (I11)", () => {
  it("names the lookup each read tool makes, and falls back to thinking", () => {
    expect(chatToolStatus("get_workouts")).toBe("looking_up_workouts");
    expect(chatToolStatus("get_exercise_history")).toBe("looking_up_exercises");
    expect(chatToolStatus("get_personal_records")).toBe("looking_up_records");
    expect(chatToolStatus("search_coaching_materials")).toBe("searching_notes");
    expect(chatToolStatus("delete_everything")).toBe("thinking");
  });
});

describe("runChatTool", () => {
  it("never throws: an unknown tool or a failed read comes back as an error to work around", async () => {
    expect(await run("delete_everything")).toEqual({ error: "There is no tool called delete_everything." });

    vi.mocked(storage.analytics).getExerciseSetsForPersonalRecords.mockRejectedValue(new Error("db down"));
    expect((await run("get_personal_records")).error).toMatch(/lookup failed/);
    expect(CTX.log.warn).toHaveBeenCalled();
  });

  it("keeps a result within its size cap by halving its lists", async () => {
    vi.mocked(storage.analytics).getWorkoutLogsByDateRange.mockResolvedValue(
      Array.from({ length: 40 }, (_, i) => ({
        id: `log-${i}`,
        date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`,
        focus: "Session",
        mainWorkout: "x".repeat(290),
        duration: 60,
        rpe: 7,
        notes: "y".repeat(290),
      })) as never,
    );
    vi.mocked(storage.analytics).getAllExerciseSetsWithDates.mockResolvedValue([]);

    const raw = await runChatTool(call("get_workouts", { from: "2026-07-01", to: "2026-07-31" }), CTX);

    expect(raw.length).toBeLessThanOrEqual(8_000);
    expect(JSON.parse(raw)).toMatchObject({ truncated: true });
  });
});
