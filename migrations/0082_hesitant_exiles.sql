ALTER TABLE "structured_exercise_backfill_reviews" DROP CONSTRAINT "structured_exercise_backfill_reviews_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "structured_exercise_backfill_reviews" ADD CONSTRAINT "structured_exercise_backfill_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Clean up the orphans the previous `set null` behaviour already created.
-- Every insert path supplies a non-null user_id (it is copied from
-- workout_logs.user_id / the plan day's owner), so a NULL user_id can only
-- mean "the owning athlete was deleted". Those rows were being returned to
-- EVERY athlete by listBackfillReviews, which matches
-- `user_id = $me OR user_id IS NULL`.
DELETE FROM "structured_exercise_backfill_reviews" WHERE "user_id" IS NULL;
