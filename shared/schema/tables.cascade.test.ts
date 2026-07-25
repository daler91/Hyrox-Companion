import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as allTables from "./tables";
import {
  aiUsageLogs,
  chatMessages,
  coachingMaterials,
  customExercises,
  documentChunks,
  exerciseSets,
  foods,
  garminConnections,
  idempotencyKeys,
  mafProfile,
  mafTestResults,
  mafWorkoutAnalysis,
  planDays,
  pushSubscriptions,
  stravaConnections,
  timelineAnnotations,
  trainingPlans,
  users,
  userTrainingStyle,
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
    // Art. 9 health data + training-style history — guard their cascade too (S12).
    userTrainingStyle,
    mafProfile,
    mafTestResults,
    mafWorkoutAnalysis,
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

  // foods is deliberately NOT in either list above: its owner FK must stay
  // `set null` (NOT cascade) because RESTRICT FKs from food_log_entries /
  // recipes into foods would abort the user delete if the food row vanished
  // first. Erasure of a deleted user's PRIVATE custom foods happens instead
  // via the two-phase purge in storage.users.deleteUserAndPrivateCustomFoods
  // (capture ids → user cascade removes referencing rows → delete foods),
  // with the vector-DB embeddings purged in server/routes/account.ts. PUBLIC
  // custom foods survive by explicit opt-in (foods.is_public). This test pins
  // that intent so a well-meaning "add the cascade" change trips here first.
  it("foods.createdByUserId intentionally uses set null (erasure handled by the account-deletion purge)", () => {
    const config = getTableConfig(foods);
    const fksToUsers = config.foreignKeys.filter((fk) => fk.reference().foreignTable === users);
    expect(fksToUsers.length).toBeGreaterThan(0);
    for (const fk of fksToUsers) {
      expect(
        fk.onDelete,
        "foods → users.id must stay onDelete: 'set null'; if you change this, rework deleteUserAndPrivateCustomFoods and the RESTRICT FKs into foods together",
      ).toBe("set null");
    }
  });

  // The lists above name the tables we care about by hand, which is good for
  // failure messages but cannot notice a table nobody remembered to add. This
  // sweep closes that gap: EVERY exported table with a direct users.id FK must
  // cascade unless it appears in the exceptions below with a reason.
  //
  // It exists because the hand-written list had drifted to cover 16 of 27 such
  // FKs, and one of the uncovered eleven — structured_exercise_backfill_reviews
  // — was still `set null` while its reader matched
  // `user_id = $me OR user_id IS NULL`, so a deleted athlete's rows became
  // visible to everyone. Exactly the foods leak, in a second table.
  const DOCUMENTED_NON_CASCADE: Record<string, { onDelete: string; why: string }> = {
    foods: {
      onDelete: "set null",
      why: "RESTRICT FKs from food_log_entries/recipes would abort the user delete; erasure runs via deleteUserAndPrivateCustomFoods, and public foods survive by explicit opt-in (see the dedicated test above)",
    },
  };

  it("every table with a direct users.id FK cascades, or is a documented exception", () => {
    const violations: string[] = [];
    let checked = 0;

    for (const [name, exported] of Object.entries(allTables)) {
      if (!is(exported, PgTable)) continue;
      const fksToUsers = getTableConfig(exported).foreignKeys.filter(
        (fk) => fk.reference().foreignTable === users,
      );
      if (fksToUsers.length === 0) continue;

      const expected = DOCUMENTED_NON_CASCADE[name]?.onDelete ?? "cascade";
      for (const fk of fksToUsers) {
        checked += 1;
        if (fk.onDelete !== expected) {
          violations.push(
            `${name}.users_id FK is onDelete: ${String(fk.onDelete)}, expected ${expected}. ` +
              `A user-owned table must cascade so DELETE /api/v1/account erases it; if it genuinely must not, ` +
              `add it to DOCUMENTED_NON_CASCADE with the erasure path that covers it instead.`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
    // Guards the guard: if the schema is refactored such that this sweep stops
    // seeing tables, it must fail rather than vacuously pass.
    expect(checked).toBeGreaterThanOrEqual(27);
  });

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
