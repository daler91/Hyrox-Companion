ALTER TABLE "users" ALTER COLUMN "email_notifications" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email_weekly_summary" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email_missed_reminder" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "ai_coach_enabled" SET DEFAULT false;