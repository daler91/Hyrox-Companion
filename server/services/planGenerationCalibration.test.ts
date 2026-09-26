import { describe, expect, it, vi } from "vitest";

import {
  buildGenerationEngine,
  buildGenerationSelection,
  reflectedLogIds,
} from "./planGenerationCalibration";

vi.mock("../storage", () => ({ storage: {} }));
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

type User = Parameters<typeof buildGenerationSelection>[1];
type History = NonNullable<Parameters<typeof buildGenerationSelection>[3]>;

const TODAY = "2026-06-15";
const input = {
  goal: "HYROX Open",
  experienceLevel: "intermediate" as const,
  focusAreas: undefined,
  injuries: undefined,
};

function user(overrides: Record<string, unknown> = {}): User {
  return {
    weightUnit: "kg",
    distanceUnit: "km",
    trainingConstraints: null,
    ...overrides,
  } as unknown as User;
}

function history(
  sessions: { id: string; date: string; countsAsTraining: boolean; exerciseName: string }[],
): History {
  return {
    workoutLogs: sessions.map(({ id, date, countsAsTraining }) => ({
      id,
      date,
      focus: null,
      countsAsTraining,
    })),
    sets: sessions.map(({ id, date, exerciseName }) => ({
      workoutLogId: id,
      date,
      exerciseName,
      customLabel: null,
      reps: 5,
      weight: 60,
      weightUnit: "kg",
    })),
  } as unknown as History;
}

describe("buildGenerationSelection", () => {
  it("reads the plan's own injuries box ahead of the stored constraints", () => {
    const brief = buildGenerationSelection(
      { ...input, injuries: "no sled at my gym" },
      user({ trainingConstraints: "no barbell" }),
      TODAY,
      null,
    );
    expect(brief?.unavailableEquipment).toEqual(["sled"]);
  });

  it("falls back to the stored constraints when the request carries none", () => {
    const brief = buildGenerationSelection(
      input,
      user({ trainingConstraints: "no barbell" }),
      TODAY,
      null,
    );
    expect(brief?.unavailableEquipment).toEqual(["barbell"]);
  });

  it("treats an emptied injuries box as no constraints, not as 'use the old ones'", () => {
    const brief = buildGenerationSelection(
      { ...input, injuries: "" },
      user({ trainingConstraints: "no barbell" }),
      TODAY,
      null,
    );
    expect(brief?.unavailableEquipment).toEqual([]);
  });

  it("leaves sessions that don't count as training out of the athlete's habits", () => {
    const brief = buildGenerationSelection(
      input,
      user(),
      TODAY,
      history([
        { id: "a", date: "2026-06-01", countsAsTraining: true, exerciseName: "front_squat" },
        { id: "b", date: "2026-06-08", countsAsTraining: true, exerciseName: "front_squat" },
        { id: "w1", date: "2026-06-09", countsAsTraining: false, exerciseName: "rucking" },
        { id: "w2", date: "2026-06-10", countsAsTraining: false, exerciseName: "rucking" },
      ]),
    );
    expect(brief?.staples.map((staple) => staple.exercise)).toEqual(["front_squat"]);
  });

  it("still reasons from the goal and focus areas with no history at all", () => {
    const brief = buildGenerationSelection(
      { ...input, focusAreas: ["sled_pull"] },
      user(),
      TODAY,
      null,
    );
    expect(brief?.lens).toBe("hyrox");
    expect(brief?.needs[0]?.candidates[0]?.exercise).toBe("sled_pull");
    expect(brief?.primaryLifts.length).toBeGreaterThan(0);
  });
});

describe("buildGenerationEngine", () => {
  const plan = {
    ...input,
    daysPerWeek: 4,
    restDays: undefined,
    totalWeeks: 8,
    raceDate: "2026-08-10",
  };

  it("needs the brief's lens and primary lifts", () => {
    expect(buildGenerationEngine(plan, user(), TODAY, null, null)).toBeNull();
  });

  it("lays out the plan from the brief even with no history", () => {
    const brief = buildGenerationSelection(plan, user(), TODAY, null);
    const engine = buildGenerationEngine(plan, user(), TODAY, null, brief);
    expect(engine?.lens).toBe("hyrox");
    expect(engine?.hasRace).toBe(true);
    expect(engine?.weeks[0]?.sessions).toHaveLength(4);
    expect(engine?.lifts.map((lift) => lift.exercise)).toEqual(
      brief?.primaryLifts.map((lift) => lift.exercise),
    );
    expect(engine?.lifts.every((lift) => lift.estimate === null)).toBe(true);
  });

  it("estimates strength from training sessions only", () => {
    const sessions = history([
      { id: "a", date: "2026-06-01", countsAsTraining: true, exerciseName: "front_squat" },
      { id: "b", date: "2026-06-08", countsAsTraining: true, exerciseName: "front_squat" },
      { id: "w", date: "2026-06-09", countsAsTraining: false, exerciseName: "front_squat" },
    ]);
    const brief = buildGenerationSelection(plan, user(), TODAY, sessions);
    const engine = buildGenerationEngine(plan, user(), TODAY, sessions, brief);
    const squat = engine?.lifts.find((lift) => lift.exercise === "front_squat");
    expect(squat?.estimate?.sessions).toBe(2);
  });

  it("drops the stations the plan's constraints rule out", () => {
    const constrained = { ...plan, injuries: "no sled at my gym" };
    const brief = buildGenerationSelection(constrained, user(), TODAY, null);
    const engine = buildGenerationEngine(constrained, user(), TODAY, null, brief);
    const early = engine?.stations.get("early");
    expect(early?.doses.map((dose) => dose.station)).toContain("wall_balls");
    expect(early?.doses.map((dose) => dose.station)).not.toContain("sled_push");
  });
});

describe("reflectedLogIds", () => {
  it("marks the recent training sessions the new plan was computed from", () => {
    const sessions = history([
      { id: "old", date: "2026-05-20", countsAsTraining: true, exerciseName: "front_squat" },
      { id: "recent", date: "2026-06-10", countsAsTraining: true, exerciseName: "front_squat" },
      { id: "walk", date: "2026-06-12", countsAsTraining: false, exerciseName: "walking" },
    ]);
    expect(reflectedLogIds(sessions, TODAY)).toEqual(["recent"]);
    expect(reflectedLogIds(null, TODAY)).toEqual([]);
  });
});
