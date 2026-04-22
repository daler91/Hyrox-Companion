import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  aiUsageLogs,
  chatMessages,
  coachingMaterials,
  customExercises,
  documentChunks,
  exerciseSets,
  garminConnections,
  idempotencyKeys,
  planDays,
  pushSubscriptions,
  stravaConnections,
  timelineAnnotations,
  trainingPlans,
  users,
  workoutLogs,
} from "./tables";

// The README promises that DELETE /api/v1/account cascades to every
// table owning user-scoped data. `server/routes/account.ts` relies on
// FK cascades to do this — so any `users.id` reference that is missing
// `onDelete: "cascade"` is a silent privacy bug waiting to happen.
//
// Asserting the schema directly (instead of running a full integration
// test against a real Postgres) catches regressions the moment a new
// child table is added without the cascade, which is the more likely
// failure mode than a migration drift.
describe("user-owned tables cascade on DELETE", () => {
  // Every table that has a user_id FK. When adding a new table that
  // stores user-owned data, add it here so the cascade invariant is
  // enforced at the PR level instead of in production.
  const tables = {
    trainingPlans,
    planDays,
    workoutLogs,
    stravaConnections,
    garminConnections,
    exerciseSets,
    timelineAnnotations,
    customExercises,
    chatMessages,
    coachingMaterials,
    idempotencyKeys,
    documentChunks,
    aiUsageLogs,
    pushSubscriptions,
  };

  for (const [label, table] of Object.entries(tables)) {
    it(`${label} cascades on users.id deletion`, () => {
      const config = getTableConfig(table);
      const fksToUsers = config.foreignKeys.filter((fk) => {
        const ref = fk.reference();
        return ref.foreignTable === users;
      });

      if (fksToUsers.length === 0) {
        // Only a few tables legitimately have no direct users FK
        // (they cascade transitively via trainingPlans / workoutLogs /
        // coachingMaterials). Those are exercised separately via the
        // second test below, so skip the direct-cascade assertion.
        return;
      }

      for (const fk of fksToUsers) {
        expect(
          fk.onDelete,
          `${label} → users.id FK must use onDelete: "cascade" so DELETE /api/v1/account removes these rows`,
        ).toBe("cascade");
      }
    });
  }

  it("transitive cascade chains reach users through their owning table", () => {
    // exerciseSets → workoutLogs → users (cascade on workoutLogId)
    // documentChunks → coachingMaterials → users (cascade on materialId)
    // planDays → trainingPlans → users (cascade on planId)
    const transitives: Array<{
      label: string;
      table: typeof exerciseSets | typeof documentChunks | typeof planDays;
      parent: typeof workoutLogs | typeof coachingMaterials | typeof trainingPlans;
    }> = [
      { label: "exerciseSets → workoutLogs", table: exerciseSets, parent: workoutLogs },
      { label: "documentChunks → coachingMaterials", table: documentChunks, parent: coachingMaterials },
      { label: "planDays → trainingPlans", table: planDays, parent: trainingPlans },
    ];

    for (const { label, table, parent } of transitives) {
      const config = getTableConfig(table);
      const parentFks = config.foreignKeys.filter((fk) => fk.reference().foreignTable === parent);
      expect(parentFks.length, `${label} should have at least one FK to its parent`).toBeGreaterThan(0);
      const cascadingParentFk = parentFks.find((fk) => fk.onDelete === "cascade");
      expect(
        cascadingParentFk,
        `${label} must cascade through its parent so user deletion removes it transitively`,
      ).toBeDefined();
    }
  });
});
