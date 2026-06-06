import type { WorkoutSuggestion } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { buildLoadGovernorSuggestions } from "./trainingLoadGovernor";
import {
  dayAhead,
  exercise,
  restriction,
  runGovernor,
  summary,
  workout,
} from "./trainingLoadGovernor.testHelpers";
import type { UpcomingWorkoutForLoad } from "./trainingLoadService";

// Suggestion *payload* shape (focus override, recommendation text, structured
// rows) lives in trainingLoadGovernor.payload.test.ts. This file covers
// rule-matching: which restrictions/workouts/dates produce suggestions, in
// which order, and how passes deduplicate.
//
// Note: the governor only reads `summary.activeRestrictions` (by id) and
// `summary.acwr` (for rationale text). It never reads `zone` or a
// restriction's `severity`, so those are left at their fixture defaults.

const D1 = dayAhead(1);

type WorkoutSpec = Partial<UpcomingWorkoutForLoad>;

/** A workout 1 day out, with `id: "w1"`, merged with the given spec. */
function nextDay(spec: WorkoutSpec = {}): UpcomingWorkoutForLoad {
  return workout({ id: "w1", date: D1, ...spec });
}

describe("buildLoadGovernorSuggestions — no-op cases", () => {
  it.each([
    {
      name: "there are no workouts",
      restrictions: [restriction("posterior_chain_velocity_lock")],
      workouts: [] as UpcomingWorkoutForLoad[],
    },
    {
      name: "no restrictions are active",
      restrictions: [],
      workouts: [nextDay({ mainWorkout: "Hill repeats" })],
    },
    {
      name: "the active restriction id is not wired to any rule",
      restrictions: [restriction("unknown_restriction_id")],
      workouts: [nextDay({ mainWorkout: "Hill repeats" })],
    },
    {
      name: "the only workout does not match the rule (mobility day)",
      restrictions: [restriction("posterior_chain_velocity_lock")],
      workouts: [
        nextDay({
          focus: "Mobility",
          mainWorkout: "Gentle stretching and breathwork",
        }),
      ],
    },
  ])("returns an empty list when $name", ({ restrictions, workouts }) => {
    expect(runGovernor(restrictions, workouts)).toEqual([]);
  });
});

describe("buildLoadGovernorSuggestions — rule matching", () => {
  // Each row: a single active restriction + a workout that should trip it.
  it.each<{
    name: string;
    rid: string;
    spec: WorkoutSpec;
    priority?: WorkoutSuggestion["priority"];
  }>([
    {
      name: "posterior — high-intensity run by text",
      rid: "posterior_chain_velocity_lock",
      spec: { mainWorkout: "Hill repeats 8x60s" },
      priority: "high",
    },
    {
      name: "posterior — high-intensity running exercise with bland text",
      rid: "posterior_chain_velocity_lock",
      spec: {
        focus: "Workout",
        mainWorkout: "Sessions",
        exerciseDetails: [exercise({ exerciseName: "interval_run", time: 30 })],
      },
    },
    {
      name: "anterior — long road run by text",
      rid: "anterior_chain_braking_guard",
      spec: { mainWorkout: "Long road run with downhill finish" },
    },
    {
      name: "anterior — long_run exercise key",
      rid: "anterior_chain_braking_guard",
      spec: {
        focus: "Workout",
        mainWorkout: "Session",
        exerciseDetails: [exercise({ exerciseName: "long_run", distance: 18000 })],
      },
    },
    {
      name: "anterior — high-intensity run (the OR branch)",
      rid: "anterior_chain_braking_guard",
      spec: { mainWorkout: "Track threshold session" },
    },
    {
      name: "elastic — sprint workout by text",
      rid: "elastic_tendon_speed_guard",
      spec: { mainWorkout: "Track sprint session" },
    },
    {
      name: "elastic — box_jumps plyo exercise",
      rid: "elastic_tendon_speed_guard",
      spec: {
        focus: "Plyo",
        mainWorkout: "Bounding circuit",
        exerciseDetails: [exercise({ exerciseName: "box_jumps", category: "conditioning" })],
      },
    },
    {
      name: "elastic — jump_rope exercise",
      rid: "elastic_tendon_speed_guard",
      spec: {
        focus: "Conditioning",
        mainWorkout: "Skip and stretch",
        exerciseDetails: [exercise({ exerciseName: "jump_rope", category: "conditioning" })],
      },
    },
    {
      name: "yellow — high-intensity run (priority medium)",
      rid: "acwr_yellow_guard",
      spec: { mainWorkout: "Threshold track intervals" },
      priority: "medium",
    },
    {
      name: "yellow — high-tax strength via the heavy exercise list",
      rid: "acwr_yellow_guard",
      spec: {
        focus: "Strength",
        mainWorkout: "Working sets",
        exerciseDetails: [
          exercise({
            exerciseName: "deadlift",
            category: "strength",
            reps: 5,
            weight: 200,
          }),
        ],
      },
    },
    {
      name: "danger — high-intensity run (priority high)",
      rid: "acwr_danger_lock",
      spec: { mainWorkout: "Sprint intervals" },
      priority: "high",
    },
    {
      name: "danger — generic strength (broader than yellow)",
      rid: "acwr_danger_lock",
      spec: { focus: "Strength", mainWorkout: "Accessory circuit" },
    },
    {
      name: "on-ramp — strength day (priority medium)",
      rid: "acwr_onramp",
      spec: { focus: "Strength", mainWorkout: "Working sets" },
      priority: "medium",
    },
  ])("matches $name", ({ rid, spec, priority }) => {
    const result = runGovernor([restriction(rid)], [nextDay(spec)]);
    expect(result).toHaveLength(1);
    expect(result[0].rationaleCode).toBe(rid);
    if (priority) {
      expect(result[0].suggestion.priority).toBe(priority);
    }
  });

  it.each<{ name: string; rid: string; spec: WorkoutSpec }>([
    {
      name: "posterior ignores an easy aerobic run (no high-intensity tokens)",
      rid: "posterior_chain_velocity_lock",
      spec: { mainWorkout: "Conversational easy aerobic" },
    },
    {
      name: "posterior ignores a strength-only day (not a running workout)",
      rid: "posterior_chain_velocity_lock",
      spec: { focus: "Strength", mainWorkout: "Heavy deadlifts" },
    },
    {
      name: "yellow ignores low-tax accessory strength",
      rid: "acwr_yellow_guard",
      spec: { focus: "Strength", mainWorkout: "Light mobility flow" },
    },
    {
      name: "on-ramp ignores rest / mobility days",
      rid: "acwr_onramp",
      spec: { focus: "Rest", mainWorkout: "Walk and stretch" },
    },
  ])("does not match: $name", ({ rid, spec }) => {
    expect(runGovernor([restriction(rid)], [nextDay(spec)])).toEqual([]);
  });
});

describe("buildLoadGovernorSuggestions — date windows", () => {
  // Each rule has a `maxDaysAhead`; the last in-window day must produce a
  // suggestion and the next day must not.
  it.each<{ name: string; rid: string; window: number; spec: WorkoutSpec }>([
    {
      name: "posterior (2 days)",
      rid: "posterior_chain_velocity_lock",
      window: 2,
      spec: { mainWorkout: "Hill repeats" },
    },
    {
      name: "anterior (3 days)",
      rid: "anterior_chain_braking_guard",
      window: 3,
      spec: { mainWorkout: "Long road run" },
    },
    {
      name: "yellow (2 days)",
      rid: "acwr_yellow_guard",
      window: 2,
      spec: { mainWorkout: "Threshold intervals" },
    },
    {
      name: "danger (4 days)",
      rid: "acwr_danger_lock",
      window: 4,
      spec: { focus: "Strength", mainWorkout: "Accessory work" },
    },
    {
      name: "on-ramp (3 days)",
      rid: "acwr_onramp",
      window: 3,
      spec: { focus: "Strength", mainWorkout: "Squats" },
    },
  ])("includes the last in-window day and excludes the next — $name", ({ rid, window, spec }) => {
    const inWindow = runGovernor(
      [restriction(rid)],
      [workout({ id: "in", date: dayAhead(window), ...spec })],
    );
    const pastWindow = runGovernor(
      [restriction(rid)],
      [workout({ id: "out", date: dayAhead(window + 1), ...spec })],
    );
    expect(inWindow).toHaveLength(1);
    expect(pastWindow).toEqual([]);
  });

  it("includes the same-day workout (daysAhead = 0)", () => {
    const result = runGovernor(
      [restriction("posterior_chain_velocity_lock")],
      [workout({ id: "today", date: dayAhead(0), mainWorkout: "Hill repeats" })],
    );
    expect(result).toHaveLength(1);
  });

  it("excludes workouts dated in the past", () => {
    const result = runGovernor(
      [restriction("posterior_chain_velocity_lock")],
      [workout({ id: "yesterday", date: dayAhead(-1), mainWorkout: "Hill repeats" })],
    );
    expect(result).toEqual([]);
  });

  it("processes workouts in chronological order even when input is out of order", () => {
    const result = runGovernor(
      [restriction("acwr_onramp")],
      [
        workout({ id: "later", date: dayAhead(3), focus: "Strength", mainWorkout: "Squats" }),
        workout({ id: "earlier", date: D1, focus: "Strength", mainWorkout: "Deadlift" }),
      ],
    );
    expect(result.map((s) => s.suggestion.workoutId)).toEqual(["earlier", "later"]);
  });

  it("defaults the current date to today when omitted (past workouts ⇒ empty)", () => {
    // Only past workouts are passed, so the test is timezone-stable: the
    // function should derive today from the system clock and filter them out.
    // We call the SUT directly here (skipping the runGovernor helper, which
    // has its own CURRENT_DATE default) so the omitted argument really does
    // exercise buildLoadGovernorSuggestions's internal default-to-today path.
    const result = buildLoadGovernorSuggestions(
      summary([restriction("posterior_chain_velocity_lock")]),
      [workout({ id: "ancient", date: "1999-01-01", mainWorkout: "Hill repeats" })],
    );
    expect(result).toEqual([]);
  });
});

describe("buildLoadGovernorSuggestions — ACWR rationale text", () => {
  it("embeds the numeric ACWR when known", () => {
    const result = runGovernor(
      [restriction("acwr_yellow_guard")],
      [nextDay({ mainWorkout: "Threshold track intervals" })],
      { acwr: 1.4 },
    );
    expect(result[0].suggestion.rationale).toContain("ACWR is 1.4");
  });

  it("falls back to 'above target' when ACWR is null", () => {
    const result = runGovernor(
      [restriction("acwr_yellow_guard")],
      [nextDay({ mainWorkout: "Threshold track intervals" })],
      { acwr: null },
    );
    expect(result[0].suggestion.rationale).toContain("ACWR is above target");
  });
});

describe("buildLoadGovernorSuggestions — on-ramp cap", () => {
  it("caps on-ramp suggestions at three even when more workouts match", () => {
    const result = runGovernor(
      [restriction("acwr_onramp")],
      [
        workout({ id: "w1", date: D1, focus: "Strength", mainWorkout: "Squats" }),
        workout({ id: "w2", date: D1, focus: "Strength", mainWorkout: "Deadlift" }),
        workout({ id: "w3", date: dayAhead(2), focus: "Strength", mainWorkout: "Sled push" }),
        workout({ id: "w4", date: dayAhead(3), focus: "Strength", mainWorkout: "Lunges" }),
        workout({ id: "w5", date: dayAhead(3), focus: "Strength", mainWorkout: "Squats" }),
      ],
    );
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.suggestion.workoutId)).toEqual(["w1", "w2", "w3"]);
  });
});

describe("buildLoadGovernorSuggestions — cross-pass dedup and precedence", () => {
  it("posterior (pass 1) wins over acwr_danger_lock (pass 3) for the same workout", () => {
    const result = runGovernor(
      [restriction("posterior_chain_velocity_lock"), restriction("acwr_danger_lock")],
      [nextDay({ mainWorkout: "Hill repeats" })],
    );
    expect(result).toHaveLength(1);
    expect(result[0].rationaleCode).toBe("posterior_chain_velocity_lock");
  });

  it("within pass 1, posterior wins over elastic regardless of restriction order", () => {
    // Rules are declared in fixed order (posterior, anterior, elastic); a
    // workout matching several gets the first, independent of how the
    // restrictions are ordered in the summary.
    const result = runGovernor(
      [restriction("elastic_tendon_speed_guard"), restriction("posterior_chain_velocity_lock")],
      [nextDay({ mainWorkout: "Hill repeats" })],
    );
    expect(result).toHaveLength(1);
    expect(result[0].rationaleCode).toBe("posterior_chain_velocity_lock");
  });

  it("a workout claimed by an earlier pass is skipped by the on-ramp pass", () => {
    const result = runGovernor(
      [restriction("posterior_chain_velocity_lock"), restriction("acwr_onramp")],
      [workout({ id: "claimed", date: D1, mainWorkout: "Hill repeats" })],
    );
    expect(result).toHaveLength(1);
    expect(result[0].rationaleCode).toBe("posterior_chain_velocity_lock");
  });

  it("different workouts are assigned to the passes they each match", () => {
    // The run is high-intensity ⇒ pass 1 (posterior) claims it. The strength
    // day is high-tax but not a run, so it falls through to pass 2 (yellow).
    // Workouts are date-sorted, so the earlier hill day comes first.
    const result = runGovernor(
      [restriction("posterior_chain_velocity_lock"), restriction("acwr_yellow_guard")],
      [
        workout({ id: "hill", date: D1, mainWorkout: "Hill repeats" }),
        workout({
          id: "lift",
          date: dayAhead(2),
          focus: "Strength",
          mainWorkout: "Heavy deadlift triples",
        }),
      ],
    );
    expect(result.map((s) => s.rationaleCode)).toEqual([
      "posterior_chain_velocity_lock",
      "acwr_yellow_guard",
    ]);
  });
});
