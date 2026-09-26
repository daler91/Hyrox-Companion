import { PLAN_WEEKDAYS } from "@shared/dateUtils";
import { describe, expect, it } from "vitest";

import type { GoalLens } from "../ai/exerciseKnowledge";
import { buildWeekSkeleton, type WeekSkeleton, type WeekSkeletonInput } from "./weekSkeleton";

const HYROX_LIFTS: WeekSkeletonInput["primaryLifts"] = [
  { slot: "squat", exercise: "front_squat" },
  { slot: "hinge", exercise: "romanian_deadlift" },
  { slot: "vertical_push", exercise: "push_press" },
  { slot: "pull", exercise: "bent_over_row" },
  { slot: "single_leg", exercise: "walking_lunges" },
];
const STRENGTH_LIFTS: WeekSkeletonInput["primaryLifts"] = [
  { slot: "squat", exercise: "back_squat" },
  { slot: "hinge", exercise: "deadlift" },
  { slot: "horizontal_push", exercise: "bench_press" },
  { slot: "vertical_push", exercise: "overhead_press" },
  { slot: "pull", exercise: "pull_up" },
];

function skeleton(overrides: Partial<WeekSkeletonInput> = {}): WeekSkeleton {
  return buildWeekSkeleton({
    lens: "hyrox",
    phase: "build",
    daysPerWeek: 5,
    primaryLifts: HYROX_LIFTS,
    ...overrides,
  });
}

function dayIndex(day: string): number {
  return PLAN_WEEKDAYS.indexOf(day as (typeof PLAN_WEEKDAYS)[number]);
}

/** Days between each session and the next, in week order. */
function gaps(days: readonly number[]): number[] {
  return days.slice(1).map((day, index) => day - (days.at(index) ?? day));
}

function describeWeek(week: WeekSkeleton): string[] {
  return week.sessions.map((session) => `${session.day}:${session.kind}`);
}

describe("buildWeekSkeleton", () => {
  it("trains exactly the requested days and rests the rest", () => {
    for (let days = 2; days <= 7; days++) {
      const week = skeleton({ daysPerWeek: days });
      expect(week.sessions).toHaveLength(days);
      expect(week.restDays).toHaveLength(7 - days);
    }
  });

  it("never schedules a session on a day the athlete keeps free", () => {
    const week = skeleton({ daysPerWeek: 4, restDays: ["Monday", "Friday"] });
    expect(week.sessions.map((session) => session.day)).not.toContain("Monday");
    expect(week.sessions.map((session) => session.day)).not.toContain("Friday");
  });

  it("trains fewer days when the free days leave no room", () => {
    const week = skeleton({ daysPerWeek: 6, restDays: ["Monday", "Tuesday", "Wednesday"] });
    expect(week.sessions).toHaveLength(4);
  });

  it("is deterministic, so every chunk of a plan gets the same week", () => {
    expect(describeWeek(skeleton())).toEqual(describeWeek(skeleton()));
  });

  it("gives a three-day HYROX week strength, a threshold run and stations, plus a run finisher", () => {
    const week = skeleton({ daysPerWeek: 3 });
    expect(week.sessions.map((session) => session.kind).sort((a, b) => a.localeCompare(b))).toEqual(
      ["stations", "strength", "threshold_run"],
    );
    const strength = week.sessions.find((session) => session.kind === "strength");
    if (!strength) throw new Error("expected a strength session");
    // One strength session carries every primary lift.
    expect(strength.lifts.map((lift) => lift.exercise)).toEqual([
      "front_squat",
      "romanian_deadlift",
      "push_press",
      "bent_over_row",
      "walking_lunges",
    ]);
    expect(strength.runFinisher).toBe(true);
  });

  it("splits two strength sessions into squat-and-press and hinge-and-pull", () => {
    const strength = skeleton().sessions.filter((session) => session.kind === "strength");
    expect(strength.map((session) => session.lifts.map((lift) => lift.slot))).toEqual([
      ["squat", "vertical_push"],
      ["hinge", "pull", "single_leg"],
    ]);
    expect(strength.every((session) => !session.runFinisher)).toBe(true);
  });

  it("runs a four-day strength week as upper/lower with lighter second exposures", () => {
    const week = skeleton({ lens: "strength", daysPerWeek: 4, primaryLifts: STRENGTH_LIFTS });
    expect(week.sessions.map((session) => session.label)).toEqual([
      "Lower A — squat",
      "Upper A — bench and pull",
      "Lower B — hinge",
      "Upper B — press and pull",
    ]);
    const lowerB = week.sessions[2];
    expect(lowerB.lifts).toContainEqual({
      slot: "squat",
      exercise: "back_squat",
      exposure: "light",
    });
  });

  it.each([
    ["hyrox", HYROX_LIFTS],
    ["strength", STRENGTH_LIFTS],
    ["running", HYROX_LIFTS],
  ] as const)("gives every %s primary lift a main exposure", (lens, lifts) => {
    for (let days = 2; days <= 7; days++) {
      const week = skeleton({ lens: lens as GoalLens, daysPerWeek: days, primaryLifts: lifts });
      if (!week.sessions.some((session) => session.kind === "strength")) continue;
      const main = new Set(
        week.sessions.flatMap((session) =>
          session.lifts.filter((lift) => lift.exposure === "main").map((lift) => lift.slot),
        ),
      );
      for (const lift of lifts) expect(main).toContain(lift.slot);
    }
  });

  it("keeps strength days and quality runs off consecutive days when the week has room", () => {
    const strength = skeleton({ lens: "strength", daysPerWeek: 3, primaryLifts: STRENGTH_LIFTS });
    const days = strength.sessions.map((session) => dayIndex(session.day));
    for (const gap of gaps(days)) expect(gap).toBeGreaterThan(1);

    const running = skeleton({ lens: "running", daysPerWeek: 5 });
    const quality = running.sessions
      .filter((session) => ["threshold_run", "interval_run", "long_run"].includes(session.kind))
      .map((session) => dayIndex(session.day));
    for (const gap of gaps(quality)) expect(gap).toBeGreaterThan(1);
  });

  it("puts the long run on the weekend, and off it only when the weekend is kept free", () => {
    const long = skeleton().sessions.find((session) => session.kind === "long_run");
    expect(["Saturday", "Sunday"]).toContain(long?.day);

    const noWeekend = skeleton({ restDays: ["Saturday", "Sunday"] });
    expect(noWeekend.sessions.some((session) => session.kind === "long_run")).toBe(true);
  });

  it("turns a HYROX week's long session into a race simulation from the peak on", () => {
    const kinds = (phase: WeekSkeletonInput["phase"]) =>
      skeleton({ phase }).sessions.map((session) => session.kind);
    expect(kinds("build")).toContain("long_run");
    expect(kinds("peak")).toContain("simulation");
    expect(kinds("peak")).not.toContain("long_run");
  });

  it("still places a lift whose slot no split names", () => {
    const week = skeleton({
      daysPerWeek: 5,
      primaryLifts: [...HYROX_LIFTS, { slot: "calves", exercise: "standing_calf_raise" }],
    });
    const exercises = week.sessions.flatMap((session) =>
      session.lifts.map((lift) => lift.exercise),
    );
    expect(exercises).toContain("standing_calf_raise");
  });

  it("marks the goal's first three sessions key, easy work optional, the rest supporting", () => {
    const tiers = (week: WeekSkeleton) =>
      Object.fromEntries(week.sessions.map((session) => [session.label, session.priority]));

    // A three-day HYROX week is nothing but what the goal cannot do without.
    expect(Object.values(tiers(skeleton({ daysPerWeek: 3 })))).toEqual(["key", "key", "key"]);

    // Six days adds the long run, a second strength day and intervals around them.
    const six = skeleton({ daysPerWeek: 6 });
    expect(six.sessions.filter((session) => session.priority === "key").map((session) => session.kind).sort()).toEqual(
      ["stations", "strength", "threshold_run"],
    );
    expect(six.sessions.filter((session) => session.priority === "supporting").map((session) => session.kind).sort()).toEqual(
      ["interval_run", "long_run", "strength"],
    );

    // A runner's easy runs are the optional part of the week.
    const runner = skeleton({ lens: "running", daysPerWeek: 5, primaryLifts: STRENGTH_LIFTS });
    expect(runner.sessions.filter((session) => session.kind === "easy_run").map((session) => session.priority)).toEqual([
      "optional",
    ]);
  });
});
