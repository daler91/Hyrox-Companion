ALTER TABLE "users" ADD COLUMN "email_weekly_review_reminder" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_today_session" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_analysis_digest" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_hour" integer DEFAULT 7;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_weekly_review_reminder_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_today_session_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_analysis_digest_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_notify_hour_check" CHECK (notify_hour IS NULL OR (notify_hour BETWEEN 0 AND 23));