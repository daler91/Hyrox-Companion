# Pending manual production steps

Steps that cannot apply themselves and are therefore easy to lose. A migration
comment is not a durable record: nobody reads `migrations/*.sql` on deploy day.

**How production gets its schema.** Production applies migrations at boot.
`runDrizzleMigrations()` (`server/maintenance.ts`) runs every journal entry
newer than the newest row in `drizzle.__drizzle_migrations`, schema and data
statements alike, in one transaction, and a release whose migration fails does
not go live. This was confirmed on 2026-10-07 from a production deploy log
("Drizzle migrations applied successfully") and the ledger itself. Earlier
revisions of this file said production was managed by a hand-run
`drizzle-kit push` with an empty ledger. That was never true, so the steps
written on that premise ("apply the file before the push") are moot.

**Never run `drizzle-kit push` against production.** It drops objects the
schema does not declare (0036's `data_remediation_log` and its view, 0074's
trigram indexes) and stops on interactive rename prompts. The startup check
that refuses to boot on a missing table or column no longer suggests it.

**What still needs a hand.** Only work no migration carries: scripts (0093,
0094), hand-written SQL (C9), platform settings (Railway), and a migration the
migrator skipped. Drizzle skips any journal entry whose `when` is older than
the newest recorded one. Three historical entries are out of order (0009, 0011,
0019), and production skipped 0019 until 2026-10-07 and 0016 until 2026-10-08
(see their entries below). `server/__tests__/migrationChain.test.ts` fails CI
on a new out-of-order entry (D26), and boot now logs a skipped migration by
name.

The migration entries below (the older-migration audit, 0074, 0081, 0082, 0091,
0117, 0121 and 0122) ran at boot when their release first started. Each keeps
its verification query: run it once against production, then tick the box.

**How to use this file.** Run the statement against production, then tick the
box and record the date and who ran it in the same PR. An unticked box is a
live task, not history.

**If a verification query fails.** Every data migration named here is
idempotent, so apply its file again with
`psql -X "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f migrations/<file>.sql`.
Do not use the Post-Migration Verification workflow's `ledger: push` mode on
production: it is for a database built by `drizzle-kit push`, and production's
ledger is populated.

**Verifying.** `pnpm ops:restore-drill` probes the 0081, 0082 and 0091 steps (no
ownerless private rows, no duplicate target versions, at most one in-flight plan
generation per user) against whatever database you point it at, so the monthly
restore drill
([backup-restore.md §6](./backup-restore.md#6-restore-drill-cadence--verification))
re-verifies those for free. It does **not** check the older-migration audit, 0074,
0093, 0094, 0117, 0121, 0122 or the C9 backfill — use the verification queries in
those sections. Note the reverse hazard too: a restored database is as old as its
backup, so a step ticked _after_ that backup was taken has been rolled back and
must be run again. That applies to the scripts and hand-written steps; a
restored ledger is as old as the backup too, so the next boot re-applies any
migration newer than it.

---

## [x] Before 2026-12-01 — move Railway's deploy config off `railway.toml`

- **Config:** `.railway/railway.ts` (Railway Infrastructure as Code), replacing
  `railway.toml`; `nixpacks.toml` unchanged
- **Shipped:** identified 2026-10-03 (D4, `docs/CODEBASE_ANALYSIS_2026-10-03.md`);
  the file and the PR that deletes `railway.toml` prepared 2026-10-08
- **Deadline:** **2026-12-01, a hard cutoff.** The Railway CLI warns on every
  command: Config as Code (`railway.toml` / `railway.json`) is deprecated and
  "existing files keep working until 2026-12-01".
- **Run on production:** 2026-10-08, by the owner (CLI 5.64.0, Windows):
  `migrate --apply` from `main`, then `plan` / `apply` from the PR branch. The
  plan matched the check below; after `apply` every setting cleared except
  `restartPolicyType` (see "Verify afterwards"). PR #2125 merged the same day;
  its deploy (`b9fc66cd`) booted on the service's own settings (`startup
complete` in 1.1 s). The dashboard and `plan` checks below passed; the build
  log's install line was not checked.
- **What `railway config migrate` got wrong:** its generated file kept the
  build and start commands, the healthcheck path and the 120 s timeout, but
  dropped three settings: the builder (left as a comment, so the service would
  move to Railway's default builder, which ignores `nixpacks.toml` and its
  `--ignore-scripts` install), `drainingSeconds = 65` (D3; Railway's default is
  0 s) and the `on_failure` restart policy with 3 retries. `.railway/railway.ts`
  in the repo is that file with the three restored, checked against the
  `railway` SDK's own types. Do not keep the file `migrate` writes.
- **How it went, and how to repeat it** (for another environment or service):

  ```powershell
  # 1. From main: link the app service, not Postgres
  git checkout main; git pull
  railway link                        # FitAi Coach > production > Hyrox-Companion
  railway status                      # must name Hyrox-Companion
  # 2. Writes a generated .railway/railway.ts and offers the "cutover"; discard
  #    the file, the reviewed one is on the PR branch
  railway config migrate --apply
  Remove-Item -Recurse .railway
  # 3. The reviewed file, with the SDK it needs to evaluate
  git checkout <PR branch>
  pnpm install --frozen-lockfile
  railway config plan
  railway config apply                # only if the plan passes the check below
  ```

  - **CLI version:** `railway config` needs a recent CLI, and `railway@3.13.1`
    refuses to evaluate the file under a CLI older than 5.42.1.
  - **Windows:** that version check runs `process.env._ || "railway"` through
    Node, which cannot start the npm `railway.cmd` / `railway.ps1` shims, so it
    reports the CLI as too old even when it is not. Point `_` at the real
    binary for the session first:
    `$env:_ = "$env:APPDATA\npm\node_modules\@railway\cli\bin\railway.exe"`
    (quoted, or PowerShell runs it and stores its help text).
  - **The cutover did not switch the deploy source.** `migrate --apply` asked
    to "switch them off now" (and warned it redeploys), then reported "Nothing
    to do". Afterwards the dashboard still labelled every deploy setting "The
    value is set in /railway.toml": Railway reads a `railway.toml` at the root
    of the deployed commit regardless. `apply` filled in the service's own
    settings (the plan showed each going from `null`), and those take over on
    the first deploy of a commit without `railway.toml`, which is this PR's
    merge. Running on `railway.toml` until then is safe: its values are the
    same ones.

  Apply only if the plan touches nothing beyond these settings on
  `Hyrox-Companion`: builder `NIXPACKS`, build command
  `pnpm install --frozen-lockfile --ignore-scripts && pnpm run build`, start
  command `node script/start.js`, healthcheck path `/api/v1/health`,
  healthcheck timeout 120, draining 65 s, restart policy `ON_FAILURE` with 3
  retries. Every variable is `preserve()`, so none should change. If it shows
  anything else (another service, a variable change or removal, a domain, a
  deletion), stop and do not apply.

- **From then on:** an edit to `.railway/railway.ts` changes nothing until
  someone runs `plan` and `apply` again, or the repo adopts Railway's
  `railwayapp/config` GitHub Action (plan comment on a PR that touches
  `.railway/**`, apply on merge; it needs a project token in the
  `RAILWAY_TOKEN` secret). The `Railway deploy config` tests in
  `server/bootstrap/startup.test.ts` evaluate the file with the SDK and pin the
  healthcheck path (D2), the draining time and restart policy (D3), and the
  nixpacks builder plus `--ignore-scripts` (S4).

  `nixpacks.toml` is read by the nixpacks builder itself, so its install-phase
  override keeps working only while the builder is `NIXPACKS`. That override's
  `--ignore-scripts` is also what keeps Cypress's ~250 MB binary download out
  of the build: the build command runs only after the install phase, so a
  variable or flag set there (the old `CYPRESS_INSTALL_BINARY=0`) came too late
  (D27). Whatever replaces the install phase must skip install scripts itself.

- **Builder:** the Railway docs say Nixpacks "has been replaced by Railpack".
  If the builder ever moves to Railpack, validate it on a staging service
  first: Node 22 and pnpm 9.12 resolution, an install that still passes
  `--ignore-scripts` (`nixpacks.toml`'s override does not apply there), and a
  boot that passes the `/api/v1/health` healthcheck.
- **Verified 2026-10-08** (after the merge deploy):
  - The dashboard's deploy settings no longer say "set in /railway.toml" and
    show builder nixpacks, the `--ignore-scripts` build command, healthcheck
    `/api/v1/health` (120 s), draining 65 s, restart On Failure with 3 retries.
  - The build log shows the install without lifecycle scripts; the deploy log
    shows the healthcheck polling `/api/v1/health`, then `startup complete`.
  - `railway config plan` shows no change. After `apply`, and again after the
    merge with the dashboard showing On Failure, it still listed
    `restartPolicyType (null → "ON_FAILURE")`: Railway stores its default
    policy as `null`. The file now leaves `restartPolicyType` unset (the test
    accepts unset or `ON_FAILURE` and pins the 3 retries), so the plan comes
    back clean.

---

## [x] 0019 — `idempotency_keys`, skipped by the migrator

- **Run on production:** 2026-10-07, by the owner, with `psql -X -f` (fix file
  below). Output checked: table present, 8 columns, primary key, foreign key,
  index and ledger row each 1.
- **Migration:** `migrations/0019_add_idempotency_keys.sql`
- **What happened:** 0019's journal `when` (1775428793648, 2026-04-05 22:39 UTC)
  is older than 0018's (2026-04-06 16:00 UTC). Once 0018 was in the ledger,
  `migrate()` compared 0019 against the newest recorded row, took it as already
  applied and never ran it, so production had no `idempotency_keys` table. The
  idempotency middleware tolerated that by skipping. #2108 added the startup
  check `assertSchemaColumnsExist`, which refuses to serve without the table,
  so every deploy from #2108 to #2117 failed its readiness healthcheck and #2106
  stayed live. Those deploys did apply 0120 to 0122 first: migrations commit
  before the check runs.
- **The fix:** one transaction that does what 0019 does, written to be
  re-runnable (`CREATE TABLE IF NOT EXISTS`, the foreign key added only if
  missing, `CREATE INDEX IF NOT EXISTS`, `lock_timeout` 5s), then records 0019
  in the ledger with the hash drizzle computes for the file:

  ```sql
  INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
  SELECT '1801767c302fba2f1661546b6d66097255be5f20480c047393ee44a0decaa47b', 1775428793648
  WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = 1775428793648);
  ```

  Boot reads only the newest ledger row, so that row changes nothing it runs;
  it keeps the ledger a complete record.

- **Since then:** `server/__tests__/migrationChain.test.ts` already failed CI
  when a new journal entry is older than the one before it (D26; 0009, 0011
  and 0019 are allowlisted), and now also on a future-dated entry or a file
  missing from the journal. Boot logs any journal entry missing from the ledger and
  older than its newest row, naming it in the startup check's error.
- **Verify:**

  ```sql
  SELECT to_regclass('public.idempotency_keys') IS NOT NULL AS table_exists,
         (SELECT count(*) FROM drizzle.__drizzle_migrations
            WHERE created_at = 1775428793648) AS ledger_row;
  -- expect t, 1
  ```

---

## [x] 0016 — `hyrox_station` renamed to `functional`, skipped by the migrator

- **Run on production:** 2026-10-08, by the owner, as one statement (fix
  below). Output checked: 56 `exercise_sets` rows updated, 0
  `custom_exercises` rows, 1 ledger row; afterwards no rows left on
  `hyrox_station` and the ledger row present.
- **Migration:** `migrations/0016_rename_hyrox_station_to_functional.sql`
  (data only: two `UPDATE`s, no schema change).
- **How it was found:** the boot warning added in #2123. Its first production
  boot logged `skipped: ["0016_rename_hyrox_station_to_functional"]`. The
  startup check still passed: it looks only for missing tables and columns.
- **What happened:** 0016's `when` (1775334000000, 2026-04-04 20:20 UTC) is in
  order in the journal, so it is not one of the out-of-order entries. A
  migration with a later `when` was already in production's ledger when 0016
  shipped, so `migrate()` took 0016 as applied. Nothing reads or writes
  `hyrox_station` since the rename, so those 56 sets showed under their own
  unknown category in analytics instead of under functional work.
- **The fix:** the migration's two `UPDATE`s plus the ledger row, as a single
  statement that ends in a `SELECT`. The query tool used appends `LIMIT` to
  each statement, which breaks `BEGIN`, `UPDATE` and `COMMIT`; one statement is
  also one transaction. Re-runnable:

  ```sql
  WITH sets_fixed AS (
    UPDATE exercise_sets SET category = 'functional'
    WHERE category = 'hyrox_station' RETURNING 1
  ), custom_fixed AS (
    UPDATE custom_exercises SET category = 'functional'
    WHERE category = 'hyrox_station' RETURNING 1
  ), ledger AS (
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
    SELECT '4d8053c1ad16fdc89b16f0b1808145235cbed05467793f0ff25925bb56b73864', 1775334000000
    WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = 1775334000000)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM sets_fixed)   AS sets_updated,
         (SELECT count(*) FROM custom_fixed) AS custom_updated,
         (SELECT count(*) FROM ledger)       AS ledger_rows_added;
  ```

  Cached analytics pick up the merged category at the nightly recompute.

- **Verify:**

  ```sql
  SELECT (SELECT count(*) FROM exercise_sets WHERE category = 'hyrox_station') AS remaining,
         (SELECT count(*) FROM drizzle.__drizzle_migrations
            WHERE created_at = 1775334000000) AS ledger_row;
  -- expect 0, 1
  ```

  The next boot logs no `Migrations missing from the ledger` warning.

---

## [ ] Audit — ten older data-bearing migrations (verify once)

- **Shipped:** identified 2026-09-04 during the mapper-concern verification
  pass (`docs/MAPPER_CONCERNS_VERIFIED_2026-09-04.md`).
- **Run on production:** _not yet — date / operator:_
- **Status:** these ran at boot with the rest of the chain (see the top of
  this file); none of them is one of the three out-of-order journal entries.
  The audit was written when production was wrongly believed to be
  push-managed. What remains is a one-time check of the two queries below,
  then tick it.

| Migration                                    | Data operation                                                                                        | Consequence if it never ran                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0016_rename_hyrox_station_to_functional`    | `UPDATE` category `hyrox_station` → `functional`                                                      | Low. The old string appears nowhere in `shared/`, `server/` or `client/`, so stale rows are inert.                                                                                                                                                                                                                                                                                                    |
| `0018_backfill_plan_dates_and_workout_links` | 4 backfills: null stale `plan_day_id`, `training_plans.start_date`/`end_date`, `workout_logs.plan_id` | Plans missing start/end dates; workout↔plan links unset on old rows.                                                                                                                                                                                                                                                                                                                                  |
| `0029_workout_prescription_snapshot`         | Backfill `prescribed_main_workout`/`accessory`/`notes`                                                | Pre-0029 workouts have no prescription snapshot, so adherence reads against a mutable text field.                                                                                                                                                                                                                                                                                                     |
| `0031_user_adherence_visibility_pref`        | `UPDATE users`                                                                                        | Preference default not applied to pre-existing users.                                                                                                                                                                                                                                                                                                                                                 |
| `0032_unusual_rogue`                         | `UPDATE exercise_sets`                                                                                | See the migration body before ticking.                                                                                                                                                                                                                                                                                                                                                                |
| `0035_maf_artifacts`                         | `INSERT INTO user_training_style … 'migration_default'` per existing user                             | Users predating 0035 have no training-style row.                                                                                                                                                                                                                                                                                                                                                      |
| `0036_maf_post_migration_validation`         | Creates `data_remediation_log` + `v_maf_post_migration_validation`, plus remediation DML              | **Neither object is in the Drizzle schema**, so `drizzle-kit push` would drop them. They exist wherever `migrate()` ran 0036, production included.                                                                                                                                                                                                                                                    |
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
  -- expect both non-NULL (created by 0036 at boot)
  ```

## [ ] 0074 — `pg_trgm` extension and the trigram indexes for fuzzy food search

- **Migration:** `migrations/0074_food_search_trigram.sql`
- **Shipped:** PR #1851 (2026-08-26)
- **Run on production:** _ran at boot; verify once — date / operator:_
- **Status:** the migration ran at boot. The two GIN indexes are deliberately
  not declared in `shared/schema/tables.ts`, so a `drizzle-kit push` would
  drop them, which is one more reason never to push to production. Identified
  as PF3 (`docs/CODEBASE_ANALYSIS_2026-10-03.md`).
- **What it does:** enables `pg_trgm` and creates `idx_foods_name_trgm` and
  `idx_foods_brand_trgm`. `NUTRITION_FUZZY_ENABLED` defaults to `true`, so
  `searchLocalFoods` emits `similarity()` and the `%` operator. Without the
  extension every local food search (and the meal parser's local lookup) fails
  with `function similarity(text, unknown) does not exist`; without the indexes
  the `%` predicate scans the whole shared `foods` cache.
- **Safe to re-run:** yes. Every statement is `IF NOT EXISTS`.
- **How:** check first (verification query below). If anything is missing, run
  all three statements from the migration file via `psql "$DATABASE_URL"`.
  `pg_trgm` is a trusted extension (PostgreSQL 13+), so the database owner can
  create it. Until the extension exists, `NUTRITION_FUZZY_ENABLED=false` is the
  kill switch that keeps food search working without it.
- **Verify afterwards:**
  ```sql
  SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';
  -- expect 1 row
  SELECT indexname FROM pg_indexes
  WHERE tablename = 'foods' AND indexname IN ('idx_foods_name_trgm', 'idx_foods_brand_trgm');
  -- expect 2 rows
  ```

## [ ] 0081 — purge orphaned private custom foods

- **Migration:** `migrations/0081_purge_orphaned_private_custom_foods.sql`
- **Shipped:** PR #1663 (2026-07-19)
- **Run on production:** _not yet — date / operator:_
- **Status:** the `DELETE` ran at boot with the migration. Verify once.
- **What it does:** erases custom foods stranded ownerless by accounts deleted
  before the two-phase erasure existed. They are already invisible to users
  (`visibleTo` no longer treats a NULL owner as shared), so this removes the
  at-rest personal data — free-text food names and brands — rather than closing
  an active exposure.
- **Safe to re-run:** yes, idempotent. Matches nothing once it has run.
- **If the check fails:** apply the file again (see "If a verification query
  fails" above).
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
- **Status:** both halves ran at boot with the migration. Verify once.
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
- **Status:** the remediation and the three unique indexes ran together at
  boot, in that order, in one transaction. Verify once.
- **What it does:** removes duplicate `nutrition_targets` (user, effective_from)
  and `meal_targets` (user, meal, effective_from) versions left by concurrent
  saves (keeps one arbitrary-but-deterministic survivor of the near-identical
  duplicates), and marks all but the newest in-flight (`pending`/`generating`)
  `training_plans` row per user as `failed` — the same terminal state the
  startup stuck-generation sweep uses.
- **Safe to re-run:** yes, idempotent. Matches nothing once it has run.
- **If the check fails:** apply the file again (see "If a verification query
  fails" above).
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

## [ ] 0093 — backfill exercise sets for standalone device imports

- **Script:** `script/backfill-device-activity-sets.ts`
- **Shipped:** 2026-09-12 (alongside migration `0093_device_activity_links.sql`)
- **Run on production:** _not yet — date / operator:_
- **Why manual:** it is a script, not a migration — nothing runs it on deploy.
  The sync now writes the set at import time
  (`server/services/deviceActivitySets.ts`); only the history imported before
  that needs a hand.
- **What it does:** gives standalone device imports the `exercise_sets` row they
  never got. Without it the set-derived half of Analytics — training-distribution
  pie, movement-pattern coverage, muscle heat map, personal records, progression
  charts — ignores every pre-existing device import while the overview cards
  count them all.
- **Safe to re-run:** yes. It only touches standalone imports
  (`device_link_source IS NULL`) with no sets at all, so the anti-join makes a
  second run a no-op; linked and plan-day logs are never touched, and sports the
  recording doesn't describe as a set (`WeightTraining`, `Workout`) are skipped
  rather than invented. Each athlete's rows are stamped with that athlete's own
  units.
- **How:**
  ```bash
  pnpm tsx script/backfill-device-activity-sets.ts            # dry run (default)
  pnpm tsx script/backfill-device-activity-sets.ts --apply    # write
  ```
  `--user-id <id>` restricts to one athlete; `--quiet` prints the summary only.

## [ ] 0094 — backfill `counts_as_training` for non-training device imports

- **Script:** `script/backfill-counts-as-training.ts`
- **Shipped:** 2026-09-12 (alongside migration `0094_counts_as_training.sql`)
- **Run on production:** _not yet — date / operator:_
- **Why manual:** the migration added the column with `DEFAULT true`, so it is
  the column default — not a DML statement — that left the history wrong.
  Nothing reclassifies the existing rows.
- **What it does:** applies the sport-type rule new imports are stamped with
  (`shared/deviceSportTypes.ts`) to the history, so every dog walk, commute and
  yoga class a watch ever synced stops counting toward Total Workouts,
  Avg / Week, the streak and the training mix.
- **Expect the numbers to move.** Total Workouts and Avg / Week fall, Avg
  Duration rises. That is the point, but it reads as a regression if nobody is
  expecting it — say so before running.
- **What it leaves alone (D5, `docs/CODEBASE_ANALYSIS_2026-10-03.md`):**
  anything the athlete owns. It only demotes standalone imports the sync
  created and nobody adopted — `source` still `strava`/`garmin`, no plan day,
  no device link — and only those imported before sync-time stamping shipped
  (2026-09-12; a later import still counting is the athlete's own switch). A
  manual log a recording was linked to, a plan day's log and an import moved
  onto a plan day are never touched.
- **Reversible:** `--apply` writes every id it is about to flip to
  `counts-as-training-backfill-<timestamp>.json` in the working directory
  **before** it updates anything, and prints the undo command. Keep that file
  with the ticket. `--revert <file> --apply` switches exactly those rows back on
  (only the ones still off). Nothing records an athlete's toggle, so an older
  import they switched off and back on cannot be told apart — the record is
  the remedy if one is reported.
- **Safe to re-run:** yes. It only touches rows with a provider sport to read
  and only those still at the migration's default, so a second run finds
  nothing. Nothing is ever flipped back **on** by the backfill itself.
- **How:**
  ```bash
  pnpm tsx script/backfill-counts-as-training.ts                          # dry run (default)
  pnpm tsx script/backfill-counts-as-training.ts --apply                  # write + record
  pnpm tsx script/backfill-counts-as-training.ts --revert <file> --apply  # undo a run
  ```
- **Verify afterwards:**
  ```sql
  SELECT counts_as_training, count(*) FROM workout_logs GROUP BY 1;
  -- expect a non-zero `false` bucket once walks/commutes/yoga are reclassified
  ```

## [ ] 0117 — put plan days moved before 2026-10-02 back in their week and weekday

- **Migration:** `migrations/0117_plan_day_slot_repair.sql`
- **Shipped:** 2026-10-02 (commit `f6ec1d6`)
- **Run on production:** _not yet — date / operator:_
- **Status:** the `UPDATE` ran at boot with the migration. Identified as D1
  (`docs/CODEBASE_ANALYSIS_2026-10-03.md`). Verify once.
- **What it does:** a move used to change a plan day's date alone. This
  recomputes `week_number` and `day_name` from the date (week 1's Monday and the
  plan's first week number, as `planSlotFor` does) for every scheduled day in a
  scheduled plan that is out of step. Until it runs, a session moved before the
  fix keeps its old week and weekday: the timeline shows "Week 8" among week-7
  days, the workout engine reads the wrong phase (race week versus build), and
  rescheduling the plan, which recomputes dates from week and weekday, snaps
  those moves back to their old days.
- **Safe to re-run:** yes. It writes only days out of step with the computed
  slot, and a weekday that differs only in case is left alone.
- **If the check fails:** apply the file again (see "If a verification query
  fails" above).
- **Verify afterwards:**
  ```sql
  SELECT count(*)
  FROM plan_days d
  JOIN training_plans tp ON tp.id = d.plan_id
  JOIN (
    SELECT plan_id, min(week_number) AS week_number FROM plan_days GROUP BY plan_id
  ) first_week ON first_week.plan_id = d.plan_id
  CROSS JOIN LATERAL (
    SELECT tp.start_date - (extract(isodow FROM tp.start_date)::int - 1) AS monday
  ) week_one
  WHERE d.scheduled_date IS NOT NULL
    AND tp.start_date IS NOT NULL
    AND (d.week_number <> first_week.week_number + greatest(0, (d.scheduled_date - week_one.monday) / 7)
         OR lower(d.day_name) <> lower(to_char(d.scheduled_date, 'FMDay')));
  -- expect 0
  ```

## [ ] 0121 — one pending plan proposal per athlete, and the MAF CHECKs

- **Migration:** `migrations/0121_pending_proposal_unique_and_constraint_parity.sql`
- **Shipped:** 2026-10-05 (D51 and D25, `docs/CODEBASE_ANALYSIS_2026-10-03.md`)
- **Run on production:** _not yet — date / operator:_
- **Status:** ran at boot on 2026-10-06, during one of the deploys that then
  failed the startup check for the unrelated 0019 gap: migrations commit before
  that check runs. Verify once.
- **What it does:** marks every pending plan-adjustment proposal but each
  athlete's newest `superseded` (the status a new proposal gives its
  predecessor), creates the unique index, and adds 0036's two CHECKs
  (`maf_profile.final_hr > 0`, `maf_workout_analysis.compliance_pct` 0-100),
  and drops 0041's two `exercise_sets` structure FKs where they exist.
- **Safe to re-run:** yes. Every statement is idempotent.
- **Verify afterwards:**
  ```sql
  SELECT count(*) FROM (
    SELECT 1 FROM plan_adjustment_proposals WHERE status = 'pending'
    GROUP BY user_id HAVING count(*) > 1
  ) d; -- expect 0
  SELECT count(*) FROM maf_profile WHERE NOT (final_hr > 0); -- expect 0
  SELECT count(*) FROM maf_workout_analysis
  WHERE compliance_pct IS NOT NULL AND compliance_pct NOT BETWEEN 0 AND 100; -- expect 0
  SELECT indexname FROM pg_indexes
  WHERE indexname = 'uq_plan_adjustment_proposals_user_pending'; -- expect 1 row
  SELECT conname FROM pg_constraint
  WHERE conname IN ('maf_profile_final_hr_positive_check',
                    'maf_workout_analysis_compliance_pct_range_check'); -- expect 2 rows
  ```

## [ ] 0122 — one copy of each shared food serving, and six lookup/FK indexes

- **Migration:** `migrations/0122_food_servings_unique_and_fk_indexes.sql`
- **Shipped:** 2026-10-06 (PF11, PF16, PF17 and PF18,
  `docs/CODEBASE_ANALYSIS_2026-10-03.md`)
- **Run on production:** _not yet — date / operator:_
- **Status:** ran at boot on 2026-10-06, like 0121. Verify once.
- **What it does:** deletes every shared serving (`created_by_user_id IS NULL`)
  that repeats another's `(food_id, label, grams)`, keeping the lowest id. The
  copies are identical and nothing references a serving row (log entries store
  grams), so no athlete loses anything. Then it creates `uq_food_servings_shared`
  and six plain indexes: `chat_messages.proposal_id` (partial),
  `plan_adjustment_proposals.plan_id`, `plan_day_moves.plan_day_id`,
  `food_favorites.food_id`, `strava_connections.strava_athlete_id` and
  `users.user_timezone`.
- **Safe to re-run:** yes. The `DELETE` matches nothing once it has run, and
  every index is `IF NOT EXISTS`.
- **Verify afterwards:**
  ```sql
  SELECT count(*) FROM (
    SELECT 1 FROM food_servings WHERE created_by_user_id IS NULL
    GROUP BY food_id, label, grams HAVING count(*) > 1
  ) d; -- expect 0
  SELECT count(*) FROM pg_indexes
  WHERE indexname IN ('uq_food_servings_shared', 'idx_chat_messages_proposal_id',
                      'idx_plan_adjustment_proposals_plan_id', 'idx_plan_day_moves_plan_day_id',
                      'idx_food_favorites_food_id', 'idx_strava_connections_strava_athlete_id',
                      'idx_users_user_timezone'); -- expect 7
  ```

## [ ] C9 — double the Strava run cadence stored at its one-leg value (**needs review before running**)

- **Script:** none; the SQL below. **Not reviewed and not run.** Have a second
  person check it against the current `stravaMapper.ts` and
  `deviceActivityLink.ts`, and take a backup of `workout_logs`, before running it.
- **Shipped:** the mapper fix, commit `0f868e4` (2026-10-04). C9 in
  `docs/CODEBASE_ANALYSIS_2026-10-03.md`.
- **Run on production:** _not yet — date / operator:_
- **Why manual:** the mapper now doubles Strava's run `average_cadence` (Strava
  reports one leg, so a 172 steps/min run read 86) for new imports only. Runs
  imported before it still hold the one-leg value, and no migration touches them.
- **What it does:** doubles `avg_cadence` only where the stored activity
  snapshot proves the row came from a Strava run and still holds the raw
  one-leg value.
- **Safe to re-run:** yes. A doubled row no longer equals its raw value, so a
  second run matches nothing.
- **How:** check the count first (verification query), then:
  ```sql
  UPDATE workout_logs
  SET avg_cadence = (device_activity->'raw'->>'average_cadence')::real * 2
  WHERE device_activity->>'provider' = 'strava'
    AND (device_activity->'raw'->>'average_cadence') IS NOT NULL
    AND avg_cadence = (device_activity->'raw'->>'average_cadence')::real
    AND lower(regexp_replace(
          coalesce(nullif(device_activity->'raw'->>'sport_type', ''), device_activity->'raw'->>'type'),
          '[^A-Za-z0-9]', '', 'g'
        )) IN ('run', 'trailrun', 'virtualrun');
  ```
- **Caveats:**
  - Strava rows with no snapshot (`device_activity IS NULL AND source = 'strava'`)
    hold the one-leg value too, and the statement above leaves them alone. To
    backfill them as well (for example
    `... WHERE device_activity IS NULL AND source = 'strava' AND lower(regexp_replace(focus, '[^A-Za-z0-9]', '', 'g')) IN ('run', 'trailrun', 'virtualrun')`),
    `legacyRawFromLog` in `server/services/deviceActivityLink.ts` must halve run
    cadence in the same change. Otherwise releasing such a row re-maps it and
    doubles it a second time.
  - Product decision still open: Strava's Walk/Hike `average_cadence` is very
    likely one-leg as well, but it is stored as-is and labelled spm. Decide
    whether walk and hike cadence should be doubled too before widening the
    statement.
  - Garmin is unaffected: its mapper stores only
    `averageRunningCadenceInStepsPerMinute` (full steps per minute) and never
    maps ride cadence (`averageBikingCadenceInRevPerMinute`).
- **Verify afterwards:** the same predicate as the `UPDATE`, counted:
  ```sql
  SELECT count(*) FROM workout_logs
  WHERE device_activity->>'provider' = 'strava'
    AND (device_activity->'raw'->>'average_cadence') IS NOT NULL
    AND avg_cadence = (device_activity->'raw'->>'average_cadence')::real
    AND lower(regexp_replace(
          coalesce(nullif(device_activity->'raw'->>'sport_type', ''), device_activity->'raw'->>'type'),
          '[^A-Za-z0-9]', '', 'g'
        )) IN ('run', 'trailrun', 'virtualrun');
  -- before: the rows to be fixed; after: expect 0 (bar runs whose raw cadence is 0)
  ```
