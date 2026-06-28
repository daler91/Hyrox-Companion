import { describe, expect, it } from "vitest";

import { createMockTrainingContext, createMockUpcomingWorkout } from "../../test/factories";
import { buildSystemPrompt, SUGGESTIONS_PROMPT } from "../prompts";
import { restriction, summary } from "../services/trainingLoadGovernor.testHelpers";
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

    const prompt = buildSuggestionsPrompt(ctx, [createMockUpcomingWorkout()], "goal");

    expect(prompt).toContain("RPE TREND: Insufficient data");
    expect(prompt).not.toContain("FATIGUE FLAG ACTIVE");
  });

  it("includes prior AI modification context and frames fatigue as workout-fit analysis", () => {
    const prompt = buildSuggestionsPrompt(
      createMockTrainingContext({
        completedWorkouts: 12,
        coachingInsights: {
          rpeTrend: "rising",
          avgRpeLast3: 8.4,
          avgRpePrior3: 6.5,
          fatigueFlag: true,
          undertrainingFlag: false,
          stationGaps: [],
          progressionFlags: [],
        },
      }),
      [
        createMockUpcomingWorkout({
          id: "already-reduced-day",
          mainWorkout: "Back squat 3x5",
          aiRationale: "Reduced from 5x5 because RPE was high.",
          aiInputsUsed: {
            lastModification: {
              kind: "fatigue_volume_reduction",
              completedWorkoutCount: 12,
              fatigueFlag: true,
              rpeTrend: "rising",
              reason: "Reduced from 5x5 because RPE was high.",
            },
          },
        }),
      ],
    );

    expect(prompt).toContain(
      "FATIGUE FLAG ACTIVE - analyze the upcoming workout fit before reducing volume.",
    );
    expect(prompt).toContain("Prior AI review: Reduced from 5x5 because RPE was high.");
    expect(prompt).toContain("Last AI modification: kind=fatigue_volume_reduction");
    expect(prompt).toContain("completedWorkoutsAtEdit=12");
    expect(prompt).toContain("Return [] when the current plan already fits the athlete");
    expect(prompt).not.toContain("athlete needs volume reduction");
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

    const prompt = buildSuggestionsPrompt(ctx, [createMockUpcomingWorkout()]);

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
    const prompt = buildSuggestionsPrompt(createMockTrainingContext(), [
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
    ]);

    expect(prompt).toContain("ID: table-backed-day");
    expect(prompt).toContain("Exercises: Back Squat: 2 sets x 8 reps, 100 kg");
    expect(prompt).not.toContain("FINGERPRINT_FREE_MAIN");
    expect(prompt).not.toContain("FINGERPRINT_FREE_ACCESSORY");
    expect(prompt).not.toContain("FINGERPRINT_PLAN_NOTES");
  });

  it("formats table-backed prompt distances with the user's distance preference", () => {
    const prompt = buildSuggestionsPrompt(
      createMockTrainingContext({ weightUnit: "lbs", distanceUnit: "miles" }),
      [
        createMockUpcomingWorkout({
          id: "miles-table-day",
          exerciseDetails: [
            {
              exerciseName: "sled_push",
              category: "functional",
              setNumber: 1,
              distance: 164,
              weight: 225,
              sortOrder: 0,
            },
          ],
        }),
      ],
    );

    expect(prompt).toContain("Exercises: Sled Push: 225 lbs, 164ft");
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
    expect(idx("Analyze the coaching analysis")).toBeGreaterThan(idx("FINGERPRINT_RAG_CHUNK"));
  });

  const NUTRITION_CTX = {
    windowDays: 14,
    loggedDaysCount: 8,
    avgCalories: 2450,
    avgProteinG: 165,
    avgCarbG: 280,
    avgFatG: 80,
    target: { calories: 2600, proteinG: 180, carbG: 300, fatG: 75 },
    highLoadDays: [{ date: "2026-04-15", utss: 95, calories: 2100, proteinG: 130 }],
    lowMicros: ["Iron 32%"],
  };

  it("includes the fuelling section in the suggestions prompt when nutrition context is present", () => {
    const prompt = buildSuggestionsPrompt(
      createMockTrainingContext({ nutrition: NUTRITION_CTX }),
      [createMockUpcomingWorkout()],
      "goal",
    );

    expect(prompt).toContain("Fuelling and Recovery (last 14 days, 8 days logged):");
    expect(prompt).toContain("2450 kcal, 165g protein");
    expect(prompt).toContain("Daily target: 2600 kcal, 180g protein, 300g carbs, 75g fat.");
    expect(prompt).toContain("2026-04-15 (UTSS 95: 2100 kcal, 130g protein)");
    expect(prompt).toContain("Iron 32%");
    // Placed between the coaching analysis and the upcoming workouts.
    expect(prompt.indexOf("Fuelling and Recovery")).toBeGreaterThan(prompt.indexOf("COACHING ANALYSIS"));
    expect(prompt.indexOf("Fuelling and Recovery")).toBeLessThan(prompt.indexOf("UPCOMING WORKOUTS"));
  });

  it("omits the fuelling section when there is no nutrition context", () => {
    const prompt = buildSuggestionsPrompt(
      createMockTrainingContext(),
      [createMockUpcomingWorkout()],
      "goal",
    );

    expect(prompt).not.toContain("Fuelling and Recovery");
  });

  it("includes the fuelling section in the chat system prompt when present", () => {
    const prompt = buildSystemPrompt(
      createMockTrainingContext({ totalWorkouts: 5, nutrition: NUTRITION_CTX }),
    );

    expect(prompt).toContain("Fuelling and Recovery (last 14 days, 8 days logged):");
    expect(prompt).toContain("Daily target: 2600 kcal");
  });
});

describe("buildSuggestionsPrompt — load governor gating", () => {
  const baseInsights = {
    rpeTrend: "stable" as const,
    fatigueFlag: false,
    undertrainingFlag: false,
    stationGaps: [],
    progressionFlags: [],
  };

  it("injects a binding LOAD GOVERNOR block when a restriction is active", () => {
    const ctx = createMockTrainingContext({
      coachingInsights: {
        ...baseInsights,
        loadGovernor: summary(
          [
            restriction("posterior_chain_velocity_lock", {
              label: "Posterior chain velocity lock",
              vector: "posterior_chain",
              rationale:
                "Recent hamstring/glute/back load conflicts with hills, sprints, and high-velocity running.",
            }),
          ],
          { zone: "danger", acwr: 1.62, flaggedVectors: ["posterior_chain"] },
        ),
      },
    });

    const prompt = buildSuggestionsPrompt(ctx, [createMockUpcomingWorkout()], "goal");

    expect(prompt).toContain("LOAD GOVERNOR (auto-regulation — binding):");
    expect(prompt).toContain("ACWR 1.62 — DANGER zone.");
    expect(prompt).toContain("Flagged tissue load: posterior chain.");
    expect(prompt).toContain(
      "Posterior chain velocity lock: Recent hamstring/glute/back load conflicts with hills, sprints, and high-velocity running.",
    );
  });

  it("surfaces the block in the yellow zone even without a named restriction", () => {
    const ctx = createMockTrainingContext({
      coachingInsights: {
        ...baseInsights,
        loadGovernor: summary([], { zone: "yellow", acwr: 1.4 }),
      },
    });

    const prompt = buildSuggestionsPrompt(ctx, [createMockUpcomingWorkout()], "goal");

    expect(prompt).toContain("LOAD GOVERNOR (auto-regulation — binding):");
    expect(prompt).toContain("YELLOW zone.");
  });

  it("omits the block for a sweet-spot athlete with no restrictions", () => {
    const ctx = createMockTrainingContext({
      coachingInsights: {
        ...baseInsights,
        loadGovernor: summary([], { zone: "sweet_spot", acwr: 1.05 }),
      },
    });

    const prompt = buildSuggestionsPrompt(ctx, [createMockUpcomingWorkout()], "goal");

    expect(prompt).not.toContain("LOAD GOVERNOR");
  });

  it("states the LOAD GOVERNOR override in the system prompt's hard constraints", () => {
    expect(SUGGESTIONS_PROMPT).toContain("LOAD GOVERNOR auto-regulation OVERRIDES");
  });
});

describe("chat system prompt — coaching analysis inclusion", () => {
  it("renders the full COACHING ANALYSIS block in the chat prompt (not just suggestions)", () => {
    const ctx = createMockTrainingContext({
      totalWorkouts: 30,
      activePlan: { name: "Hyrox Peak", totalWeeks: 10, currentWeek: 9, goal: "FINGERPRINT_CHAT_GOAL" },
      coachingInsights: {
        rpeTrend: "rising",
        avgRpeLast3: 8.7,
        avgRpePrior3: 6.2,
        fatigueFlag: true,
        undertrainingFlag: false,
        stationGaps: [{ station: "Wall Balls", daysSinceLastTrained: 22 }],
        planPhase: {
          currentWeek: 9,
          totalWeeks: 10,
          phaseLabel: "taper",
          progressPct: 90,
          remainingPhases: ["race_week"],
        },
        progressionFlags: [],
        loadGovernor: summary([], { zone: "yellow", acwr: 1.4 }),
      },
    });

    const prompt = buildSystemPrompt(ctx);

    // The chat coach previously saw NONE of this — it must now appear.
    expect(prompt).toContain("--- COACHING ANALYSIS ---");
    expect(prompt).toContain("RPE TREND: RISING");
    expect(prompt).toContain("FATIGUE FLAG ACTIVE");
    expect(prompt).toContain("Wall Balls (22 days");
    expect(prompt).toContain("TAPER phase");
    expect(prompt).toContain("LOAD GOVERNOR (auto-regulation — binding):");
    expect(prompt).toContain("YELLOW zone.");
    // The plan goal is threaded through from activePlan.goal.
    expect(prompt).toContain("FINGERPRINT_CHAT_GOAL");
  });
});

describe("coaching analysis — newly wired-in signals", () => {
  const baseInsights = {
    rpeTrend: "stable" as const,
    fatigueFlag: false,
    undertrainingFlag: false,
    stationGaps: [],
    progressionFlags: [],
  };

  it("renders the training-state decision tree in both prompts", () => {
    const ctx = createMockTrainingContext({
      totalWorkouts: 30,
      coachingInsights: {
        ...baseInsights,
        decisionTree: {
          currentPhase: "aerobic_base",
          allowedWorkoutTypes: ["easy_aerobic", "mobility"],
          intensityPermitted: false,
          rationaleCodes: ["high_acwr"],
        },
      },
    });

    for (const prompt of [
      buildSuggestionsPrompt(ctx, [createMockUpcomingWorkout()], "goal"),
      buildSystemPrompt(ctx),
    ]) {
      expect(prompt).toContain("TRAINING STATE: AEROBIC BASE phase");
      expect(prompt).toContain("intensity NOT permitted");
      expect(prompt).toContain("Allowed session types: easy aerobic, mobility");
      expect(prompt).toContain("Why: high acwr");
    }
  });

  it("renders deterministic race readiness when present", () => {
    const ctx = createMockTrainingContext({
      totalWorkouts: 30,
      coachingInsights: {
        ...baseInsights,
        raceReadiness: { tsb: 18, status: "peaked", guidance: "FINGERPRINT_TAPER_GUIDANCE" },
      },
    });

    const prompt = buildSuggestionsPrompt(ctx, [createMockUpcomingWorkout()], "goal");
    expect(prompt).toContain("RACE READINESS: PEAKED (TSB +18)");
    expect(prompt).toContain("FINGERPRINT_TAPER_GUIDANCE");
  });

  it("renders recent personal records and PR-this-week acknowledgement", () => {
    const ctx = createMockTrainingContext({
      totalWorkouts: 30,
      coachingInsights: {
        ...baseInsights,
        personalRecords: [{ exercise: "back squat", metric: "e1rm", display: "e1RM 142.5kg" }],
        prsThisWeek: 2,
      },
    });

    const prompt = buildSuggestionsPrompt(ctx, [createMockUpcomingWorkout()], "goal");
    expect(prompt).toContain("PERSONAL RECORDS (recent bests): back squat e1RM 142.5kg.");
    expect(prompt).toContain("2 new bests this week");
    expect(prompt).toContain("Anchor progressive overload on the estimated 1RM");
  });

  it("renders compliance only when adherence is meaningfully below target", () => {
    const lowCtx = createMockTrainingContext({
      totalWorkouts: 30,
      coachingInsights: { ...baseInsights, compliance: { avgPct: 62, windowDays: 70 } },
    });
    expect(buildSuggestionsPrompt(lowCtx, [createMockUpcomingWorkout()], "goal")).toContain(
      "PLAN COMPLIANCE: 62% adherence over the last 70 days",
    );

    const highCtx = createMockTrainingContext({
      totalWorkouts: 30,
      coachingInsights: { ...baseInsights, compliance: { avgPct: 96, windowDays: 70 } },
    });
    expect(buildSuggestionsPrompt(highCtx, [createMockUpcomingWorkout()], "goal")).not.toContain(
      "PLAN COMPLIANCE",
    );
  });

  it("renders movement/muscle coverage gaps distinct from station gaps", () => {
    const ctx = createMockTrainingContext({
      totalWorkouts: 30,
      coachingInsights: {
        ...baseInsights,
        neglectedPatterns: [{ label: "Hinge", daysSince: 18 }],
        neglectedMuscles: [{ label: "Hamstrings", daysSince: null }],
      },
    });

    const prompt = buildSuggestionsPrompt(ctx, [createMockUpcomingWorkout()], "goal");
    expect(prompt).toContain("COVERAGE GAPS (general balance");
    expect(prompt).toContain("movement patterns: Hinge (18d)");
    expect(prompt).toContain("muscle groups: Hamstrings (never)");
  });

  it("renders Form/monotony/objective-load detail from the load governor", () => {
    const ctx = createMockTrainingContext({
      totalWorkouts: 30,
      coachingInsights: {
        ...baseInsights,
        loadGovernor: summary([], {
          zone: "sweet_spot",
          acwr: 1.05,
          tsb: -18,
          monotony: 2.4,
          strain: 900,
          monotonyZone: "high_risk",
          hrTss: 72,
          hrZone: "z3",
          tss: 65,
        }),
      },
    });

    const prompt = buildSuggestionsPrompt(ctx, [createMockUpcomingWorkout()], "goal");
    expect(prompt).toContain("LOAD GOVERNOR (auto-regulation — binding):");
    expect(prompt).toContain("Form (TSB) -18 — fatigued — carrying load.");
    expect(prompt).toContain("Training monotony 2.40, strain 900 — HIGH RISK.");
    expect(prompt).toContain("Objective load today: hrTSS 72 (Z3), power TSS 65.");
  });

  it("adds the new signals to the prompt instructions so the model can use them", () => {
    expect(SUGGESTIONS_PROMPT).toContain("TRAINING STATE (decision engine)");
    expect(SUGGESTIONS_PROMPT).toContain("RACE READINESS");
    expect(SUGGESTIONS_PROMPT).toContain("PLAN COMPLIANCE");
    expect(SUGGESTIONS_PROMPT).toContain("COVERAGE GAPS");
  });
});
