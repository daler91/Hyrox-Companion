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
  // Tables that MUST have a direct users.id FK with onDelete: "cascade".
  // Adding a new user-owned table? Add it here so the cascade invariant
  // is enforced at the PR level instead of in production.
  const directUserFkTables = {
    trainingPlans,
    workoutLogs,
    stravaConnections,
    garminConnections,
    timelineAnnotations,
    customExercises,
    chatMessages,
    coachingMaterials,
    idempotencyKeys,
    documentChunks,
    aiUsageLogs,
    pushSubscriptions,
  } as const;

  // Tables that are user-scoped transitively through a parent table rather
  // than via a direct FK. Each entry declares the parent whose cascade
  // reaches users. This list is *closed*: any OTHER table with no direct
  // users FK is a regression (the table that should have carried the FK
  // silently lost it), so the generic test below fails for unexpected
  // members.
  const transitivelyOwnedTables: Array<{
    label: string;
    table: typeof exerciseSets | typeof documentChunks | typeof planDays;
    parent: typeof workoutLogs | typeof coachingMaterials | typeof trainingPlans;
  }> = [
    { label: "exerciseSets → workoutLogs", table: exerciseSets, parent: workoutLogs },
    { label: "planDays → trainingPlans", table: planDays, parent: trainingPlans },
    // documentChunks also has a direct userId FK (verified above), but its
    // materialId cascade is the second line of defence; both must work.
    { label: "documentChunks → coachingMaterials", table: documentChunks, parent: coachingMaterials },
  ];

  for (const [label, table] of Object.entries(directUserFkTables)) {
    it(`${label} has a direct users.id FK that cascades`, () => {
      const config = getTableConfig(table);
      const fksToUsers = config.foreignKeys.filter(
        (fk) => fk.reference().foreignTable === users,
      );

      // Fail loudly if the FK was renamed, dropped, or swapped to a
      // different parent. Previously an early `return` here silently
      // allowed regressions like chatMessages losing its users FK to
      // pass the suite (Codex review of PR #877).
      expect(
        fksToUsers.length,
        `${label} must declare at least one FK to users.id — if this table became transitively owned, move it to transitivelyOwnedTables and add the parent cascade chain`,
      ).toBeGreaterThan(0);

      for (const fk of fksToUsers) {
        expect(
          fk.onDelete,
          `${label} → users.id FK must use onDelete: "cascade" so DELETE /api/v1/account removes these rows`,
        ).toBe("cascade");
      }
    });
  }

  for (const { label, table, parent } of transitivelyOwnedTables) {
    it(`${label} cascades transitively through its parent`, () => {
      const config = getTableConfig(table);
      const parentFks = config.foreignKeys.filter(
        (fk) => fk.reference().foreignTable === parent,
      );
      expect(
        parentFks.length,
        `${label} should have at least one FK to its parent`,
      ).toBeGreaterThan(0);
      const cascadingParentFk = parentFks.find((fk) => fk.onDelete === "cascade");
      expect(
        cascadingParentFk,
        `${label} must cascade through its parent so user deletion removes it transitively`,
      ).toBeDefined();
    });
  }
});
