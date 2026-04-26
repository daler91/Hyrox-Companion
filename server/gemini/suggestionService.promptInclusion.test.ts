import { describe, expect, it } from "vitest";

import {
  createMockTrainingContext,
  createMockUpcomingWorkout,
} from "../../test/factories";
import { buildSystemPrompt } from "../prompts";
import { buildSuggestionsPrompt } from "./suggestionService";
import type { TrainingContext } from "./types";

/**
 * Tier 1 regression guard for the AI coach.
 *
 * The intent is simple: the model cannot weigh an input it never sees.
 * This test proves every declared TrainingContext input reaches the
 * prompt string that is sent to Gemini. Any future refactor that drops
 * a field on the floor will fail here.
 *
 * Each input is stamped with a unique fingerprint so the assertion
 * cannot be satisfied by a coincidental substring.
 */

function kitchenSinkContext(): TrainingContext {
  return createMockTrainingContext({
    completionRate: 73,
    currentStreak: 11,
    completedWorkouts: 41,
    weeklyGoal: 6,
    exerciseBreakdown: {
      FINGERPRINT_EXERCISE_SKIERG: 9,
      "Wall Balls": 3,
    },
    structuredExerciseStats: {
      "Back Squat": { count: 7, maxWeight: 1234 },
      SkiErg: { count: 5, maxDistance: 2500, bestTime: 9, avgReps: 30 },
    },
    recentWorkouts: [
      {
        date: "2026-04-10",
        focus: "strength",
        mainWorkout: "FINGERPRINT_RECENT_MAINWORKOUT",
        status: "completed",
        rpe: 8,
        duration: 62,
        athleteNote: "FINGERPRINT_ATHLETE_NOTE",
      },
    ],
    activePlan: {
      name: "Hyrox Peak",
      totalWeeks: 10,
      currentWeek: 9,
      goal: "FINGERPRINT_GOAL_SUB90",
    },
    coachingInsights: {
      rpeTrend: "rising",
      avgRpeLast3: 8.7,
      avgRpePrior3: 6.2,
      fatigueFlag: true,
      undertrainingFlag: false,
      stationGaps: [
        { station: "Wall Balls", daysSinceLastTrained: 22 },
        { station: "Sled Push", daysSinceLastTrained: null },
      ],
      planPhase: {
        currentWeek: 9,
        totalWeeks: 10,
        phaseLabel: "taper",
        progressPct: 90,
        remainingPhases: ["race_week"],
      },
      weeklyVolume: {
        thisWeekCompleted: 4,
        lastWeekCompleted: 2,
        goal: 6,
        trend: "increasing",
      },
      progressionFlags: [
        {
          exercise: "FINGERPRINT_EX_PLATEAU",
          flag: "plateau",
          detail: "no progress in 3 weeks",
        },
      ],
    },
  });
}

function kitchenSinkUpcoming() {
  return [
    createMockUpcomingWorkout({
      id: "FINGERPRINT_UP_DAY_1",
      date: "2026-04-21",
      focus: "intervals",
      mainWorkout: "6x400m @ 5K pace",
      accessory: "core 10min",
      notes: "FINGERPRINT_UP_NOTES_1",
    }),
    createMockUpcomingWorkout({
      id: "FINGERPRINT_UP_DAY_2",
      date: "2026-04-22",
      focus: "strength",
      mainWorkout: "Deadlift 4x3",
    }),
  ];
}

describe("buildSuggestionsPrompt — input inclusion regression guard", () => {
  it("includes every TrainingContext input in the Gemini prompt", () => {
    const prompt = buildSuggestionsPrompt(
      kitchenSinkContext(),
      kitchenSinkUpcoming(),
      "FINGERPRINT_GOAL_SUB90",
      "FINGERPRINT_RAG_CHUNK\nZone 2 guidance body",
    );

    // Header signals
    expect(prompt).toContain("FINGERPRINT_GOAL_SUB90");
    expect(prompt).toContain("Completion rate: 73%");
    expect(prompt).toContain("Current streak: 11 days");
    expect(prompt).toContain("Completed workouts: 41");
    expect(prompt).toContain("Weekly goal: 6");

    // Exercise frequency + per-exercise stats
    expect(prompt).toContain("FINGERPRINT_EXERCISE_SKIERG");
    expect(prompt).toContain("max weight: 1234");
    expect(prompt).toContain("max distance: 2500m");

    // Recent workouts block
    expect(prompt).toContain("FINGERPRINT_RECENT_MAINWORKOUT");
    expect(prompt).toContain("FINGERPRINT_ATHLETE_NOTE");
    expect(prompt).toContain("RPE: 8");
    expect(prompt).toContain("Duration: 62min");

    // Coaching analysis block
    expect(prompt).toContain("RPE TREND: RISING");
    expect(prompt).toContain("avg 8.7 last 3");
    expect(prompt).toContain("FATIGUE FLAG ACTIVE");
    expect(prompt).toContain("Wall Balls (22 days");
    expect(prompt).toContain("Sled Push (NEVER TRAINED");
    expect(prompt).toContain("TAPER phase");
    expect(prompt).toContain("Week 9 of 10");
    expect(prompt).toContain("Remaining phases: RACE_WEEK");
    expect(prompt).toContain("FINGERPRINT_EX_PLATEAU: PLATEAU");
    expect(prompt).toContain("WEEKLY VOLUME: 4/6 goal");
    expect(prompt).toContain("last week: 2/6");
    expect(prompt).toContain("Trend: increasing");

    // Upcoming workouts block
    expect(prompt).toContain("ID: FINGERPRINT_UP_DAY_1");
    expect(prompt).toContain("ID: FINGERPRINT_UP_DAY_2");
    expect(prompt).toContain("FINGERPRINT_UP_NOTES_1");

    // RAG materials
    expect(prompt).toContain("FINGERPRINT_RAG_CHUNK");
  });

  it("omits RPE trend details when rpeTrend=insufficient_data", () => {
    const ctx = createMockTrainingContext({
      coachingInsights: {
        rpeTrend: "insufficient_data",
        fatigueFlag: false,
        undertrainingFlag: false,
        stationGaps: [],
        progressionFlags: [],
      },
    });

    const prompt = buildSuggestionsPrompt(
      ctx,
      [createMockUpcomingWorkout()],
      "goal",
    );

    expect(prompt).toContain("RPE TREND: Insufficient data");
    expect(prompt).not.toContain("FATIGUE FLAG ACTIVE");
  });

  it("omits planPhase/weeklyVolume/progression lines when not provided", () => {
    const ctx = createMockTrainingContext({
      coachingInsights: {
        rpeTrend: "stable",
        avgRpeLast3: 6,
        avgRpePrior3: 6,
        fatigueFlag: false,
        undertrainingFlag: false,
        stationGaps: [],
        planPhase: undefined,
        weeklyVolume: undefined,
        progressionFlags: [],
      },
    });

    const prompt = buildSuggestionsPrompt(
      ctx,
      [createMockUpcomingWorkout()],
    );

    expect(prompt).not.toContain("PLAN PHASE:");
    expect(prompt).not.toContain("WEEKLY VOLUME:");
    expect(prompt).not.toContain("PROGRESSION:");
  });

  it("omits coaching materials section when not provided", () => {
    const prompt = buildSuggestionsPrompt(
      createMockTrainingContext(),
      [createMockUpcomingWorkout()],
      "goal",
    );

    expect(prompt).not.toContain("FINGERPRINT_RAG_CHUNK");
  });

  it("uses upcoming exercise-table rows instead of main/accessory/notes when rows exist", () => {
    const prompt = buildSuggestionsPrompt(
      createMockTrainingContext(),
      [
        createMockUpcomingWorkout({
          id: "table-backed-day",
          focus: "strength",
          mainWorkout: "FINGERPRINT_FREE_MAIN",
          accessory: "FINGERPRINT_FREE_ACCESSORY",
          notes: "FINGERPRINT_PLAN_NOTES",
          exerciseDetails: [
            {
              exerciseName: "back_squat",
              category: "strength",
              setNumber: 1,
              reps: 8,
              weight: 100,
              sortOrder: 0,
            },
            {
              exerciseName: "back_squat",
              category: "strength",
              setNumber: 2,
              reps: 8,
              weight: 100,
              sortOrder: 1,
            },
          ],
        }),
      ],
    );

    expect(prompt).toContain("ID: table-backed-day");
    expect(prompt).toContain("Exercises: Back Squat: 2 sets x 8 reps, 100 kg");
    expect(prompt).not.toContain("FINGERPRINT_FREE_MAIN");
    expect(prompt).not.toContain("FINGERPRINT_FREE_ACCESSORY");
    expect(prompt).not.toContain("FINGERPRINT_PLAN_NOTES");
  });

  it("includes completed exercise rows and athlete note in recent workout context", () => {
    const prompt = buildSuggestionsPrompt(
      createMockTrainingContext({
        recentWorkouts: [
          {
            date: "2026-04-18",
            focus: "conditioning",
            mainWorkout: "FINGERPRINT_COMPLETED_FREE_TEXT",
            status: "completed",
            athleteNote: "FINGERPRINT_COMPLETED_ATHLETE_NOTE",
            exerciseDetails: [
              {
                exerciseName: "rowing",
                category: "functional",
                setNumber: 1,
                distance: 1000,
                time: 4,
                sortOrder: 0,
              },
            ],
          },
        ],
      }),
      [createMockUpcomingWorkout()],
    );

    expect(prompt).toContain("Exercises: Rowing: 1000m, 4 min");
    expect(prompt).toContain("Athlete note: FINGERPRINT_COMPLETED_ATHLETE_NOTE");
    expect(prompt).not.toContain("FINGERPRINT_COMPLETED_FREE_TEXT");
  });

  it("uses exercise-table rows in the shared chat system prompt", () => {
    const prompt = buildSystemPrompt(
      createMockTrainingContext({
        totalWorkouts: 2,
        recentWorkouts: [
          {
            date: "2026-04-18",
            focus: "conditioning",
            mainWorkout: "FINGERPRINT_CHAT_RECENT_FREE_TEXT",
            status: "completed",
            athleteNote: "FINGERPRINT_CHAT_ATHLETE_NOTE",
            exerciseDetails: [
              {
                exerciseName: "wall_balls",
                category: "functional",
                setNumber: 1,
                reps: 50,
                weight: 20,
                sortOrder: 0,
              },
            ],
          },
        ],
        upcomingWorkouts: [
          {
            planDayId: "chat-plan-day",
            date: "2026-04-20",
            focus: "strength",
            mainWorkout: "FINGERPRINT_CHAT_UPCOMING_MAIN",
            accessory: "FINGERPRINT_CHAT_UPCOMING_ACCESSORY",
            notes: "FINGERPRINT_CHAT_PLAN_NOTES",
            exerciseDetails: [
              {
                exerciseName: "deadlift",
                category: "strength",
                setNumber: 1,
                reps: 5,
                weight: 140,
                sortOrder: 0,
              },
            ],
          },
        ],
      }),
    );

    expect(prompt).toContain("Exercises: Wall Balls: 50 reps, 20 kg");
    expect(prompt).toContain("Athlete note: FINGERPRINT_CHAT_ATHLETE_NOTE");
    expect(prompt).toContain("Exercises: Deadlift: 5 reps, 140 kg");
    expect(prompt).not.toContain("FINGERPRINT_CHAT_RECENT_FREE_TEXT");
    expect(prompt).not.toContain("FINGERPRINT_CHAT_UPCOMING_MAIN");
    expect(prompt).not.toContain("FINGERPRINT_CHAT_UPCOMING_ACCESSORY");
    expect(prompt).not.toContain("FINGERPRINT_CHAT_PLAN_NOTES");
  });

  it("preserves the canonical section ordering", () => {
    const prompt = buildSuggestionsPrompt(
      kitchenSinkContext(),
      kitchenSinkUpcoming(),
      "FINGERPRINT_GOAL_SUB90",
      "FINGERPRINT_RAG_CHUNK",
    );

    const idx = (needle: string) => prompt.indexOf(needle);

    // Athlete data -> coaching analysis -> upcoming -> RAG -> closing
    expect(idx("ATHLETE'S TRAINING DATA")).toBeGreaterThanOrEqual(0);
    expect(idx("COACHING ANALYSIS")).toBeGreaterThan(idx("ATHLETE'S TRAINING DATA"));
    expect(idx("UPCOMING WORKOUTS")).toBeGreaterThan(idx("COACHING ANALYSIS"));
    expect(idx("FINGERPRINT_RAG_CHUNK")).toBeGreaterThan(idx("UPCOMING WORKOUTS"));
    expect(idx("Analyze the coaching analysis")).toBeGreaterThan(
      idx("FINGERPRINT_RAG_CHUNK"),
    );
  });
});
