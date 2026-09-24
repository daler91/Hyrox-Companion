import { describe, expect, it } from "vitest";

import type { ExperienceLevel, GoalLens, PrimarySlot } from "../ai/exerciseKnowledge";
import { buildPlanOutline } from "../planBlueprint";
import { loadIncrement, type StrengthEstimate } from "./loadMath";
import { buildLiftPrograms, type LiftProgramInput, type LiftWeekTarget } from "./strength";

const LENSES: readonly GoalLens[] = [
  "hyrox",
  "running",
  "strength",
  "hybrid",
  "weight_loss",
  "general",
];
const LEVELS: readonly ExperienceLevel[] = ["beginner", "intermediate", "advanced"];

function estimate(exercise: string, e1rm: number): StrengthEstimate {
  return {
    exercise,
    e1rm,
    basis: { date: "2026-09-15", weight: e1rm * 0.8, reps: 5 },
    sessions: 4,
  };
}

function program(
  overrides: Partial<LiftProgramInput> & {
    readonly exercise?: string;
    readonly slot?: PrimarySlot;
    readonly e1rm?: number | null;
  } = {},
): readonly LiftWeekTarget[] {
  const exercise = (overrides.exercise ?? "front_squat") as "front_squat";
  const e1rm = overrides.e1rm === undefined ? 104.8 : overrides.e1rm;
  const [lift] = buildLiftPrograms({
    lens: "hyrox",
    experience: "intermediate",
    unit: "kg",
    outline: buildPlanOutline(12),
    primaryLifts: [{ slot: overrides.slot ?? "squat", exercise }],
    estimates: new Map(e1rm == null ? [] : [[exercise, estimate(exercise, e1rm)]]),
    ...overrides,
  });
  return lift.weeks;
}

describe("buildLiftPrograms", () => {
  it("follows the goal's rep scheme through the phases", () => {
    const weeks = program();
    const shape = (week: number) => {
      const target = weeks[week - 1];
      return `${target.sets}x${target.reps}`;
    };
    // 12 weeks: early 1-3, build 4-7, peak 8-10, taper 11, race week 12.
    expect([shape(1), shape(5), shape(9), shape(11), shape(12)]).toEqual([
      "4x8",
      "4x6",
      "3x5",
      "2x5",
      "2x5",
    ]);
  });

  it("opens from the athlete's estimated 1RM at a moderate effort", () => {
    const [week1] = program();
    // 104.8 / (1 + (8 + 3) / 30) = 76.7 → 77.5 kg for 4x8.
    expect(week1).toMatchObject({
      sets: 4,
      reps: 8,
      load: 77.5,
      rest: { minSec: 90, maxSec: 120 },
    });
    expect(week1.rpe).toBeGreaterThanOrEqual(7);
    expect(week1.rpe).toBeLessThanOrEqual(7.5);
  });

  it("deloads at the blueprint's deload weeks: half the sets, ~90% of the load, RPE 6", () => {
    const weeks = program();
    const before = weeks[2];
    const deload = weeks[3];
    expect(deload).toMatchObject({ week: 4, deload: true, sets: 2, reps: before.reps, rpe: 6 });
    expect(deload.load).toBeLessThanOrEqual(before.load! * 0.9);
    expect(deload.load).toBeGreaterThan(before.load! * 0.85);
  });

  it("climbs inside a block and comes back above the pre-deload level in the next", () => {
    const weeks = program({ lens: "strength" });
    const loads = weeks.map((week) => week.load);
    expect(loads[0]!).toBeLessThan(loads[2]!);
    expect(loads[4]!).toBeGreaterThan(loads[2]!);
  });

  it.each(LENSES.flatMap((lens) => LEVELS.map((level) => [lens, level] as const)))(
    "never steps a %s/%s load up more than 7.5% or one plate in a week",
    (lens, experience) => {
      for (const slot of ["squat", "single_leg"] as const) {
        const exercise = slot === "squat" ? "back_squat" : "bulgarian_split_squat";
        const weeks = program({ lens, experience, slot, exercise, e1rm: 60 });
        let previous: number | null = null;
        for (const week of weeks) {
          if (week.deload) continue;
          if (previous != null && week.load != null) {
            const ceiling = Math.max(previous * 1.075, previous + loadIncrement(exercise, "kg"));
            expect(week.load).toBeLessThanOrEqual(ceiling + 1e-9);
          }
          previous = week.load;
        }
      }
    },
  );

  it.each(LENSES)("keeps a %s beginner inside beginner limits", (lens) => {
    for (const week of program({ lens, experience: "beginner" })) {
      expect(week.rpe).toBeLessThanOrEqual(8);
      expect(week.reps).toBeGreaterThanOrEqual(5);
      expect(week.sets).toBeLessThanOrEqual(4);
    }
  });

  it("peaks an advanced strength athlete on doubles", () => {
    const weeks = program({ lens: "strength", experience: "advanced" });
    expect(
      weeks.filter((week) => week.phase === "peak" && !week.deload).map((w) => w.reps),
    ).toEqual([2, 2]);
  });

  it("caps heavy floor pulls at six reps, whatever the phase asks", () => {
    const weeks = program({ exercise: "deadlift", slot: "hinge", e1rm: 160 });
    expect(Math.max(...weeks.map((week) => week.reps))).toBe(6);
  });

  it("runs single-leg work on even per-side reps and calves at twelve", () => {
    for (const week of program({ slot: "single_leg", exercise: "bulgarian_split_squat" })) {
      expect(week.reps % 2).toBe(0);
      expect(week.reps).toBeGreaterThanOrEqual(6);
      expect(week.sets).toBeLessThanOrEqual(3);
    }
    const calves = program({ slot: "calves", exercise: "standing_calf_raise", e1rm: null });
    expect(new Set(calves.map((week) => week.reps))).toEqual(new Set([12]));
  });

  it("prescribes by effort alone when the lift has never been logged", () => {
    const weeks = program({ e1rm: null });
    expect(weeks.every((week) => week.load === null)).toBe(true);
    // The effort climbs half an RPE a week through the opening block instead.
    expect(weeks.slice(0, 3).map((week) => week.rpe)).toEqual([7, 7.5, 8]);
  });

  it("never loads a bodyweight lift from an estimate", () => {
    const weeks = program({ exercise: "pull_up", slot: "pull", e1rm: 40 });
    expect(weeks.every((week) => week.load === null)).toBe(true);
  });

  it("writes loads in the athlete's unit on that unit's plates", () => {
    const weeks = program({ unit: "lbs", e1rm: 231 });
    for (const week of weeks) expect(week.load! % 5).toBe(0);
  });
});
