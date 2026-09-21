ALTER TABLE "users" ADD COLUMN "notify_hour_weekly_summary" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_hour_missed_reminder" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_hour_weekly_review_reminder" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_hour_today_session" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_hour_analysis_digest" integer;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_notify_hour_weekly_summary_check" CHECK (notify_hour_weekly_summary IS NULL OR (notify_hour_weekly_summary BETWEEN 0 AND 23));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_notify_hour_missed_reminder_check" CHECK (notify_hour_missed_reminder IS NULL OR (notify_hour_missed_reminder BETWEEN 0 AND 23));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_notify_hour_weekly_review_reminder_check" CHECK (notify_hour_weekly_review_reminder IS NULL OR (notify_hour_weekly_review_reminder BETWEEN 0 AND 23));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_notify_hour_today_session_check" CHECK (notify_hour_today_session IS NULL OR (notify_hour_today_session BETWEEN 0 AND 23));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_notify_hour_analysis_digest_check" CHECK (notify_hour_analysis_digest IS NULL OR (notify_hour_analysis_digest BETWEEN 0 AND 23));