import { describe, expect, it } from "vitest";

import {
  buildWorkoutEnginePlan,
  type WorkoutEngineInput,
} from "../services/workoutEngine/enginePlan";
import { describeEngineTargetLines } from "./workoutEngine";

const RUNS = [
  { id: "r1", date: "2026-09-04", focus: "Run", distanceMeters: 6000, duration: 35 },
  { id: "r2", date: "2026-09-06", focus: "Run", distanceMeters: 5000, duration: 24 },
  { id: "r3", date: "2026-09-16", focus: "Run", distanceMeters: 7000, duration: 41 },
];

const SQUATS = ["2026-09-01", "2026-09-08", "2026-09-15"].map((date, index) => ({
  exerciseName: "front_squat",
  workoutLogId: `s-${index}`,
  date,
  reps: 5,
  weight: 80 + 2.5 * index,
  weightUnit: "kg",
}));

function engine(overrides: Partial<WorkoutEngineInput> = {}) {
  return buildWorkoutEnginePlan({
    lens: "hyrox",
    experience: "intermediate",
    primaryLifts: [
      { slot: "squat", exercise: "front_squat", sessions: 3 },
      { slot: "hinge", exercise: "romanian_deadlift", sessions: 0 },
    ],
    goal: "HYROX Open",
    totalWeeks: 12,
    daysPerWeek: 5,
    hasRace: true,
    today: "2026-09-20",
    weightUnit: "kg",
    distanceUnit: "km",
    division: "open",
    gender: "male",
    sets: SQUATS,
    logs: RUNS,
    ...overrides,
  });
}

function block(chunk: { startWeek: number; endWeek: number; daysBeforeStart?: string[] }) {
  return describeEngineTargetLines(engine(), chunk).join("\n");
}

describe("describeEngineTargetLines", () => {
  it("is empty without an engine plan", () => {
    expect(describeEngineTargetLines(null, { startWeek: 1, endWeek: 2 })).toEqual([]);
  });

  it("states the weekly rhythm, the lift evidence and the run paces", () => {
    const text = block({ startWeek: 3, endWeek: 4 });
    expect(text).toContain("WORKOUT ENGINE TARGETS");
    expect(text).toMatch(/Weekly rhythm \(the same days every week, deloads included\): Monday = /);
    expect(text).toContain("front_squat est. 1RM 104.8 kg (from 85 kg x 5 on 2026-09-15)");
    expect(text).toContain("romanian_deadlift: no logged load, so its targets are effort only");
    expect(text).toMatch(
      /Run paces \(fitted to the athlete's best recent run, 5 km in 24:00 on 2026-09-06\): easy \d:\d\d-\d:\d\d\/km/,
    );
  });

  it("gives every week in the chunk its sessions with the lifts' exact numbers", () => {
    const plan = engine();
    const target = plan.lifts[0].weeks[2];
    const text = describeEngineTargetLines(plan, { startWeek: 3, endWeek: 4 }).join("\n");
    expect(text).toContain("Week 3 — EARLY (block 1):");
    expect(text).toContain(
      `front_squat ${target.sets}x${target.reps} @ ${target.load} kg (RPE ${target.rpe}, rest 90-120 s)`,
    );
    expect(text).toContain("Week 4 — BUILD, DELOAD (block 1):");
    expect(text).toContain("deload: about half the usual work");
    expect(text).not.toContain("Week 5");
  });

  it("only lists the station doses for the phases the chunk covers", () => {
    const early = block({ startWeek: 1, endWeek: 2 });
    expect(early).toContain("Station doses, EARLY");
    expect(early).not.toContain("Station doses, PEAK");
    expect(early).toContain("sled push 5 x 12.5 m @ 180 kg");
  });

  it("drops week-1 sessions that fall before the plan starts", () => {
    const plan = engine();
    const firstDay = plan.weeks[0].sessions[0].day;
    const text = describeEngineTargetLines(plan, {
      startWeek: 1,
      endWeek: 1,
      daysBeforeStart: [firstDay],
    }).join("\n");
    expect(text).not.toContain(`- ${firstDay}, `);
  });

  it("puts the full race simulation on the last peak week and keeps race week to primers", () => {
    const peak = block({ startWeek: 9, endWeek: 10 });
    expect(peak).toContain("Week 9 — PEAK");
    expect(peak.match(/FULL race simulation/g)).toHaveLength(1);
    expect(peak.split("Week 10")[1]).toContain("FULL race simulation");

    const race = block({ startWeek: 11, endWeek: 12 });
    expect(race).toContain("Week 12 — RACE WEEK (block 3):");
    expect(race).toContain("At most two short sessions early in the week");
    expect(race).toContain("station openers");
  });

  it("calls a non-race plan's last week the final week and programmes it", () => {
    const text = describeEngineTargetLines(engine({ hasRace: false }), {
      startWeek: 12,
      endWeek: 12,
    }).join("\n");
    expect(text).toContain("Week 12 — FINAL WEEK");
    expect(text).not.toContain("At most two short sessions");
  });

  it("writes paces and distances in miles for a miles athlete", () => {
    const text = describeEngineTargetLines(engine({ distanceUnit: "miles" }), {
      startWeek: 1,
      endWeek: 1,
    }).join("\n");
    expect(text).toMatch(/threshold \d+:\d\d\/mi/);
    expect(text).not.toMatch(/\/km/);
  });
});
