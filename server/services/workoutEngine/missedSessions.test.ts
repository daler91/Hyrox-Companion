import type { PlanEngineState } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { adaptPlan, describeMissHolds, previewMissHolds } from "./adaptation";
import {
  afterPass as after,
  input,
  log,
  missedSquatDay as missedDay,
  missInput,
  NEXT_SQUATS as NEXT,
  squatDay,
  squatSets,
  weights,
  withState,
} from "./adaptation.testFixtures";

// Tuesday's squat was missed; the next three Tuesdays climb past it
// (adaptation.testFixtures: NEXT_SQUATS, missedSquatDay, missInput).
describe("adaptPlan — sessions that never happened", () => {
  it("repeats the missed step instead of climbing past it, then builds from there", () => {
    const result = adaptPlan(missInput());

    // One step behind the plan as written (87.5, 90, 92.5), not further.
    expect(weights(result, "n1")).toEqual([85, 85, 85, 85]);
    expect(weights(result, "n2")).toEqual([87.5, 87.5, 87.5, 87.5]);
    expect(weights(result, "n3")).toEqual([90, 90, 90, 90]);
    const first = result.days.find((day) => day.planDayId === "n1");
    expect(first?.rationale).toBe(
      "Auto-progression: You missed Tuesday's Front Squat (4x6 @ 85 kg), so it picks up from that load rather than jumping ahead.",
    );
    expect(first?.mainWorkout).toContain("A) Front Squat 4x6 @ 85 kg");
    expect(first?.changes).toEqual([
      { exercise: "front_squat", kind: "hold", from: 87.5, to: 85, unit: "kg" },
    ]);
    expect(result.days.find((day) => day.planDayId === "n2")?.rationale).toBe(
      "Auto-progression: Front Squat keeps building from the repeated step.",
    );
    expect(result.engineState.adaptedMisses).toEqual(["m|2026-10-13"]);
    expect(result.engineState.missHolds).toEqual([
      {
        planDayId: "m",
        missedOn: "2026-10-13",
        exercise: "front_squat",
        unit: "kg",
        sets: [
          ...[1, 2, 3, 4].map((n) => ({ setId: `n1-${n}`, from: 87.5, to: 85 })),
          ...[1, 2, 3, 4].map((n) => ({ setId: `n2-${n}`, from: 90, to: 87.5 })),
          ...[1, 2, 3, 4].map((n) => ({ setId: `n3-${n}`, from: 92.5, to: 90 })),
        ],
      },
    ]);
  });

  it("counts each miss once, so a load the athlete puts back stays put", () => {
    const first = adaptPlan(missInput());

    // The next pass finds the plan as it left it...
    const settled = adaptPlan(
      missInput({ plan: withState(first.engineState), upcoming: after(first) }),
    );
    expect(settled.days).toEqual([]);
    expect(settled.engineState.missHolds).toEqual(first.engineState.missHolds);

    // ...and one where the athlete edited the loads back up leaves their edit alone.
    const edited = adaptPlan(missInput({ plan: withState(first.engineState) }));
    expect(edited.days).toEqual([]);
  });

  it("takes the hold back when the session returns to the plan", () => {
    const first = adaptPlan(missInput());
    const result = adaptPlan(
      missInput({
        plan: withState(first.engineState),
        upcoming: after(first),
        missed: [],
        returnedPlanDays: new Map([["m", "2026-10-15"]]),
      }),
    );

    expect(weights(result, "n1")).toEqual([87.5, 87.5, 87.5, 87.5]);
    expect(weights(result, "n2")).toEqual([90, 90, 90, 90]);
    expect(weights(result, "n3")).toEqual([92.5, 92.5, 92.5, 92.5]);
    const day = result.days.find((entry) => entry.planDayId === "n1");
    expect(day?.rationale).toBe(
      "Auto-progression: Tuesday's session is no longer missed, so Front Squat returns to its planned load.",
    );
    expect(day?.mainWorkout).toContain("A) Front Squat 4x6 @ 87.5 kg");
    expect(day?.changes).toEqual([
      { exercise: "front_squat", kind: "raise", from: 85, to: 87.5, unit: "kg" },
    ]);
    expect(result.engineState.missHolds).toEqual([]);
    // Missed again on the same day, it counts afresh.
    expect(result.engineState.adaptedMisses).toEqual([]);
  });

  it("lets the loads stand when the session returns after a session that was held for it", () => {
    // Folded to the Thursday after next Tuesday's squat: Tuesday still comes
    // before the missed step is done, so it and what follows stay held.
    const first = adaptPlan(missInput());
    const result = adaptPlan(
      missInput({
        plan: withState(first.engineState),
        upcoming: after(first),
        missed: [],
        returnedPlanDays: new Map([["m", "2026-10-22"]]),
      }),
    );

    expect(result.days).toEqual([]);
    expect(result.engineState.missHolds).toEqual([]);
    // Back in the plan, so it counts afresh if it is missed again.
    expect(result.engineState.adaptedMisses).toEqual([]);

    // Onto the same day as the held session is not ahead of it either.
    const sameDay = adaptPlan(
      missInput({
        plan: withState(first.engineState),
        upcoming: after(first),
        missed: [],
        returnedPlanDays: new Map([["m", "2026-10-20"]]),
      }),
    );
    expect(sameDay.days).toEqual([]);
  });

  it("leaves on each held day which session it was held for, for the day's card", () => {
    const result = adaptPlan(missInput());

    expect(result.days.find((day) => day.planDayId === "n1")?.inputsUsed.missedSessionHold).toEqual({
      kind: "missed",
      date: "2026-10-13",
      changes: [{ exercise: "front_squat", kind: "hold", from: 87.5, to: 85, unit: "kg" }],
    });
    expect(result.days.find((day) => day.planDayId === "n3")?.inputsUsed.missedSessionHold).toEqual({
      kind: "missed",
      date: "2026-10-13",
      changes: [{ exercise: "front_squat", kind: "hold", from: 92.5, to: 90, unit: "kg" }],
    });

    // A change from a log says nothing of the kind...
    const fromLog = adaptPlan(input({ sets: squatSets("l1", "2026-10-13", [8, 8, 8, 8], 82.5) }));
    expect(fromLog.days[0]?.inputsUsed.missedSessionHold).toBeUndefined();
    // ...and neither does the day once its hold is taken back.
    const back = adaptPlan(
      missInput({
        plan: withState(result.engineState),
        upcoming: after(result),
        missed: [],
        returnedPlanDays: new Map([["m", "2026-10-15"]]),
      }),
    );
    expect(back.days[0]?.inputsUsed.missedSessionHold).toBeUndefined();
  });

  it("gives back only the sets that still read what the hold wrote", () => {
    const first = adaptPlan(missInput());
    const held = after(first);
    const editedDay = held[1];
    if (!editedDay) throw new Error("expected three held days");
    const edited = [
      held[0],
      { ...editedDay, sets: editedDay.sets.map((set) => ({ ...set, weight: 80 })) },
      held[2],
    ].flatMap((day) => day ?? []);
    const result = adaptPlan(
      missInput({
        plan: withState(first.engineState),
        upcoming: edited,
        missed: [],
        returnedPlanDays: new Map([["m", "2026-10-15"]]),
      }),
    );

    expect(weights(result, "n1")).toEqual([87.5, 87.5, 87.5, 87.5]);
    expect(weights(result, "n2")).toBeUndefined();
    expect(weights(result, "n3")).toEqual([92.5, 92.5, 92.5, 92.5]);
  });

  it("builds a raise on the restored load when the session is logged late and beaten", () => {
    const first = adaptPlan(missInput());
    // Logged against the missed day after all: 4x8 where 4x6 @ 85 was planned.
    const result = adaptPlan(
      missInput({
        plan: withState(first.engineState),
        upcoming: after(first),
        missed: [],
        returnedPlanDays: new Map([["m", "2026-10-13"]]),
        logs: [log("late", "2026-10-13")],
        sets: squatSets("late", "2026-10-13", [8, 8, 8, 8], 85, { reps: 6, weight: 85 }),
      }),
    );
    // 87.5 x 1.05 = 91.9 → 92.5, not a raise from the held 85.
    expect(weights(result, "n1")).toEqual([92.5, 92.5, 92.5, 92.5]);
  });

  it("drops a hold without restoring it when the missed day was deleted", () => {
    const first = adaptPlan(missInput());
    const result = adaptPlan(
      missInput({ plan: withState(first.engineState), upcoming: after(first), missed: [] }),
    );
    expect(result.days).toEqual([]);
    expect(result.engineState.missHolds).toEqual([]);
    expect(result.engineState.adaptedMisses).toEqual(["m|2026-10-13"]);
  });

  it("holds nothing for a lift the athlete trained anyway", () => {
    // An unplanned squat session on the day of the miss.
    const result = adaptPlan(
      missInput({
        logs: [log("adhoc", "2026-10-13")],
        sets: squatSets("adhoc", "2026-10-13", [6, 6, 6, 6], 85, null),
      }),
    );
    expect(result.days).toEqual([]);
    expect(result.engineState.missHolds).toEqual([]);
    expect(result.engineState.adaptedMisses).toEqual(["m|2026-10-13"]);
  });

  it("lets a hold stand, for good, once the lift has been trained since", () => {
    const first = adaptPlan(missInput());
    const state: PlanEngineState = { ...first.engineState, adaptedLogIds: ["done"] };
    const result = adaptPlan(
      missInput({
        plan: withState(state),
        upcoming: after(first).slice(1),
        logs: [log("done", "2026-10-20")],
        sets: squatSets("done", "2026-10-20", [6, 6, 6, 6], 85, { reps: 6, weight: 85 }),
        today: "2026-10-21",
      }),
    );
    expect(result.days).toEqual([]);
    expect(result.engineState.missHolds).toEqual([]);

    // The missed session coming back now changes nothing: the plan moved on.
    const back = adaptPlan(
      missInput({
        plan: withState(result.engineState),
        upcoming: after(first).slice(1),
        missed: [],
        returnedPlanDays: new Map([["m", "2026-10-22"]]),
        today: "2026-10-21",
      }),
    );
    expect(back.days).toEqual([]);
  });

  it("gives the load back when the lift is trained anyway before the held session comes up", () => {
    // The session done after all, but logged as a workout of its own rather
    // than against the missed day: that day stays missed, the step was made up.
    const first = adaptPlan(missInput());
    const result = adaptPlan(
      missInput({
        plan: withState({ ...first.engineState, adaptedLogIds: ["adhoc"] }),
        upcoming: after(first),
        logs: [log("adhoc", "2026-10-13")],
        sets: squatSets("adhoc", "2026-10-13", [6, 6, 6, 6], 85, null),
      }),
    );

    expect(weights(result, "n1")).toEqual([87.5, 87.5, 87.5, 87.5]);
    expect(weights(result, "n2")).toEqual([90, 90, 90, 90]);
    expect(result.days.find((day) => day.planDayId === "n1")?.rationale).toBe(
      "Auto-progression: You have trained Front Squat since Tuesday's session, so it returns to its planned load.",
    );
    expect(result.engineState.missHolds).toEqual([]);
    // It stays counted: the same miss never holds the plan again.
    expect(result.engineState.adaptedMisses).toEqual(["m|2026-10-13"]);
  });

  it("holds nothing when the plan repeats the step itself", () => {
    // The lift's second day that week runs the same load.
    const result = adaptPlan(
      missInput({ upcoming: [squatDay("thu", "2026-10-15", 5, 85), ...NEXT] }),
    );
    expect(result.days).toEqual([]);
    expect(result.engineState.adaptedMisses).toEqual(["m|2026-10-13"]);
  });

  it("passes over the week's lighter exposure and holds the next heavy one", () => {
    const result = adaptPlan(
      missInput({ upcoming: [squatDay("light", "2026-10-16", 5, 77.5), ...NEXT] }),
    );
    expect(weights(result, "light")).toBeUndefined();
    expect(weights(result, "n1")).toEqual([85, 85, 85, 85]);
  });

  it("does not pull the heavy day down for a missed lighter exposure", () => {
    // Friday's lighter squat (77.5) was missed: Tuesday's 87.5 is another tier.
    const result = adaptPlan(
      missInput({
        missed: [missedDay({ date: "2026-10-09", weight: 77.5 })],
        upcoming: [
          squatDay("heavy", "2026-10-20", 6, 87.5),
          squatDay("light", "2026-10-23", 6, 80),
        ],
      }),
    );
    expect(weights(result, "heavy")).toBeUndefined();
    expect(weights(result, "light")).toEqual([77.5, 77.5, 77.5, 77.5]);
  });

  it("holds nothing for a session missed in a deload week", () => {
    // Week 4 of 12 is a deload: no step of the progression was lost.
    const result = adaptPlan(missInput({ missed: [missedDay({ weekNumber: 4 })] }));
    expect(result.days).toEqual([]);
    expect(result.engineState.adaptedMisses).toEqual(["m|2026-10-13"]);
  });

  it("leaves misses from more than two weeks ago to the return-from-break rule", () => {
    const result = adaptPlan(missInput({ missed: [missedDay({ date: "2026-09-29" })] }));
    expect(result.days).toEqual([]);
    expect(result.engineState.adaptedMisses).toEqual([]);
  });

  it("repeats the earliest step when the same lift was missed twice", () => {
    const result = adaptPlan(
      missInput({
        missed: [
          missedDay({ planDayId: "m1", date: "2026-10-06", weight: 82.5 }),
          missedDay({ planDayId: "m2", date: "2026-10-13", weight: 85 }),
        ],
      }),
    );
    expect(weights(result, "n1")).toEqual([82.5, 82.5, 82.5, 82.5]);
    expect(result.engineState.adaptedMisses).toEqual(["m1|2026-10-06", "m2|2026-10-13"]);
  });

  describe("two sessions missed with the same lift", () => {
    const earlier = missedDay({ planDayId: "m1", date: "2026-10-06", weight: 82.5 });
    const later = missedDay({ planDayId: "m2", date: "2026-10-13", weight: 85 });

    /** Both misses read in one pass: only the earlier one has anything to hold. */
    function bothMissed() {
      const first = adaptPlan(missInput({ missed: [earlier, later] }));
      expect(first.engineState.missHolds?.map((hold) => hold.planDayId)).toEqual(["m1"]);
      expect(weights(first, "n1")).toEqual([82.5, 82.5, 82.5, 82.5]);
      return first;
    }

    it("does not climb past the later miss when the earlier one's hold is taken back", () => {
      const first = bothMissed();
      // The earlier session is folded in before next Tuesday; the later one is still missed.
      const result = adaptPlan(
        missInput({
          plan: withState(first.engineState),
          upcoming: after(first),
          missed: [later],
          returnedPlanDays: new Map([["m1", "2026-10-15"]]),
        }),
      );

      // Back up from 82.5, but to the 85 kg the later session never did — not
      // to the 87.5, 90 and 92.5 the plan first had.
      expect(weights(result, "n1")).toEqual([85, 85, 85, 85]);
      expect(weights(result, "n2")).toEqual([87.5, 87.5, 87.5, 87.5]);
      expect(weights(result, "n3")).toEqual([90, 90, 90, 90]);
      const day = result.days.find((entry) => entry.planDayId === "n1");
      expect(day?.rationale).toContain("You missed Tuesday's Front Squat (4x6 @ 85 kg)");
      expect(day?.inputsUsed.missedSessionHold).toMatchObject({ kind: "missed", date: "2026-10-13" });

      // The later miss now has a hold of its own, so it can be taken back in turn.
      expect(result.engineState.missHolds?.map((hold) => hold.planDayId)).toEqual(["m2"]);
      const back = adaptPlan(
        missInput({
          plan: withState(result.engineState),
          upcoming: after(result),
          missed: [],
          returnedPlanDays: new Map([["m2", "2026-10-16"]]),
        }),
      );
      expect(weights(back, "n1")).toEqual([87.5, 87.5, 87.5, 87.5]);
    });

    it("holds at the later miss when the earlier one was made up in between", () => {
      const first = bothMissed();
      // The lift trained on the 8th: after the first miss, before the second.
      const result = adaptPlan(
        missInput({
          plan: withState({ ...first.engineState, adaptedLogIds: ["between"] }),
          upcoming: after(first),
          missed: [earlier, later],
          logs: [log("between", "2026-10-08")],
          sets: squatSets("between", "2026-10-08", [6, 6, 6, 6], 82.5, null),
        }),
      );

      expect(weights(result, "n1")).toEqual([85, 85, 85, 85]);
      expect(result.engineState.missHolds?.map((hold) => hold.planDayId)).toEqual(["m2"]);
    });

    it("leaves a load the athlete edited alone when only the other lift's hold is taken back", () => {
      // A hold taken back for the squat is no reason to look at any other lift again.
      const first = bothMissed();
      const edited = after(first).map((day) => ({
        ...day,
        sets: [
          ...day.sets,
          { id: `${day.id}-bench`, exerciseName: "bench_press", reps: 6, weight: 80, weightUnit: "kg" },
        ],
      }));
      const withBench = {
        ...later,
        sets: [...later.sets, { id: "m2-bench", exerciseName: "bench_press", reps: 6, weight: 70, weightUnit: "kg" }],
      };
      const result = adaptPlan(
        missInput({
          plan: withState(first.engineState),
          upcoming: edited,
          missed: [withBench],
          returnedPlanDays: new Map([["m1", "2026-10-15"]]),
        }),
      );

      const n1 = result.days.find((entry) => entry.planDayId === "n1");
      expect(n1?.setUpdates.map((update) => update.setId)).not.toContain("n1-bench");
    });
  });

  it("says skipped for a skip, and never calls a declared absence a miss", () => {
    const skipped = adaptPlan(missInput({ missed: [missedDay({ kind: "skipped" })] }));
    expect(skipped.days[0]?.rationale).toContain("You skipped Tuesday's Front Squat (4x6 @ 85 kg)");

    const excused = adaptPlan(missInput({ missed: [missedDay({ kind: "excused" })] }));
    expect(excused.days[0]?.rationale).toContain(
      "Tuesday's Front Squat (4x6 @ 85 kg) didn't happen, so it picks up from that load",
    );
    expect(excused.days[0]?.rationale).not.toMatch(/missed/i);
  });

  it("holds the sessions after one skipped in advance, not the ones before it", () => {
    const result = adaptPlan(
      missInput({
        missed: [missedDay({ date: "2026-10-20", kind: "skipped", weight: 87.5 })],
        upcoming: [squatDay("before", "2026-10-16", 5, 85), ...NEXT.slice(1)],
      }),
    );
    expect(weights(result, "before")).toBeUndefined();
    expect(weights(result, "n2")).toEqual([87.5, 87.5, 87.5, 87.5]);
    expect(result.days[0]?.rationale).toContain("You're skipping Tuesday's Front Squat");
  });

  it("still holds while fatigued, in a taper, and leaves excluded days alone", () => {
    const tired = adaptPlan(missInput({ fatigued: true }));
    expect(weights(tired, "n1")).toEqual([85, 85, 85, 85]);

    const taper = adaptPlan(
      missInput({ plan: { startDate: "2026-09-14", totalWeeks: 7, engineState: null } }),
    );
    expect(weights(taper, "n1")).toEqual([85, 85, 85, 85]);

    const excluded = adaptPlan(missInput({ excludedDayIds: new Set(["n1"]) }));
    expect(weights(excluded, "n1")).toBeUndefined();
  });

  it("ignores bodyweight, unweighted and unlabelled custom sets of the missed session", () => {
    const sets = [
      { id: "m-1", exerciseName: "pull_up", reps: 8, weight: 10, weightUnit: "kg" },
      { id: "m-2", exerciseName: "front_squat", reps: 6, weight: null, weightUnit: "kg" },
      { id: "m-3", exerciseName: "custom", reps: 6, weight: 85, weightUnit: "kg" },
      { id: "m-4", exerciseName: "front_squat", reps: 20, weight: 85, weightUnit: "kg" },
    ];
    const result = adaptPlan(missInput({ missed: [missedDay({ sets })] }));
    expect(result.days).toEqual([]);
  });

  describe("saying what a miss changes, before any pass has run", () => {
    it("previews the holds without touching the days it was given", () => {
      const before = structuredClone(NEXT);
      const holds = previewMissHolds(missInput(), missedDay());

      expect(holds).toEqual(adaptPlan(missInput()).engineState.missHolds);
      expect(NEXT).toEqual(before);
    });

    it("describes each hold by the first session it reaches", () => {
      const holds = previewMissHolds(missInput(), missedDay());

      expect(describeMissHolds(holds, NEXT)).toEqual([
        { exercise: "Front Squat", date: "2026-10-20", scheme: "4x6", from: 87.5, to: 85, unit: "kg" },
      ]);
    });

    it("previews nothing where the plan would hold nothing", () => {
      // A deload week, and a lift trained anyway.
      expect(previewMissHolds(missInput(), missedDay({ weekNumber: 4 }))).toEqual([]);
      expect(
        previewMissHolds(
          missInput({ sets: squatSets("adhoc", "2026-10-13", [6, 6, 6, 6], 85, null) }),
          missedDay(),
        ),
      ).toEqual([]);
    });

    it("says nothing for a hold whose sessions have all gone by", () => {
      const holds = previewMissHolds(missInput(), missedDay());
      expect(describeMissHolds(holds, [])).toEqual([]);
    });
  });

  it("leaves the record of misses alone on a pass that was not given any", () => {
    const first = adaptPlan(missInput());
    const result = adaptPlan(
      missInput({ plan: withState(first.engineState), upcoming: after(first), missed: undefined }),
    );
    expect(result.days).toEqual([]);
    expect(result.engineState.missHolds).toEqual(first.engineState.missHolds);
    expect(result.engineState.adaptedMisses).toEqual(first.engineState.adaptedMisses);
  });
});
