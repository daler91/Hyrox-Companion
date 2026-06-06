import { describe, expect, it } from "vitest";

import { buildLoadGovernorSuggestions } from "./trainingLoadGovernor";
import {
  CURRENT_DATE,
  exercise,
  restriction,
  summary,
  workout,
} from "./trainingLoadGovernor.testHelpers";

// Suggestion *payload* shape (focus override, recommendation text, structured
// rows) lives in trainingLoadGovernor.payload.test.ts. This file covers
// rule-matching: which restrictions/workouts/dates produce suggestions, in
// which order, and how passes deduplicate.
describe("buildLoadGovernorSuggestions — no-op cases", () => {
  it("returns an empty list when there are no workouts", () => {
    expect(
      buildLoadGovernorSuggestions(
        summary([restriction("posterior_chain_velocity_lock")]),
        [],
        CURRENT_DATE,
      ),
    ).toEqual([]);
  });

  it("returns an empty list when no restrictions are active", () => {
    expect(
      buildLoadGovernorSuggestions(
        summary([]),
        [
          workout({
            id: "w1",
            date: "2026-05-23",
            focus: "Run",
            mainWorkout: "Hill repeats",
          }),
        ],
        CURRENT_DATE,
      ),
    ).toEqual([]);
  });

  it("ignores restrictions whose IDs are not wired to any rule", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("unknown_restriction_id")]),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Run",
          mainWorkout: "Hill repeats",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result).toEqual([]);
  });

  it("returns no suggestion when the only matching workout is yoga-only", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("posterior_chain_velocity_lock")]),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Mobility",
          mainWorkout: "Gentle stretching and breathwork",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result).toEqual([]);
  });
});

describe("buildLoadGovernorSuggestions — date window boundaries", () => {
  it("excludes workouts dated in the past", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("posterior_chain_velocity_lock")]),
      [
        workout({
          id: "yesterday",
          date: "2026-05-21",
          focus: "Run",
          mainWorkout: "Hill repeats",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result).toEqual([]);
  });

  it("includes a workout exactly at the maxDaysAhead boundary (posterior: 2 days)", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("posterior_chain_velocity_lock")]),
      [
        workout({
          id: "w1",
          date: "2026-05-24",
          focus: "Run",
          mainWorkout: "Hill repeats",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result).toHaveLength(1);
  });

  it("excludes a workout one day past the maxDaysAhead boundary (posterior: 2 days)", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("posterior_chain_velocity_lock")]),
      [
        workout({
          id: "w1",
          date: "2026-05-25",
          focus: "Run",
          mainWorkout: "Hill repeats",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result).toEqual([]);
  });

  it("includes the same-day workout (daysAhead = 0)", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("posterior_chain_velocity_lock")]),
      [
        workout({
          id: "today",
          date: CURRENT_DATE,
          focus: "Run",
          mainWorkout: "Hill repeats",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result).toHaveLength(1);
  });

  it("processes workouts in chronological order even when input is out of order", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("acwr_onramp")], {
        zone: "undertraining",
        acwr: 0.6,
      }),
      [
        workout({
          id: "later",
          date: "2026-05-25",
          focus: "Strength",
          mainWorkout: "Squats",
        }),
        workout({
          id: "earlier",
          date: "2026-05-23",
          focus: "Strength",
          mainWorkout: "Deadlift",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result.map((s) => s.suggestion.workoutId)).toEqual(["earlier", "later"]);
  });

  it("defaults the current date to today when not provided (no future workouts ⇒ empty result)", () => {
    // We pass only past workouts so the test is timezone-stable — the
    // function should derive today from the system clock and filter them
    // out as past dates.
    const result = buildLoadGovernorSuggestions(
      summary([restriction("posterior_chain_velocity_lock")]),
      [
        workout({
          id: "ancient",
          date: "1999-01-01",
          focus: "Run",
          mainWorkout: "Hill repeats",
        }),
      ],
    );
    expect(result).toEqual([]);
  });
});

describe("buildLoadGovernorSuggestions — posterior chain velocity lock", () => {
  it("matches a high-intensity run by mainWorkout text", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("posterior_chain_velocity_lock")]),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Run",
          mainWorkout: "Hill repeats 8x60s",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result).toHaveLength(1);
    expect(result[0].rationaleCode).toBe("posterior_chain_velocity_lock");
    expect(result[0].suggestion.priority).toBe("high");
  });

  it("matches via a high-intensity running exercise even when text is bland", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("posterior_chain_velocity_lock")]),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Workout",
          mainWorkout: "Sessions",
          exerciseDetails: [
            exercise({
              exerciseName: "interval_run",
              category: "running",
              time: 30,
            }),
          ],
        }),
      ],
      CURRENT_DATE,
    );
    expect(result[0].rationaleCode).toBe("posterior_chain_velocity_lock");
  });

  it("does NOT match an easy aerobic run (no high-intensity tokens)", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("posterior_chain_velocity_lock")]),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Run",
          mainWorkout: "Conversational easy aerobic",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result).toEqual([]);
  });

  it("does NOT match a strength-only workout even with high-intensity language", () => {
    // Posterior rule requires isRunningWorkout AND isHighIntensityRun.
    // "Strength" focus would fail the running predicate.
    const result = buildLoadGovernorSuggestions(
      summary([restriction("posterior_chain_velocity_lock")]),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Strength",
          mainWorkout: "Heavy deadlifts",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result).toEqual([]);
  });
});

describe("buildLoadGovernorSuggestions — anterior chain braking guard", () => {
  it("matches a long road run via text", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("anterior_chain_braking_guard")]),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Run",
          mainWorkout: "Long road run with downhill finish",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result[0].rationaleCode).toBe("anterior_chain_braking_guard");
  });

  it("matches via the long_run exercise key", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("anterior_chain_braking_guard")]),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Workout",
          mainWorkout: "Session",
          exerciseDetails: [
            exercise({
              exerciseName: "long_run",
              category: "running",
              distance: 18000,
            }),
          ],
        }),
      ],
      CURRENT_DATE,
    );
    expect(result[0].rationaleCode).toBe("anterior_chain_braking_guard");
  });

  it("also matches a high-intensity run (braking OR high-intensity branch)", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("anterior_chain_braking_guard")]),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Run",
          mainWorkout: "Track threshold session",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result[0].rationaleCode).toBe("anterior_chain_braking_guard");
  });

  it("honors the 3-day window (excludes day 4)", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("anterior_chain_braking_guard")]),
      [
        workout({
          id: "in-three",
          date: "2026-05-25",
          focus: "Run",
          mainWorkout: "Long road run",
        }),
        workout({
          id: "in-four",
          date: "2026-05-26",
          focus: "Run",
          mainWorkout: "Long road run",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result.map((s) => s.suggestion.workoutId)).toEqual(["in-three"]);
  });
});

describe("buildLoadGovernorSuggestions — elastic tendon speed guard", () => {
  it("matches a sprint workout via text", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("elastic_tendon_speed_guard")]),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Run",
          mainWorkout: "Track sprint session",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result[0].rationaleCode).toBe("elastic_tendon_speed_guard");
  });

  it("matches via the box_jumps plyo exercise", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("elastic_tendon_speed_guard")]),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Plyo",
          mainWorkout: "Bounding circuit",
          exerciseDetails: [
            exercise({
              exerciseName: "box_jumps",
              category: "conditioning",
            }),
          ],
        }),
      ],
      CURRENT_DATE,
    );
    expect(result[0].rationaleCode).toBe("elastic_tendon_speed_guard");
  });

  it("matches via the jump_rope exercise", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("elastic_tendon_speed_guard")]),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Conditioning",
          mainWorkout: "Skip and stretch",
          exerciseDetails: [
            exercise({
              exerciseName: "jump_rope",
              category: "conditioning",
            }),
          ],
        }),
      ],
      CURRENT_DATE,
    );
    expect(result[0].rationaleCode).toBe("elastic_tendon_speed_guard");
  });
});

describe("buildLoadGovernorSuggestions — ACWR yellow guard", () => {
  it("matches a high-intensity run", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("acwr_yellow_guard", { severity: "caution" })], {
        zone: "yellow",
        acwr: 1.4,
      }),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Run",
          mainWorkout: "Threshold track intervals",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result[0].rationaleCode).toBe("acwr_yellow_guard");
    expect(result[0].suggestion.priority).toBe("medium");
  });

  it("matches high-tax strength via the heavy exercise list", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("acwr_yellow_guard", { severity: "caution" })], {
        zone: "yellow",
        acwr: 1.4,
      }),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
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
        }),
      ],
      CURRENT_DATE,
    );
    expect(result[0].rationaleCode).toBe("acwr_yellow_guard");
  });

  it("does NOT match low-tax accessory strength", () => {
    // "Strength" focus passes isStrengthWorkout but the heavy-list +
    // heavy-text gate filters out generic accessory days.
    const result = buildLoadGovernorSuggestions(
      summary([restriction("acwr_yellow_guard", { severity: "caution" })], {
        zone: "yellow",
        acwr: 1.4,
      }),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Strength",
          mainWorkout: "Light mobility flow",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result).toEqual([]);
  });

  it("rationale uses the numeric ACWR when known", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("acwr_yellow_guard", { severity: "caution" })], {
        zone: "yellow",
        acwr: 1.4,
      }),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Run",
          mainWorkout: "Threshold track intervals",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result[0].suggestion.rationale).toContain("ACWR is 1.4");
  });

  it("rationale falls back to 'above target' when ACWR is null", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("acwr_yellow_guard", { severity: "caution" })], {
        zone: "yellow",
        acwr: null,
      }),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Run",
          mainWorkout: "Threshold track intervals",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result[0].suggestion.rationale).toContain("ACWR is above target");
  });

  it("honors the 2-day window (excludes day 3)", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("acwr_yellow_guard", { severity: "caution" })], {
        zone: "yellow",
        acwr: 1.4,
      }),
      [
        workout({
          id: "in-two",
          date: "2026-05-24",
          focus: "Run",
          mainWorkout: "Threshold intervals",
        }),
        workout({
          id: "in-three",
          date: "2026-05-25",
          focus: "Run",
          mainWorkout: "Threshold intervals",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result.map((s) => s.suggestion.workoutId)).toEqual(["in-two"]);
  });
});

describe("buildLoadGovernorSuggestions — ACWR danger lock", () => {
  it("matches high-intensity running", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("acwr_danger_lock")], {
        zone: "danger",
        acwr: 1.7,
      }),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Run",
          mainWorkout: "Sprint intervals",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result[0].rationaleCode).toBe("acwr_danger_lock");
    expect(result[0].suggestion.priority).toBe("high");
  });

  it("matches any strength workout (broader than yellow guard)", () => {
    // Danger uses isStrengthWorkout (not isHighTaxStrengthWorkout), so a
    // generic strength day still qualifies.
    const result = buildLoadGovernorSuggestions(
      summary([restriction("acwr_danger_lock")], {
        zone: "danger",
        acwr: 1.7,
      }),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Strength",
          mainWorkout: "Accessory circuit",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result[0].rationaleCode).toBe("acwr_danger_lock");
  });

  it("honors the 4-day window (excludes day 5)", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("acwr_danger_lock")], {
        zone: "danger",
        acwr: 1.7,
      }),
      [
        workout({
          id: "in-four",
          date: "2026-05-26",
          focus: "Strength",
          mainWorkout: "Accessory work",
        }),
        workout({
          id: "in-five",
          date: "2026-05-27",
          focus: "Strength",
          mainWorkout: "Accessory work",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result.map((s) => s.suggestion.workoutId)).toEqual(["in-four"]);
  });
});

describe("buildLoadGovernorSuggestions — ACWR on-ramp", () => {
  it("matches strength or high-intensity runs and tags priority medium", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("acwr_onramp", { severity: "info" })], {
        zone: "undertraining",
        acwr: 0.6,
      }),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Strength",
          mainWorkout: "Working sets",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result).toHaveLength(1);
    expect(result[0].rationaleCode).toBe("acwr_onramp");
    expect(result[0].suggestion.priority).toBe("medium");
  });

  it("caps on-ramp suggestions at three even when more workouts match", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("acwr_onramp", { severity: "info" })], {
        zone: "undertraining",
        acwr: 0.6,
      }),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Strength",
          mainWorkout: "Squats",
        }),
        workout({
          id: "w2",
          date: "2026-05-23",
          focus: "Strength",
          mainWorkout: "Deadlift",
        }),
        workout({
          id: "w3",
          date: "2026-05-24",
          focus: "Strength",
          mainWorkout: "Sled push",
        }),
        workout({
          id: "w4",
          date: "2026-05-25",
          focus: "Strength",
          mainWorkout: "Lunges",
        }),
        workout({
          id: "w5",
          date: "2026-05-25",
          focus: "Strength",
          mainWorkout: "Squats",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.suggestion.workoutId)).toEqual(["w1", "w2", "w3"]);
  });

  it("does NOT match rest / mobility days", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("acwr_onramp", { severity: "info" })], {
        zone: "undertraining",
        acwr: 0.6,
      }),
      [
        workout({
          id: "rest",
          date: "2026-05-23",
          focus: "Rest",
          mainWorkout: "Walk and stretch",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result).toEqual([]);
  });

  it("honors the 3-day window (excludes day 4)", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("acwr_onramp", { severity: "info" })], {
        zone: "undertraining",
        acwr: 0.6,
      }),
      [
        workout({
          id: "in-four",
          date: "2026-05-26",
          focus: "Strength",
          mainWorkout: "Squats",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result).toEqual([]);
  });
});

describe("buildLoadGovernorSuggestions — cross-pass deduplication and rule precedence", () => {
  it("posterior_chain (pass 1) wins over acwr_danger_lock (pass 3) for the same workout", () => {
    const result = buildLoadGovernorSuggestions(
      summary([restriction("posterior_chain_velocity_lock"), restriction("acwr_danger_lock")], {
        zone: "danger",
        acwr: 1.7,
      }),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Run",
          mainWorkout: "Hill repeats",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result).toHaveLength(1);
    expect(result[0].rationaleCode).toBe("posterior_chain_velocity_lock");
  });

  it("within pass 1, posterior wins over elastic when both restrictions are active", () => {
    // Rules are declared in fixed order: posterior, anterior, elastic.
    // A workout that matches both gets the first one.
    const result = buildLoadGovernorSuggestions(
      summary([
        restriction("elastic_tendon_speed_guard"),
        restriction("posterior_chain_velocity_lock"),
      ]),
      [
        workout({
          id: "w1",
          date: "2026-05-23",
          focus: "Run",
          mainWorkout: "Hill repeats",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result).toHaveLength(1);
    expect(result[0].rationaleCode).toBe("posterior_chain_velocity_lock");
  });

  it("a workout used in an earlier pass is skipped by the on-ramp pass", () => {
    const result = buildLoadGovernorSuggestions(
      summary(
        [
          restriction("posterior_chain_velocity_lock"),
          restriction("acwr_onramp", { severity: "info" }),
        ],
        { zone: "undertraining", acwr: 0.6 },
      ),
      [
        workout({
          id: "claimed",
          date: "2026-05-23",
          focus: "Run",
          mainWorkout: "Hill repeats",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result).toHaveLength(1);
    expect(result[0].rationaleCode).toBe("posterior_chain_velocity_lock");
  });

  it("different workouts can be assigned to different passes within one call", () => {
    // The run is high-intensity ⇒ pass 1 picks it (posterior).
    // The strength day is high-tax but NOT a running workout, so it falls
    // through to pass 2 (yellow guard).
    const result = buildLoadGovernorSuggestions(
      summary(
        [
          restriction("posterior_chain_velocity_lock"),
          restriction("acwr_yellow_guard", { severity: "caution" }),
        ],
        { zone: "yellow", acwr: 1.4 },
      ),
      [
        workout({
          id: "hill",
          date: "2026-05-23",
          focus: "Run",
          mainWorkout: "Hill repeats",
        }),
        workout({
          id: "lift",
          date: "2026-05-24",
          focus: "Strength",
          mainWorkout: "Heavy deadlift triples",
        }),
      ],
      CURRENT_DATE,
    );
    expect(result.map((s) => s.rationaleCode).sort()).toEqual([
      "acwr_yellow_guard",
      "posterior_chain_velocity_lock",
    ]);
  });
});
