-- D51 (CODEBASE_ANALYSIS_2026-10-03): "at most one pending plan-adjustment
-- proposal per athlete" was held only by PlanProposalStorage.create's
-- supersede-then-insert. Two coach turns at once both pass it (each UPDATE is
-- blind to the other's uncommitted insert), which left two proposals pending
-- and GET /plan-proposals/pending returning either one. Before the unique
-- index can be created, every pending proposal but each athlete's newest
-- (created_at, ties broken by id) is marked superseded, the status create()
-- gives a predecessor. On a database with no duplicates this matches 0 rows.
--
-- Every statement in this file can run again, so push-managed production can
-- apply it whole, before or after `drizzle-kit push`
-- (docs/operations/pending-manual-steps.md).
UPDATE "plan_adjustment_proposals" p
SET status = 'superseded',
    resolved_at = now()
WHERE p.status = 'pending'
  AND EXISTS (
    SELECT 1 FROM "plan_adjustment_proposals" newer
    WHERE newer.user_id = p.user_id
      AND newer.status = 'pending'
      AND (newer.created_at > p.created_at
        OR (newer.created_at = p.created_at AND newer.id > p.id))
  );--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_plan_adjustment_proposals_user_pending" ON "plan_adjustment_proposals" USING btree ("user_id") WHERE status = 'pending';--> statement-breakpoint
-- D25: four constraints existed only in migration SQL, so a database built by
-- migrate() (development, CI's fresh-db-migrate job) enforced them and
-- push-built production did not. Both build paths now agree.
--
-- 0041's two exercise_sets foreign keys go, which is production's shape and
-- the one the code is written for. replaceStructureForOwner deletes an
-- owner's structure blocks and inserts them again under the same ids, keeping
-- each set's block_id/step_number and clearing only the links whose step is
-- gone (clearStaleStructureSetLinks). The FKs' ON DELETE SET NULL fired on
-- that delete instead: block_id's nulls block_id alone, so a block edit on a
-- log with linked sets failed exercise_set_block_step_pair_check (or, in the
-- other trigger order, unlinked every set). The composite FK also rejected a
-- relink to a step the same edit adds, since applyStructureSetRelinks runs
-- before the new steps are inserted.
ALTER TABLE "exercise_sets" DROP CONSTRAINT IF EXISTS "exercise_sets_block_step_fk";--> statement-breakpoint
ALTER TABLE "exercise_sets" DROP CONSTRAINT IF EXISTS "exercise_sets_block_id_workout_structure_blocks_id_fk";--> statement-breakpoint
-- 0036's two MAF CHECKs stay, now declared in shared/schema so push adds them
-- to production too. Nothing the app writes breaks them: the ceiling is at
-- least 71 for the ages the schema accepts, and computeMafCompliance clamps
-- the percentage to 0-100. A migrate()-built database already has both from
-- 0036, hence the DROP before each ADD.
ALTER TABLE "maf_profile" DROP CONSTRAINT IF EXISTS "maf_profile_final_hr_positive_check";--> statement-breakpoint
ALTER TABLE "maf_profile" ADD CONSTRAINT "maf_profile_final_hr_positive_check" CHECK (final_hr > 0);--> statement-breakpoint
ALTER TABLE "maf_workout_analysis" DROP CONSTRAINT IF EXISTS "maf_workout_analysis_compliance_pct_range_check";--> statement-breakpoint
ALTER TABLE "maf_workout_analysis" ADD CONSTRAINT "maf_workout_analysis_compliance_pct_range_check" CHECK (compliance_pct IS NULL OR (compliance_pct BETWEEN 0 AND 100));
