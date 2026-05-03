CREATE TABLE IF NOT EXISTS "structured_exercise_backfill_reviews" (
  "id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_type" text NOT NULL,
  "owner_id" varchar(255) NOT NULL,
  "user_id" varchar(255),
  "status" text NOT NULL,
  "reason" text,
  "first_seen_at" timestamp DEFAULT now(),
  "last_seen_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "structured_exercise_backfill_owner_type_check" CHECK ("owner_type" IN ('planDay', 'workoutLog')),
  CONSTRAINT "structured_exercise_backfill_status_check" CHECK ("status" IN ('needs_manual_review', 'resolved'))
);

DO $$ BEGIN
 ALTER TABLE "structured_exercise_backfill_reviews"
 ADD CONSTRAINT "structured_exercise_backfill_reviews_user_id_users_id_fk"
 FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_structured_exercise_backfill_owner_unique" ON "structured_exercise_backfill_reviews" ("owner_type","owner_id");
CREATE INDEX IF NOT EXISTS "idx_structured_exercise_backfill_status" ON "structured_exercise_backfill_reviews" ("status");
CREATE INDEX IF NOT EXISTS "idx_structured_exercise_backfill_user_id" ON "structured_exercise_backfill_reviews" ("user_id");
