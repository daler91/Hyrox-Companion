import { EXERCISE_EQUIPMENT } from "@shared/exerciseEquipment";
import { HYROX_STATION_ORDER } from "@shared/raceConstants";
import { EXERCISE_DEFINITIONS, MOVEMENT_PATTERNS } from "@shared/schema/exercises";
import { describe, expect, it } from "vitest";

import {
  LENS_SUMMARIES,
  LIFT_VARIATIONS,
  NEED_POOLS,
  PATTERN_GROUP_BY_MOVEMENT,
  PATTERN_GROUP_LABELS,
  PATTERN_GROUPS,
  PRIMARY_DEFAULTS,
  PRIMARY_ELIGIBLE,
  PRIMARY_SLOT_LABELS,
  PRIMARY_SLOTS_BY_LENS,
  STATION_BUILDERS,
  STATION_SUBSTITUTES,
  STRESS_REGION_EXERCISES,
  STRESS_REGION_LABELS,
} from "./exerciseKnowledge";
import {
  buildExerciseSelectionBrief,
  classifyGoalLens,
  type ExerciseSelectionInput,
  parseConstraintProfile,
  type SelectionSet,
} from "./exerciseSelection";

const TODAY = "2026-06-15";

/** One logged set; each date is its own session unless a log id is given. */
function set(
  exerciseName: string,
  date: string,
  overrides: Partial<SelectionSet> = {},
): SelectionSet {
  return { exerciseName, date, workoutLogId: `log-${date}`, ...overrides };
}

/** `count` identical sets of one exercise on one date. */
function sets(
  exerciseName: string,
  date: string,
  count: number,
  overrides: Partial<SelectionSet> = {},
): SelectionSet[] {
  return Array.from({ length: count }, () => set(exerciseName, date, overrides));
}

function brief(overrides: Partial<ExerciseSelectionInput> = {}) {
  return buildExerciseSelectionBrief({
    experienceLevel: "intermediate",
    today: TODAY,
    weightUnit: "kg",
    distanceUnit: "km",
    sets: [],
    ...overrides,
  });
}

function candidateNames(needReason: RegExp, result: ReturnType<typeof brief>): string[] {
  const need = result.needs.find((n) => needReason.test(n.reason));
  return need ? need.candidates.map((c) => c.exercise) : [];
}

/** Six sessions over the last four weeks, heavy on pushing and squatting. */
function pushHeavyHistory(): SelectionSet[] {
  const dates = [
    "2026-05-20",
    "2026-05-25",
    "2026-05-30",
    "2026-06-04",
    "2026-06-09",
    "2026-06-13",
  ];
  return dates.flatMap((date) => [
    ...sets("bench_press", date, 3, { reps: 5, weight: 80, weightUnit: "kg" }),
    ...sets("back_squat", date, 3, { reps: 5, weight: 100, weightUnit: "kg" }),
    ...(date >= "2026-06-04"
      ? sets("seated_cable_row", date, 2, { reps: 10, weight: 50, weightUnit: "kg" })
      : []),
  ]);
}

describe("exercise knowledge tables", () => {
  it("only ever names exercises that exist in the catalogue", () => {
    // Keys are typed, but arrays built by spreading could still smuggle a
    // string in; this is the runtime half of that guarantee.
    const named = [
      ...Object.values(NEED_POOLS).flat(),
      ...[...STATION_BUILDERS.values()].flat(),
      ...[...STATION_SUBSTITUTES.values()].flat(),
      ...LIFT_VARIATIONS.keys(),
      ...[...LIFT_VARIATIONS.values()].flat(),
      ...[...PRIMARY_ELIGIBLE.values()].flat(),
      ...[...PRIMARY_DEFAULTS.values()].flatMap((defaults) => [
        ...defaults.standard,
        ...(defaults.beginner ?? []),
        ...[...(defaults.byLens?.values() ?? [])].flat(),
      ]),
      ...Object.keys(EXERCISE_EQUIPMENT),
    ];
    for (const exercise of named) expect(EXERCISE_DEFINITIONS).toHaveProperty(exercise);
  });

  it("covers every goal, slot, pattern group, movement pattern and body region", () => {
    const sorted = (keys: Iterable<string>) => [...keys].sort((a, b) => a.localeCompare(b));
    const lenses = sorted(Object.keys(LENS_SUMMARIES));
    const slots = sorted(Object.keys(PRIMARY_SLOT_LABELS));
    expect(sorted(PRIMARY_SLOTS_BY_LENS.keys())).toEqual(lenses);
    expect(sorted(PRIMARY_ELIGIBLE.keys())).toEqual(slots);
    expect(sorted(PRIMARY_DEFAULTS.keys())).toEqual(slots);
    expect(sorted(PATTERN_GROUP_LABELS.keys())).toEqual(sorted(PATTERN_GROUPS));
    expect(sorted(PATTERN_GROUP_BY_MOVEMENT.keys())).toEqual(
      sorted(MOVEMENT_PATTERNS.map((entry) => entry.pattern)),
    );
    expect(sorted(STRESS_REGION_EXERCISES.keys())).toEqual(sorted(STRESS_REGION_LABELS.keys()));
  });

  it("covers every station, and lists each station first among its own builders", () => {
    expect([...STATION_BUILDERS.keys()]).toEqual([...HYROX_STATION_ORDER]);
    expect([...STATION_SUBSTITUTES.keys()]).toEqual([...HYROX_STATION_ORDER]);
    for (const [station, builders] of STATION_BUILDERS) expect(builders.at(0)).toBe(station);
  });
});

describe("classifyGoalLens", () => {
  it.each([
    ["Sub-90 HYROX in March", "hyrox"],
    ["Hyrox doubles — improve my running", "hyrox"],
    ["Run a half marathon under 1:45", "running"],
    ["Halfmarathon PB", "running"],
    ["First 10k", "running"],
    ["Squat 140kg and bench bodyweight", "strength"],
    ["First powerlifting meet", "strength"],
    ["Get stronger and run a sub-20 5k", "hybrid"],
    ["Lose 10kg before summer", "weight_loss"],
    ["Feel fitter", "general"],
  ])("classifies %j as %s", (goal, lens) => {
    expect(classifyGoalLens(goal)).toBe(lens);
  });

  it("does not read a weight in kg as a race distance", () => {
    expect(classifyGoalLens("Lose 5kg")).toBe("weight_loss");
  });

  it("falls back to the wizard's focus areas for a vague goal", () => {
    expect(classifyGoalLens("Get fit", ["wall_balls", "running"])).toBe("hyrox");
    expect(classifyGoalLens(null, ["running", "strength"])).toBe("hybrid");
    expect(classifyGoalLens("", [])).toBe("general");
  });
});

describe("parseConstraintProfile", () => {
  it("reads equipment the athlete says they don't have", () => {
    const profile = parseConstraintProfile("No sled at my gym and no rower");
    expect([...profile.unavailable].sort((a, b) => a.localeCompare(b))).toEqual(["rower", "sled"]);
    expect(parseConstraintProfile("I cannot access a barbell").unavailable).toEqual(
      new Set(["barbell"]),
    );
  });

  it("keeps a negation inside its own sentence", () => {
    expect(parseConstraintProfile("No sled. Barbell work is fine").unavailable).toEqual(
      new Set(["sled"]),
    );
  });

  it("treats 'only X' as ruling out everything not named", () => {
    const profile = parseConstraintProfile("Home gym — just dumbbells and a pull-up bar");
    expect(profile.unavailable.has("barbell")).toBe(true);
    expect(profile.unavailable.has("machine")).toBe(true);
    expect(profile.unavailable.has("sled")).toBe(true);
    expect(profile.unavailable.has("dumbbell")).toBe(false);
    expect(profile.unavailable.has("pullup_bar")).toBe(false);

    const pair = parseConstraintProfile("barbell and dumbbells only");
    expect(pair.unavailable.has("machine")).toBe(true);
    expect(pair.unavailable.has("barbell")).toBe(false);
    expect(pair.unavailable.has("dumbbell")).toBe(false);
  });

  it("needs a limiting word before ruling a movement out", () => {
    expect(parseConstraintProfile("lunges hurt my left knee").excluded.has("walking_lunges")).toBe(
      true,
    );
    expect(
      parseConstraintProfile("can't do burpees (wrist)").excluded.has("burpee_broad_jump"),
    ).toBe(true);
    expect(parseConstraintProfile("plyometrics aggravate my knee").excluded.has("box_jumps")).toBe(
      true,
    );
    expect(parseConstraintProfile("I love lunges").excluded.size).toBe(0);
    expect(parseConstraintProfile("No rower. Lunges are my favourite").excluded.size).toBe(0);
  });

  it("maps body regions to the stress they limit", () => {
    expect([...parseConstraintProfile("achilles tendinopathy").regions]).toEqual([
      "lower_limb_impact",
    ]);
    expect([...parseConstraintProfile("shoulder impingement").regions]).toEqual(["overhead"]);
    expect([...parseConstraintProfile("lower back pain when deadlifting").regions]).toEqual([
      "spinal_load",
    ]);
  });

  it("is empty for no constraints", () => {
    const profile = parseConstraintProfile("   ");
    expect(profile.unavailable.size + profile.excluded.size + profile.regions.size).toBe(0);
  });
});

describe("buildExerciseSelectionBrief — familiar exercises", () => {
  it("lists the athlete's own exercises, most-practised first, with their last session", () => {
    const result = brief({
      sets: [
        ...sets("back_squat", "2026-06-01", 3, { reps: 5, weight: 95, weightUnit: "kg" }),
        ...sets("back_squat", "2026-06-08", 2, { reps: 5, weight: 100, weightUnit: "kg" }),
        set("back_squat", "2026-06-12", { reps: 3, weight: 100, weightUnit: "kg" }),
        ...sets("romanian_deadlift", "2026-06-02", 3, { reps: 8, weight: 80, weightUnit: "kg" }),
        ...sets("romanian_deadlift", "2026-06-09", 3, { reps: 8, weight: 80, weightUnit: "kg" }),
        set("hip_thrust", "2026-06-10", { reps: 10, weight: 60 }),
      ],
    });

    expect(result.staples.map((s) => s.exercise)).toEqual(["back_squat", "romanian_deadlift"]);
    expect(result.staples[0]).toEqual({
      exercise: "back_squat",
      sessions: 3,
      daysSince: 3,
      lastSession: "1 set, top 100 kg x 3",
    });
  });

  it("describes distance work by distance and time, and keeps custom exercises by name", () => {
    const result = brief({
      sets: [
        set("easy_run", "2026-06-10", { distance: 8000, distanceUnit: "m", time: 42 }),
        set("easy_run", "2026-06-13", { distance: 6000, distanceUnit: "m", time: 33 }),
        set("custom", "2026-06-11", { customLabel: "Hyrox Class" }),
        set("custom", "2026-06-14", { customLabel: "Hyrox Class" }),
      ],
    });

    expect(result.staples.find((s) => s.exercise === "easy_run")?.lastSession).toBe(
      "6000 m in 33min",
    );
    expect(result.staples.map((s) => s.exercise)).toContain("custom:Hyrox Class");
  });

  it("reads a set in its own stamped unit and reports it in the athlete's", () => {
    const result = brief({
      weightUnit: "lbs",
      sets: [
        set("deadlift", "2026-06-01", { reps: 5, weight: 100, weightUnit: "kg" }),
        set("deadlift", "2026-06-08", { reps: 5, weight: 100, weightUnit: "kg" }),
      ],
    });
    expect(result.staples[0]?.lastSession).toBe("1 set, top 220 lbs x 5");
  });
});

describe("buildExerciseSelectionBrief — needs", () => {
  it("flags a push-heavy history and offers pulls, the familiar one first", () => {
    const result = brief({ goal: "Get stronger", sets: pushHeavyHistory() });
    const need = result.needs.find((n) => n.kind === "balance" && n.reason.startsWith("Pulling"));
    expect(need?.reason).toBe("Pulling is 6 sets vs 18 pushing sets in the last 4 weeks");
    expect(need?.candidates[0]).toEqual({ exercise: "seated_cable_row", sessions: 3 });
    // Rows and vertical pulls both make the cut, not four variations of one.
    expect(need?.candidates.map((c) => c.exercise)).toEqual([
      "seated_cable_row",
      "pull_up",
      "single_arm_dumbbell_row",
      "chin_up",
    ]);
  });

  it("flags two-legged-only lower body work for a strength athlete", () => {
    const result = brief({ goal: "Get stronger", sets: pushHeavyHistory() });
    expect(candidateNames(/two-legged/, result)).toContain("bulgarian_split_squat");
  });

  it("detects a stalled lift and offers variations of the same pattern plus a method", () => {
    const stalled = ["2026-05-30", "2026-06-06", "2026-06-13"].flatMap((date) =>
      sets("bench_press", date, 3, { reps: 5, weight: 80, weightUnit: "kg" }),
    );
    const result = brief({ goal: "Get stronger", sets: stalled });
    const need = result.needs.find((n) => n.kind === "stall");
    expect(need?.reason).toBe("Bench Press has stalled at 80 kg x 5 for 3 sessions");
    expect(need?.candidates.map((c) => c.exercise)).not.toContain("bench_press");
    expect(need?.candidates.map((c) => c.exercise)).toContain("close_grip_bench_press");
    expect(need?.method).toMatch(/tempo/);
  });

  it("does not call same-load-more-reps a stall", () => {
    const progressing = [
      ...sets("bench_press", "2026-05-30", 3, { reps: 5, weight: 80, weightUnit: "kg" }),
      ...sets("bench_press", "2026-06-06", 3, { reps: 6, weight: 80, weightUnit: "kg" }),
      ...sets("bench_press", "2026-06-13", 3, { reps: 7, weight: 80, weightUnit: "kg" }),
    ];
    expect(brief({ sets: progressing }).needs.some((n) => n.kind === "stall")).toBe(false);
  });

  it("puts a stale HYROX station first among its own builders", () => {
    const result = brief({
      goal: "HYROX Pro",
      sets: pushHeavyHistory(),
      stationGaps: [
        { station: "wall_balls", daysSince: 16 },
        { station: "skierg", daysSince: 3 },
      ],
    });
    const need = result.needs.find((n) => n.kind === "station_gap");
    expect(need?.reason).toBe("Wall Balls: not trained for 16 days");
    expect(need?.candidates.map((c) => c.exercise)).toEqual([
      "wall_balls",
      "dumbbell_thruster",
      "front_squat",
      "push_press",
    ]);
    expect(result.needs.some((n) => n.reason.startsWith("SkiErg"))).toBe(false);
  });

  it("prepares for a station the athlete's gym can't host with substitutes, not a gap to close", () => {
    const result = brief({
      goal: "HYROX",
      constraints: "No sled at my gym",
      sets: pushHeavyHistory(),
      stationGaps: [{ station: "sled_push", daysSince: null }],
    });
    expect(result.needs.some((need) => need.reason.startsWith("Sled Push"))).toBe(false);
    expect(result.stationSubstitutions.map((s) => s.station)).toEqual(["sled_push", "sled_pull"]);
    expect(result.stationSubstitutions[0]?.substitutes[0]?.exercise).toBe("leg_press");
  });

  it("ignores 'never trained' stations for an athlete with no history yet", () => {
    const result = brief({
      goal: "HYROX",
      stationGaps: [{ station: "sled_push", daysSince: null }],
    });
    expect(result.needs).toEqual([]);
  });

  it("never nags a runner about HYROX stations", () => {
    const result = brief({
      goal: "Marathon PB",
      sets: pushHeavyHistory(),
      stationGaps: [{ station: "sled_push", daysSince: null }],
    });
    expect(result.needs.some((n) => n.kind === "station_gap")).toBe(false);
    expect(result.raceStandards).toBeNull();
  });

  it("asks a runner for the durability work their logs are missing", () => {
    const runs = [
      "2026-05-25",
      "2026-05-29",
      "2026-06-02",
      "2026-06-06",
      "2026-06-10",
      "2026-06-13",
    ].map((date) => set("easy_run", date, { distance: 8000, distanceUnit: "m", time: 45 }));
    const reasons = brief({ goal: "Half marathon", sets: runs }).needs.map((n) => n.reason);
    expect(reasons).toEqual([
      "No single-leg work in the last 4 weeks (running is single-leg: this is what protects knees and hips)",
      "No hinge work in the last 4 weeks (posterior-chain strength drives stride power)",
      "No trunk work in the last 4 weeks (trunk stiffness keeps form together late in a run)",
      "No calf or foot strength in the last 4 weeks (the lower leg absorbs the most load in running)",
    ]);
  });

  it("ranks the athlete's chosen focus areas above everything else", () => {
    const result = brief({
      goal: "HYROX",
      focusAreas: ["sled_pull"],
      sets: pushHeavyHistory(),
      stationGaps: [{ station: "wall_balls", daysSince: 20 }],
    });
    expect(result.needs[0]?.kind).toBe("focus_area");
    expect(result.needs[0]?.candidates[0]?.exercise).toBe("sled_pull");
  });

  it("keeps high-skill lifts away from a beginner", () => {
    const result = brief({
      goal: "Get stronger",
      experienceLevel: "beginner",
      sets: pushHeavyHistory(),
    });
    const all = result.needs.flatMap((n) => n.candidates.map((c) => c.exercise));
    expect(all).not.toContain("nordic_hamstring_curl");
    expect(all).not.toContain("good_morning");
  });

  it("drops impact work everywhere when the constraints mention a lower-limb injury", () => {
    const result = brief({
      goal: "HYROX",
      constraints: "Recovering from a knee injury",
      sets: pushHeavyHistory(),
      stationGaps: [{ station: "burpee_broad_jump", daysSince: 30 }],
    });
    const impact = ["burpee_broad_jump", "burpees", "box_jumps", "jump_rope"];
    const nominated = [
      ...result.needs.flatMap((need) => need.candidates),
      ...result.stationSubstitutions.flatMap((substitution) => substitution.substitutes),
    ].map((candidate) => candidate.exercise);
    for (const exercise of impact) expect(nominated).not.toContain(exercise);
    expect(result.stationSubstitutions.map((substitution) => substitution.station)).toEqual([
      "burpee_broad_jump",
    ]);
    expect(result.limitedRegions).toEqual(["lower_limb_impact"]);
  });

  it("never returns more than seven needs", () => {
    const result = brief({
      goal: "HYROX",
      focusAreas: ["sled_push", "sled_pull", "wall_balls", "rowing", "skierg"],
      sets: pushHeavyHistory(),
      stationGaps: [
        { station: "farmers_carry", daysSince: 40 },
        { station: "sandbag_lunges", daysSince: 40 },
      ],
    });
    expect(result.needs).toHaveLength(7);
  });

  it("ranks a whole missing pattern above a stalled lift, and caps stale stations at two", () => {
    const stalledSquatter = [
      "2026-05-20",
      "2026-05-27",
      "2026-06-03",
      "2026-06-06",
      "2026-06-10",
      "2026-06-13",
    ].flatMap((date) => sets("back_squat", date, 4, { reps: 5, weight: 100, weightUnit: "kg" }));
    const result = brief({
      goal: "HYROX",
      sets: stalledSquatter,
      stationGaps: ["skierg", "rowing", "burpee_broad_jump", "wall_balls"].map((station) => ({
        station,
        daysSince: null,
      })),
    });
    const kinds = result.needs.map((need) => need.kind);
    expect(kinds.filter((kind) => kind === "station_gap")).toHaveLength(2);
    expect(kinds.indexOf("missing_pattern")).toBeLessThan(kinds.indexOf("stall"));
    expect(result.needs.map((need) => need.reason)).toContain(
      "No pull work in the last 4 weeks (pulling strength for the sled pull, row and SkiErg)",
    );
  });

  it("does not repeat a pattern a stale station already stands for", () => {
    const result = brief({
      goal: "HYROX",
      sets: pushHeavyHistory(),
      stationGaps: [{ station: "farmers_carry", daysSince: 30 }],
    });
    const reasons = result.needs.map((need) => need.reason);
    expect(reasons).toContain("Farmers Carry: not trained for 30 days");
    expect(reasons.some((reason) => reason.startsWith("No carry work"))).toBe(false);
    expect(reasons.some((reason) => reason.startsWith("No single-leg work"))).toBe(true);
  });
});

describe("buildExerciseSelectionBrief — race standards", () => {
  it("states the athlete's own race loads for a HYROX goal", () => {
    expect(brief({ goal: "HYROX", division: "open", gender: "male" }).raceStandards).toBe(
      "open, men: sled push 152 kg · sled pull 103 kg · farmers carry 2 x 24 kg · sandbag lunges 20 kg · wall balls 6 kg",
    );
  });

  it("converts to the athlete's unit and shows both categories when gender is unset", () => {
    expect(brief({ goal: "HYROX", division: "pro", weightUnit: "lbs" }).raceStandards).toContain(
      "wall balls 13 / 20 lbs",
    );
  });
});

describe("buildExerciseSelectionBrief — upcoming week shape", () => {
  it("counts planned sets by pattern and names what the goal needs but the week lacks", () => {
    const result = brief({
      goal: "HYROX",
      upcoming: [
        {
          date: "2026-06-16",
          sets: [
            { exerciseName: "back_squat", weight: 100 },
            { exerciseName: "back_squat", weight: 100 },
            { exerciseName: "back_squat", weight: 100 },
            { exerciseName: "back_squat", weight: 100 },
          ],
        },
        {
          date: "2026-06-17",
          sets: [
            { exerciseName: "deadlift", weight: 140 },
            { exerciseName: "deadlift", weight: 140 },
            { exerciseName: "deadlift", weight: 140 },
            { exerciseName: "deadlift", weight: 140 },
            { exerciseName: "bench_press", weight: 80 },
          ],
        },
        { date: "2026-06-19", sets: [{ exerciseName: "easy_run" }] },
        { date: "2026-06-20", sets: [] },
      ],
    });
    expect(result.upcomingShape).toEqual({
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
      missing: ["single_leg", "carry", "pull"],
      backToBackLowerBody: [["2026-06-16", "2026-06-17"]],
    });
  });

  it("stays silent with fewer than two structured days", () => {
    expect(
      brief({ upcoming: [{ date: "2026-06-16", sets: [{ exerciseName: "back_squat" }] }] })
        .upcomingShape,
    ).toBeNull();
    expect(brief().upcomingShape).toBeNull();
  });
});

describe("buildExerciseSelectionBrief — primary lifts", () => {
  it("keeps the athlete's own lifts as the backbone and fills the rest with defaults", () => {
    const result = brief({ goal: "Get stronger", sets: pushHeavyHistory() });
    expect(result.primaryLifts).toEqual([
      { slot: "squat", exercise: "back_squat", sessions: 6 },
      { slot: "hinge", exercise: "deadlift", sessions: 0 },
      { slot: "horizontal_push", exercise: "bench_press", sessions: 6 },
      { slot: "vertical_push", exercise: "overhead_press", sessions: 0 },
      { slot: "pull", exercise: "seated_cable_row", sessions: 3 },
    ]);
  });

  it("picks low-skill, equipment-appropriate defaults for a beginner training at home", () => {
    const result = brief({
      goal: "Lose weight",
      experienceLevel: "beginner",
      constraints: "only dumbbells at home",
    });
    expect(result.primaryLifts.map((lift) => lift.exercise)).toEqual([
      "goblet_squat",
      "romanian_deadlift",
      "dumbbell_bench_press",
      "single_arm_dumbbell_row",
      "step_ups",
    ]);
  });

  it("builds a runner's backbone around single-leg strength and calves", () => {
    expect(brief({ goal: "Marathon" }).primaryLifts.map((lift) => lift.slot)).toEqual([
      "single_leg",
      "hinge",
      "squat",
      "calves",
    ]);
  });
});
