# Pending manual production steps

Steps that cannot apply themselves and are therefore easy to lose. A migration
comment is not a durable record: nobody reads `migrations/*.sql` on deploy day.

**Why these exist.** Production runs a push-managed schema — `drizzle-kit push`
syncs structure only, and boot-time `migrate()` no-ops against a pushed schema
(see `server/maintenance.ts`). So any migration whose _point_ is a data change
(a DELETE, a backfill) never executes in production, however cleanly it applies
to a fresh database in CI.

**How to use this file.** Run the statement against production, then tick the
box and record the date and who ran it in the same PR. An unticked box is a
live task, not history.

**Verifying.** `pnpm ops:restore-drill` checks every step listed here against
whatever database you point it at, so the monthly restore drill
([backup-restore.md §6](./backup-restore.md#6-restore-drill-cadence--verification))
re-verifies them for free. Note the reverse hazard too: a restored database is
as old as its backup, so a step ticked _after_ that backup was taken has been
rolled back and must be run again.

---

## [ ] Audit — ten older data-bearing migrations of unknown production status

- **Shipped:** identified 2026-09-04 during the mapper-concern verification
  pass (`docs/MAPPER_CONCERNS_VERIFIED_2026-09-04.md`).
- **Run on production:** _not yet — date / operator:_
- **Why manual:** this file was created alongside 0081 and only ever tracked
  migrations from that point on. The push-managed hazard described at the top
  of this file applies identically to every _earlier_ data-bearing migration,
  and production's `drizzle.__drizzle_migrations` ledger is empty, so none of
  them can be assumed to have run. They may have been applied by hand at the
  time; nothing records it either way. **This entry is an audit, not a fix:**
  check each, then tick it or run it.

| Migration                                    | Data operation                                                                                        | Consequence if it never ran                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0016_rename_hyrox_station_to_functional`    | `UPDATE` category `hyrox_station` → `functional`                                                      | Low. The old string appears nowhere in `shared/`, `server/` or `client/`, so stale rows are inert.                                                                                                                                                                                                                                                                                                    |
| `0018_backfill_plan_dates_and_workout_links` | 4 backfills: null stale `plan_day_id`, `training_plans.start_date`/`end_date`, `workout_logs.plan_id` | Plans missing start/end dates; workout↔plan links unset on old rows.                                                                                                                                                                                                                                                                                                                                  |
| `0029_workout_prescription_snapshot`         | Backfill `prescribed_main_workout`/`accessory`/`notes`                                                | Pre-0029 workouts have no prescription snapshot, so adherence reads against a mutable text field.                                                                                                                                                                                                                                                                                                     |
| `0031_user_adherence_visibility_pref`        | `UPDATE users`                                                                                        | Preference default not applied to pre-existing users.                                                                                                                                                                                                                                                                                                                                                 |
| `0032_unusual_rogue`                         | `UPDATE exercise_sets`                                                                                | See the migration body before ticking.                                                                                                                                                                                                                                                                                                                                                                |
| `0035_maf_artifacts`                         | `INSERT INTO user_training_style … 'migration_default'` per existing user                             | Users predating 0035 have no training-style row.                                                                                                                                                                                                                                                                                                                                                      |
| `0036_maf_post_migration_validation`         | Creates `data_remediation_log` + `v_maf_post_migration_validation`, plus remediation DML              | **Neither object is in the Drizzle schema**, so `push` does not create them either — they are absent from production regardless.                                                                                                                                                                                                                                                                      |
| `0044_cloudy_bloodaxe`                       | `UPDATE workout_structure_steps` clearing rest-step targets                                           | Runs _before_ a CHECK and UNIQUE INDEX in the same file. Both ARE in the Drizzle schema, so `push` would have refused them if violating rows existed — verify the constraint is actually present.                                                                                                                                                                                                     |
| `0047_last_magik`                            | `UPDATE users SET onboarding_completed = true`                                                        | Low. `useOnboarding` also gates on `isNewUser` and a local flag, so existing users are not re-onboarded.                                                                                                                                                                                                                                                                                              |
| `0049_exercise_load_tags`                    | **Seeds all 39 rows of `exercise_load_tags`**                                                         | **Highest impact.** `server/storage/analytics.ts` is the only code touching this table and it only ever SELECTs, so a migration is the sole way it is populated. `calculateTrainingLoad` defaults `loadTags` to `[]` and degrades **silently** — no error, no log — so AI coach context, nutrition daily load, race prediction and training overview would all be computing with neutral multipliers. |

- **Safe to re-run:** varies. 0049 is the one to check first and is safely
  re-runnable as an upsert; treat the rest individually.
- **How to check 0049 (do this first):**
  ```sql
  SELECT count(*) FROM exercise_load_tags;
  -- expect 39. A 0 here confirms the seed never ran.
  ```
  If it returns 0, replay the `INSERT` from
  `migrations/0049_exercise_load_tags.sql` with `ON CONFLICT DO NOTHING`.
- **Verify 0036's objects exist at all:**
  ```sql
  SELECT to_regclass('public.data_remediation_log'),
         to_regclass('public.v_maf_post_migration_validation');
  -- both NULL = never created, by migrate() or push
  ```

## [ ] 0081 — purge orphaned private custom foods

- **Migration:** `migrations/0081_purge_orphaned_private_custom_foods.sql`
- **Shipped:** PR #1663 (2026-07-19)
- **Run on production:** _not yet — date / operator:_
- **Why manual:** the migration's payload is a DELETE, which push-managed
  production never applies.
- **What it does:** erases custom foods stranded ownerless by accounts deleted
  before the two-phase erasure existed. They are already invisible to users
  (`visibleTo` no longer treats a NULL owner as shared), so this removes the
  at-rest personal data — free-text food names and brands — rather than closing
  an active exposure.
- **Safe to re-run:** yes, idempotent. Matches nothing once it has run.
- **How:** copy the `DELETE` statement out of the migration file and run it via
  `psql "$DATABASE_URL"`, or dispatch the post-migration workflow.
- **Verify afterwards:**
  ```sql
  SELECT count(*) FROM foods
  WHERE source = 'custom' AND created_by_user_id IS NULL AND NOT is_public;
  -- expect 0
  ```

## [ ] 0082 — purge orphaned backfill-review rows

- **Migration:** `migrations/0082_hesitant_exiles.sql`
- **Shipped:** PR #1683 (2026-07-25)
- **Run on production:** _not yet — date / operator:_
- **Why manual:** same reason as 0081 for its `DELETE`. Note the `ALTER TABLE`
  half of this migration DOES reach production via `drizzle-kit push`, since
  that is a schema change — only the row cleanup needs a hand.
- **What it does:** deletes `structured_exercise_backfill_reviews` rows whose
  `user_id` is NULL. Those are orphans from accounts deleted while the FK was
  still `set null`, and `listBackfillReviews` matches
  `user_id = $me OR user_id IS NULL` — so until they are removed they are
  returned to every athlete.
- **Safe to re-run:** yes. Every insert path copies a non-null `user_id` from
  the owning workout or plan day, so a NULL can only mean a deleted owner.
- **Verify afterwards:**
  ```sql
  SELECT count(*) FROM structured_exercise_backfill_reviews WHERE user_id IS NULL;
  -- expect 0
  ```

## [ ] 0091 — dedupe versioned targets and in-flight plan generations

- **Migration:** `migrations/0091_lyrical_human_fly.sql`
- **Shipped:** 2026-09-01 (codebase-analysis remediation, priority item 4)
- **Run on production:** _not yet — date / operator:_
- **Why manual:** the migration pairs three `CREATE UNIQUE INDEX` statements
  (which `drizzle-kit push` DOES apply as schema) with the remediation
  `DELETE`s/`UPDATE` that make them creatable — and it is the remediation half
  that push never runs. **Order matters here more than for 0081/0082:** if
  production has duplicates, `push` will fail to create the indexes until the
  remediation statements are run by hand, so run them _before_ (or immediately
  after a failed) push.
- **What it does:** removes duplicate `nutrition_targets` (user, effective_from)
  and `meal_targets` (user, meal, effective_from) versions left by concurrent
  saves (keeps one arbitrary-but-deterministic survivor of the near-identical
  duplicates), and marks all but the newest in-flight (`pending`/`generating`)
  `training_plans` row per user as `failed` — the same terminal state the
  startup stuck-generation sweep uses.
- **Safe to re-run:** yes, idempotent. Matches nothing once it has run.
- **How:** copy the two `DELETE`s and the `UPDATE` out of the migration file and
  run them via `psql "$DATABASE_URL"`, then re-run `drizzle-kit push` if index
  creation had failed.
- **Verify afterwards:** `pnpm ops:restore-drill` carries three 0091 probes, or:
  ```sql
  SELECT count(*) FROM (
    SELECT 1 FROM nutrition_targets GROUP BY user_id, effective_from HAVING count(*) > 1
  ) d; -- expect 0
  SELECT count(*) FROM (
    SELECT 1 FROM meal_targets GROUP BY user_id, meal_type, effective_from HAVING count(*) > 1
  ) d; -- expect 0
  SELECT count(*) FROM (
    SELECT 1 FROM training_plans WHERE generation_status IN ('pending','generating')
    GROUP BY user_id HAVING count(*) > 1
  ) d; -- expect 0
  ```
