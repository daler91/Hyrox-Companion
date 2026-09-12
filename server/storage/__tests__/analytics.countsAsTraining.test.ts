/**
 * The split that `counts_as_training` exists to make, pinned per call site.
 *
 * The flag answers "does this count as a session I did?", NOT "did my body do
 * work?". So the training surfaces opt in to filtering and the physiological
 * ones must not: a walk's calories are real expenditure, and its duration is
 * real (small) load. Filtering is opt-in in storage precisely so that a new
 * caller has to choose — and this is what notices when one chooses wrong.
 *
 * Source-scanning rather than database-backed, for the same reason
 * `bearerDisableSuppressions.test.ts` is: the property is "which call sites
 * pass the flag", which is a fact about the code, and the unit suite has no
 * Postgres. It asserts presence and absence, never counts — a refactor that
 * legitimately adds a call site should not fail this.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function optsIntoFiltering(file: string): boolean {
  return /onlyTraining:\s*true/.test(readFileSync(file, "utf8"));
}

describe("counts_as_training", () => {
  it("is opt-in in storage, never automatic", () => {
    const source = readFileSync("server/storage/analytics.ts", "utf8");
    // The guard is the whole point: a bare push would filter for every caller,
    // the nutrition energy path included.
    expect(source).toMatch(/if\s*\(options\?\.onlyTraining\)\s*conditions\.push/);
  });

  it.each([
    ["server/services/nutrition/energy.ts", "a walk's calories are real expenditure"],
    ["server/services/nutrition/nutritionSummary.ts", "the load model should see every session"],
    ["server/services/exportService.ts", "an export is the athlete's whole record"],
  ])("leaves %s unfiltered — %s", (file) => {
    expect(optsIntoFiltering(file)).toBe(false);
  });

  it.each([
    ["server/services/trainingOverviewLoader.ts"],
    ["server/services/trainingSummaryService.ts"],
    ["server/services/weeklyReviewService.ts"],
    ["server/services/racePrediction/racePredictionService.ts"],
    ["server/services/workoutUseCases.ts"],
  ])("filters %s", (file) => {
    expect(optsIntoFiltering(file)).toBe(true);
  });

  it("filters the weekly email's counts unconditionally", () => {
    // "You trained N times this week" has only one correct answer, so this one
    // takes no option.
    const source = readFileSync("server/storage/analytics.ts", "utf8");
    const weeklyStats = source.slice(source.indexOf("async getWeeklyStats"));
    expect(weeklyStats).toContain("eq(workoutLogs.countsAsTraining, true)");
  });

  it("splits the AI context in memory rather than paying for a second query", () => {
    // The coach's load governor is built from every session (a walk is small
    // but real load, and under-counting softens a safety signal) while its
    // PR/coverage insights are training-only. Both come from one fetch.
    const source = readFileSync("server/services/ai/index.ts", "utf8");
    expect(source).toContain("log.countsAsTraining !== false");
    expect(source).toMatch(/loadExerciseSets:\s*trainingSets/);
    // The governor still reads the unfiltered rows.
    expect(source).toMatch(/calculateTrainingLoad\(loadWorkoutLogs, loadExerciseSets/);
  });
});
