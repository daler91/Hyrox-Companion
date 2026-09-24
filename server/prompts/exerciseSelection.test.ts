import { EXERCISE_DEFINITIONS } from "@shared/schema/exercises";
import { describe, expect, it } from "vitest";

import { PLAN_GENERATION_PROMPT } from "../prompts";
import type { ExerciseSelectionBrief } from "../services/ai/exerciseSelection";
import {
  buildExerciseMenu,
  EXERCISE_MENU_KEYS,
  formatExerciseSelectionBrief,
  formatPrimaryLifts,
} from "./exerciseSelection";

function makeBrief(overrides: Partial<ExerciseSelectionBrief> = {}): ExerciseSelectionBrief {
  return {
    lens: "hyrox",
    experienceLevel: "intermediate",
    staples: [
      { exercise: "back_squat", sessions: 9, daysSince: 3, lastSession: "4 sets, top 100 kg x 5" },
      { exercise: 'custom:Hyrox Class <3 & "more"', sessions: 4, daysSince: 1, lastSession: null },
    ],
    needs: [
      {
        kind: "balance",
        reason: "Pulling is 6 sets vs 18 pushing sets in the last 4 weeks",
        candidates: [
          { exercise: "seated_cable_row", sessions: 3 },
          { exercise: "pull_up", sessions: 0 },
        ],
      },
      {
        kind: "stall",
        reason: "Bench Press has stalled at 80 kg x 5 for 3 sessions",
        candidates: [{ exercise: "close_grip_bench_press", sessions: 0 }],
        method: "or keep the lift and change the method: 3-1-1 tempo",
      },
    ],
    stationSubstitutions: [
      { station: "sled_push", substitutes: [{ exercise: "leg_press", sessions: 0 }] },
    ],
    limitedRegions: ["lower_limb_impact"],
    unavailableEquipment: ["sled", "pullup_bar"],
    raceStandards: "open, men: sled push 152 kg · wall balls 6 kg",
    upcomingShape: {
      structuredDays: 3,
      totalDays: 4,
      setsByGroup: new Map([
        ["squat", 4],
        ["hinge", 4],
        ["push", 1],
        ["pull", 0],
        ["single_leg", 0],
        ["carry", 0],
        ["trunk", 0],
      ]),
      missing: ["pull", "single_leg"],
      backToBackLowerBody: [["2026-06-16", "2026-06-17"]],
    },
    primaryLifts: [
      { slot: "squat", exercise: "back_squat", sessions: 9 },
      { slot: "hinge", exercise: "romanian_deadlift", sessions: 0 },
    ],
    ...overrides,
  };
}

describe("formatExerciseSelectionBrief", () => {
  it("renders nothing without a brief", () => {
    expect(formatExerciseSelectionBrief(undefined, "coach")).toBe("");
  });

  it("names exercises the way the athlete reads them for the coach", () => {
    const text = formatExerciseSelectionBrief(makeBrief(), "coach");
    expect(text).toContain("- Back Squat: 9 sessions, last 4 sets, top 100 kg x 5 (3 days ago)");
    expect(text).toContain(
      "1. Pulling is 6 sets vs 18 pushing sets in the last 4 weeks → Seated Cable Row (logged 3x), Pull-ups",
    );
    expect(text).toContain(
      "2. Bench Press has stalled at 80 kg x 5 for 3 sessions → Close Grip Bench Press; or keep the lift",
    );
    expect(text).toContain("Sled Push → Leg Press");
    expect(text).not.toContain("seated_cable_row");
  });

  it("names exercises by their exact keys for plan generation", () => {
    const text = formatExerciseSelectionBrief(makeBrief(), "plan");
    expect(text).toContain("- back_squat: 9 sessions");
    expect(text).toContain("→ seated_cable_row (logged 3x), pull_up");
  });

  it("escapes the athlete's own exercise names", () => {
    // Angle brackets, ampersands and quotes are what a name could use to break
    // out of the prompt's delimiters; all of them arrive escaped.
    const escaped = "Hyrox Class &lt;3 &amp; &quot;more&quot;";
    const coach = formatExerciseSelectionBrief(makeBrief(), "coach");
    expect(coach).toContain(escaped);
    expect(coach).not.toContain("<3");
    expect(formatExerciseSelectionBrief(makeBrief(), "plan")).toContain(`custom "${escaped}"`);
  });

  it("states the goal lens, constraints reading, and race standards", () => {
    const text = formatExerciseSelectionBrief(makeBrief(), "coach");
    expect(text).toContain("GOAL LENS: HYROX / functional racing");
    expect(text).toContain("limits lower-limb impact (jumps, sprints); no sled, pullup-bar");
    expect(text).toContain("RACE STANDARDS (open, men: sled push 152 kg · wall balls 6 kg)");
  });

  it("describes the coming week for the coach only", () => {
    const coach = formatExerciseSelectionBrief(makeBrief(), "coach");
    expect(coach).toContain(
      "planned sets by pattern: squat 4 · hinge 4 · push 1 · pull 0 · single-leg 0 · carry 0 · trunk 0",
    );
    expect(coach).toContain(
      "This goal also needs pull and single-leg work, which the coming week never touches — cover them",
    );
    expect(coach).toContain("back-to-back days (2026-06-16 and 2026-06-17)");
    expect(formatExerciseSelectionBrief(makeBrief(), "plan")).not.toContain("UPCOMING WEEK SHAPE");
  });

  it("explains an empty brief instead of leaving the model to guess", () => {
    const fresh = formatExerciseSelectionBrief(
      makeBrief({
        staples: [],
        needs: [],
        stationSubstitutions: [],
        limitedRegions: [],
        unavailableEquipment: [],
      }),
      "coach",
    );
    expect(fresh).toContain("FAMILIAR EXERCISES: none logged in the last 10 weeks");
    expect(fresh).toContain("NEEDS: not enough logged history");
    expect(fresh).not.toContain("CONSTRAINT FILTER");

    const settled = formatExerciseSelectionBrief(makeBrief({ needs: [] }), "coach");
    expect(settled).toContain("NEEDS: nothing stands out");
  });
});

describe("formatPrimaryLifts", () => {
  it("marks which backbone lifts are already the athlete's own", () => {
    expect(formatPrimaryLifts(makeBrief().primaryLifts)).toBe(
      "squat: back_squat (athlete's own, 9 sessions) · hinge: romanian_deadlift",
    );
  });
});

describe("buildExerciseMenu", () => {
  it("only offers keys the catalogue knows, each once", () => {
    for (const key of EXERCISE_MENU_KEYS) expect(EXERCISE_DEFINITIONS).toHaveProperty(key);
    expect(new Set(EXERCISE_MENU_KEYS).size).toBe(EXERCISE_MENU_KEYS.length);
  });

  it("still offers every key the flat list it replaced did", () => {
    const previous = [
      "skierg",
      "sled_push",
      "sled_pull",
      "burpee_broad_jump",
      "rowing",
      "farmers_carry",
      "sandbag_lunges",
      "wall_balls",
      "shuttle_run",
      "med_ball_slams",
      "step_ups",
      "run_1k",
      "easy_run",
      "recovery_run",
      "tempo_run",
      "interval_run",
      "hill_repeats",
      "fartlek_run",
      "long_run",
      "treadmill_run",
      "back_squat",
      "front_squat",
      "deadlift",
      "romanian_deadlift",
      "bench_press",
      "incline_bench_press",
      "overhead_press",
      "push_press",
      "pull_up",
      "lat_pulldown",
      "bent_over_row",
      "single_arm_dumbbell_row",
      "lunges",
      "bulgarian_split_squat",
      "hip_thrust",
      "single_leg_rdl",
      "barbell_thruster",
      "goblet_squat",
      "dumbbell_snatch",
      "burpees",
      "box_jumps",
      "assault_bike",
      "kettlebell_swings",
      "battle_ropes",
      "walking_lunges",
      "echo_bike",
      "ski_erg_intervals",
    ];
    for (const key of previous) expect(EXERCISE_MENU_KEYS).toContain(key);
  });

  it("is what the plan generator is given", () => {
    expect(PLAN_GENERATION_PROMPT).toContain(buildExerciseMenu());
    expect(buildExerciseMenu()).toContain(
      "- Hinge (posterior chain): deadlift, romanian_deadlift, trap_bar_deadlift",
    );
  });
});
