import { describe, expect, it } from "vitest";

import {
  type AdaptablePlanDay,
  adaptPlan,
  describeMissHolds,
  standingMissHolds,
} from "./adaptation";
import {
  afterPass,
  missedSquatDay,
  missInput,
  NEXT_SQUATS,
  squatDay,
  weights,
  withState,
} from "./adaptation.testFixtures";

function deadliftDay(id: string, date: string, weight: number): AdaptablePlanDay {
  return {
    id,
    date,
    weekNumber: 6,
    mainWorkout: `A) Deadlift 3x5 @ ${weight} kg (RPE 8)`,
    accessory: null,
    notes: null,
    aiInputsUsed: null,
    sets: [1, 2, 3].map((n) => ({
      id: `${id}-${n}`,
      exerciseName: "deadlift",
      reps: 5,
      weight,
      weightUnit: "kg",
    })),
  };
}

// Today is Wednesday 14 October 2026, and a pass reads three weeks ahead: to
// 4 November.
describe("adaptPlan — a miss no session in range answers yet", () => {
  it("is not counted, and holds once the session after it comes into range", () => {
    // Skipped in advance, near the far edge of what a pass reads: the squat
    // after it is a week further out.
    const skipped = missedSquatDay({ date: "2026-10-30", kind: "skipped", weight: 87.5 });
    const beyond = [squatDay("far", "2026-11-06", 7, 90)];

    const first = adaptPlan(missInput({ missed: [skipped], upcoming: beyond }));
    expect(first.days).toEqual([]);
    expect(first.engineState.missHolds).toEqual([]);
    // Left uncounted, so the next pass asks again.
    expect(first.engineState.adaptedMisses).toEqual([]);

    // A week on, that squat is inside the three weeks.
    const later = adaptPlan(
      missInput({
        today: "2026-10-21",
        plan: withState(first.engineState),
        missed: [skipped],
        upcoming: beyond,
      }),
    );
    expect(weights(later, "far")).toEqual([87.5, 87.5, 87.5, 87.5]);
    expect(later.days[0]?.rationale).toContain("Front Squat (4x6 @ 87.5 kg)");
    expect(later.engineState.adaptedMisses).toEqual(["m|2026-10-30"]);

    // Counted now: the pass after changes nothing more.
    const settled = adaptPlan(
      missInput({
        today: "2026-10-21",
        plan: withState(later.engineState),
        missed: [skipped],
        upcoming: afterPass(later, beyond),
      }),
    );
    expect(settled.days).toEqual([]);
  });

  it("holds the steps it can answer, once each, while another one waits", () => {
    // The missed session had a deadlift too, and no deadlift is in range.
    const squats = missedSquatDay();
    const miss = {
      ...squats,
      sets: [
        ...squats.sets,
        { id: "m-dl", exerciseName: "deadlift", reps: 5, weight: 120, weightUnit: "kg" },
      ],
    };

    const first = adaptPlan(missInput({ missed: [miss] }));
    expect(weights(first, "n1")).toEqual([85, 85, 85, 85]);
    expect(first.engineState.missHolds?.map((hold) => hold.exercise)).toEqual(["front_squat"]);
    // Still waiting on the deadlift.
    expect(first.engineState.adaptedMisses).toEqual([]);

    // The athlete puts the squat back up. Asking again about the deadlift
    // does not hold the squat a second time.
    const edited = adaptPlan(missInput({ missed: [miss], plan: withState(first.engineState) }));
    expect(edited.days).toEqual([]);
    expect(edited.engineState.missHolds).toEqual(first.engineState.missHolds);
    expect(edited.engineState.adaptedMisses).toEqual([]);

    // A deadlift that climbs past the missed 120 comes into range: it is held
    // too, the squat stays as the athlete left it, and the miss is counted.
    const answered = adaptPlan(
      missInput({
        missed: [miss],
        plan: withState(edited.engineState),
        upcoming: [...NEXT_SQUATS, deadliftDay("dl", "2026-10-22", 125)],
      }),
    );
    expect(weights(answered, "dl")).toEqual([120, 120, 120]);
    expect(weights(answered, "n1")).toBeUndefined();
    expect(answered.engineState.missHolds?.map((hold) => hold.exercise)).toEqual([
      "front_squat",
      "deadlift",
    ]);
    expect(answered.engineState.adaptedMisses).toEqual(["m|2026-10-13"]);
  });

  it("counts a miss whose every step has its answer, held or not", () => {
    // The plan repeats the squat itself and the deadlift was trained anyway.
    const squats = missedSquatDay();
    const miss = {
      ...squats,
      sets: [
        ...squats.sets,
        { id: "m-dl", exerciseName: "deadlift", reps: 5, weight: 120, weightUnit: "kg" },
      ],
    };
    const result = adaptPlan(
      missInput({
        missed: [miss],
        upcoming: [squatDay("thu", "2026-10-15", 5, 85), ...NEXT_SQUATS],
        sets: [
          {
            workoutLogId: "adhoc",
            date: "2026-10-13",
            exerciseName: "deadlift",
            category: "strength",
            setNumber: 1,
            reps: 5,
            weight: 120,
            weightUnit: "kg",
            plannedReps: null,
            plannedWeight: null,
          },
        ],
      }),
    );
    expect(result.days).toEqual([]);
    expect(result.engineState.adaptedMisses).toEqual(["m|2026-10-13"]);
  });
});

describe("adaptPlan — a hold after the athlete changes unit", () => {
  // Held in kg. The athlete then switches the app to lbs; the plan's rows are
  // still stored in kg, and read converted.
  const held = adaptPlan(missInput());
  const inLbs = {
    weightUnit: "lbs" as const,
    plan: withState(held.engineState),
    upcoming: afterPass(held),
  };

  it("takes the hold back in the unit the athlete reads loads in now", () => {
    const result = adaptPlan(
      missInput({ ...inLbs, missed: [], returnedPlanDays: new Map([["m", "2026-10-15"]]) }),
    );

    // The plan's own 87.5, 90 and 92.5 kg, as lbs.
    expect(weights(result, "n1")).toEqual([193, 193, 193, 193]);
    expect(weights(result, "n2")).toEqual([198, 198, 198, 198]);
    expect(weights(result, "n3")).toEqual([204, 204, 204, 204]);
    expect(result.days.find((day) => day.planDayId === "n1")?.changes).toEqual([
      { exercise: "front_squat", kind: "raise", from: 187, to: 193, unit: "lbs" },
    ]);
    expect(result.engineState.missHolds).toEqual([]);
  });

  it("leaves a load the athlete edited alone, whatever the unit", () => {
    const edited = inLbs.upcoming.map((day) =>
      day.id === "n1" ? { ...day, sets: day.sets.map((set) => ({ ...set, weight: 80 })) } : day,
    );
    const result = adaptPlan(
      missInput({
        ...inLbs,
        upcoming: edited,
        missed: [],
        returnedPlanDays: new Map([["m", "2026-10-15"]]),
      }),
    );
    expect(weights(result, "n1")).toBeUndefined();
    expect(weights(result, "n2")).toEqual([198, 198, 198, 198]);
  });

  it("says what still stands of it in that unit", () => {
    const standing = standingMissHolds(missInput(inLbs), held.engineState.missHolds ?? []);

    expect(describeMissHolds(standing, inLbs.upcoming)).toEqual([
      { exercise: "Front Squat", date: "2026-10-20", scheme: "4x6", from: 193, to: 187, unit: "lbs" },
    ]);
  });
});
