import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CATALOGUE_PATH,
  CATALOGUE_SOURCE,
  type CatalogueSource,
  CHUNK,
  generateExerciseCatalogue,
  kotlinDouble,
  kotlinString,
} from "./generate";

const ROOT = path.resolve(__dirname, "../..");

/** A tiny catalogue for the mapping tests. */
const SMALL: CatalogueSource = {
  definitions: {
    back_squat: { label: "Back Squat", category: "strength", fields: ["sets", "reps", "weight"] },
    run: { label: "Run", category: "running", fields: ["distance", "time"] },
  },
  aliases: { running: "run" },
  equipment: { back_squat: ["barbell"], goblet_squat: ["dumbbell", "kettlebell"], run: undefined },
  implementOverrides: { pull_up: "bodyweight" },
  barbellSteps: { kg: 2.5, lbs: 5 },
  increments: new Map([["machine", { kg: 5, lbs: 10 }]]),
  loadedImplements: ["barbell", "dumbbell"],
};

describe("committed exercise catalogue", () => {
  it("is what the TypeScript tables generate (run `pnpm mobile:catalogue` after changing them)", () => {
    const committed = readFileSync(path.join(ROOT, CATALOGUE_PATH), "utf8");
    expect(committed).toBe(generateExerciseCatalogue());
  });

  it("is the only file in its generated package", () => {
    expect(readdirSync(path.dirname(path.join(ROOT, CATALOGUE_PATH)))).toEqual([
      path.basename(CATALOGUE_PATH),
    ]);
  });

  it("carries every definition, alias and equipment entry", () => {
    const content = generateExerciseCatalogue();
    const puts = (fill: string) =>
      [
        ...content.matchAll(
          new RegExp(`fun MutableMap<[^\\n]+?>\\.${fill}\\d+\\(\\) \\{\\n([^}]*)\\}`, "g"),
        ),
      ]
        .flatMap((m) => m[1].split("\n"))
        .filter((line) => line.trim().startsWith("put(")).length;

    expect(puts("exerciseDefinitions")).toBe(Object.keys(CATALOGUE_SOURCE.definitions).length);
    expect(puts("exerciseNameAliases")).toBe(Object.keys(CATALOGUE_SOURCE.aliases).length);
    expect(puts("exerciseEquipment")).toBe(Object.keys(CATALOGUE_SOURCE.equipment).length);
  });
});

describe("generateExerciseCatalogue", () => {
  const content = generateExerciseCatalogue(SMALL);

  it("writes definitions and aliases as ordered maps of hand-written types", () => {
    expect(content).toContain("package com.fitai.coach.core.exercises.generated");
    expect(content).toContain("import com.fitai.coach.core.exercises.ExerciseDefinition");
    expect(content).toContain(
      "public val EXERCISE_DEFINITIONS: Map<String, ExerciseDefinition> = buildMap(2) {",
    );
    expect(content).toMatch(
      /put\("back_squat", ExerciseDefinition\("Back Squat", "strength", listOf\("sets", "reps", "weight"\)\)\)\n {4}put\("run",/,
    );
    expect(content).toContain('put("running", "run")');
  });

  it("skips absent equipment entries and maps implements to the Kotlin enum", () => {
    expect(content).toContain('put("goblet_squat", listOf("dumbbell", "kettlebell"))');
    expect(content).not.toContain('put("run", listOf(');
    expect(content).toContain('put("pull_up", Implement.Bodyweight)');
    expect(content).toContain(
      "internal val LOADED_IMPLEMENTS: List<Implement> = listOf(Implement.Barbell, Implement.Dumbbell)",
    );
    expect(content).toContain("put(Implement.Machine, ImplementSteps(kg = 5.0, lbs = 10.0))");
  });

  it("refers to BARBELL_STEPS where INCREMENTS shares that object", () => {
    const shared = generateExerciseCatalogue({
      ...SMALL,
      increments: new Map([["barbell", SMALL.barbellSteps]]),
    });
    expect(shared).toContain(
      "internal val BARBELL_STEPS: ImplementSteps = ImplementSteps(kg = 2.5, lbs = 5.0)",
    );
    expect(shared).toContain("put(Implement.Barbell, BARBELL_STEPS)");
  });

  it("splits a large map across initialiser functions of at most CHUNK entries", () => {
    const many = Object.fromEntries(
      Array.from({ length: CHUNK * 2 + 1 }, (_, i) => [`alias_${i}`, "run"]),
    );
    const big = generateExerciseCatalogue({ ...SMALL, aliases: many });
    expect(big).toContain(
      "    exerciseNameAliases0()\n    exerciseNameAliases1()\n    exerciseNameAliases2()\n}",
    );
    expect(big).not.toContain("exerciseNameAliases3");
  });

  it("rejects an alias to an unknown exercise", () => {
    expect(() => generateExerciseCatalogue({ ...SMALL, aliases: { jog: "jogging" } })).toThrow(
      /unknown exercise jogging/,
    );
  });
});

describe("Kotlin literals", () => {
  it("escapes strings for Kotlin, non-ASCII as \\u escapes", () => {
    expect(kotlinString('a "b" $c \\d')).toBe('"a \\"b\\" \\$c \\\\d"');
    expect(kotlinString("café’\n")).toBe('"caf\\u00e9\\u2019\\u000a"');
  });

  it("writes doubles that parse back exactly", () => {
    expect(kotlinDouble(5)).toBe("5.0");
    expect(kotlinDouble(2.5)).toBe("2.5");
    expect(kotlinDouble(1e-7)).toBe("1e-7");
    expect(() => kotlinDouble(Number.NaN)).toThrow();
  });
});
