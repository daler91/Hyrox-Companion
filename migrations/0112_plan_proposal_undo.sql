ALTER TABLE "plan_adjustment_proposals" DROP CONSTRAINT "plan_adjustment_proposals_status_check";--> statement-breakpoint
ALTER TABLE "plan_adjustment_proposals" ADD COLUMN "apply_undo" jsonb;--> statement-breakpoint
ALTER TABLE "plan_adjustment_proposals" ADD COLUMN "reverted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plan_adjustment_proposals" ADD CONSTRAINT "plan_adjustment_proposals_status_check" CHECK (status IN ('pending','applied','dismissed','superseded','invalidated','reverted'));