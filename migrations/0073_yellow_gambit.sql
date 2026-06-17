CREATE TABLE "meal_targets" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"meal_type" varchar(16) NOT NULL,
	"calories" real,
	"protein_g" real,
	"carb_g" real,
	"fat_g" real,
	"effective_from" date NOT NULL,
	CONSTRAINT "meal_targets_meal_type_check" CHECK (meal_type IN ('breakfast','lunch','dinner','snack','snack_pm','pre_workout','post_workout'))
);
--> statement-breakpoint
ALTER TABLE "food_log_entries" DROP CONSTRAINT "food_log_entries_meal_type_check";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "meal_schedule" integer DEFAULT 4;--> statement-breakpoint
ALTER TABLE "meal_targets" ADD CONSTRAINT "meal_targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_meal_targets_user_effective" ON "meal_targets" USING btree ("user_id","effective_from");--> statement-breakpoint
ALTER TABLE "food_log_entries" ADD CONSTRAINT "food_log_entries_meal_type_check" CHECK (meal_type IN ('breakfast','lunch','dinner','snack','snack_pm','pre_workout','post_workout'));