ALTER TABLE "users" ADD COLUMN "onboarding_completed" boolean DEFAULT false NOT NULL;

UPDATE "users" AS "u"
SET "onboarding_completed" = true
WHERE EXISTS (
  SELECT 1
  FROM "training_plans" AS "tp"
  WHERE "tp"."user_id" = "u"."id"
)
OR EXISTS (
  SELECT 1
  FROM "workout_logs" AS "wl"
  WHERE "wl"."user_id" = "u"."id"
);
