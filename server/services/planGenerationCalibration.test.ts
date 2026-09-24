import { describe, expect, it, vi } from "vitest";

import { buildGenerationSelection } from "./planGenerationCalibration";

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
