# Pending manual production steps

Steps that cannot apply themselves and are therefore easy to lose. A migration
comment is not a durable record: nobody reads `migrations/*.sql` on deploy day.

**Why these exist.** Production runs a push-managed schema — `drizzle-kit push`
syncs structure only, and boot-time `migrate()` no-ops against a pushed schema
(see `server/maintenance.ts`). So any migration whose *point* is a data change
(a DELETE, a backfill) never executes in production, however cleanly it applies
to a fresh database in CI.

**How to use this file.** Run the statement against production, then tick the
box and record the date and who ran it in the same PR. An unticked box is a
live task, not history.

**Verifying.** `pnpm ops:restore-drill` checks every step listed here against
whatever database you point it at, so the monthly restore drill
([backup-restore.md §6](./backup-restore.md#6-restore-drill-cadence--verification))
re-verifies them for free. Note the reverse hazard too: a restored database is
as old as its backup, so a step ticked *after* that backup was taken has been
rolled back and must be run again.

---

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
