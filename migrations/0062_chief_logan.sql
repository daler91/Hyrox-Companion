CREATE TABLE "food_favorites" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"food_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_log_entries" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"food_id" varchar(255) NOT NULL,
	"logged_at" timestamp with time zone NOT NULL,
	"log_date" date NOT NULL,
	"quantity_g" real NOT NULL,
	"meal_type" varchar(16) NOT NULL,
	"entry_method" varchar(16) DEFAULT 'manual' NOT NULL,
	"raw_input" text,
	"parse_confidence" real,
	"pending_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_log_entries_quantity_positive_check" CHECK (quantity_g > 0),
	CONSTRAINT "food_log_entries_meal_type_check" CHECK (meal_type IN ('breakfast','lunch','dinner','snack','pre_workout','post_workout')),
	CONSTRAINT "food_log_entries_entry_method_check" CHECK (entry_method IN ('manual','barcode','nl','photo'))
);
--> statement-breakpoint
CREATE TABLE "food_servings" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"food_id" varchar(255) NOT NULL,
	"label" text NOT NULL,
	"grams" real NOT NULL,
	CONSTRAINT "food_servings_grams_positive_check" CHECK (grams > 0)
);
--> statement-breakpoint
CREATE TABLE "foods" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(16) NOT NULL,
	"source_id" varchar(255),
	"name" text NOT NULL,
	"brand" text,
	"serving_size_g" real,
	"calories_per_100g" real,
	"protein_per_100g" real,
	"carb_per_100g" real,
	"fat_per_100g" real,
	"fiber_per_100g" real,
	"micros" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "foods_source_check" CHECK (source IN ('usda', 'off', 'custom'))
);
--> statement-breakpoint
CREATE TABLE "nutrition_targets" (
	"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"calories" real,
	"protein_g" real,
	"carb_g" real,
	"fat_g" real,
	"effective_from" date NOT NULL
);
--> statement-breakpoint
ALTER TABLE "food_favorites" ADD CONSTRAINT "food_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_favorites" ADD CONSTRAINT "food_favorites_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_log_entries" ADD CONSTRAINT "food_log_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_log_entries" ADD CONSTRAINT "food_log_entries_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_servings" ADD CONSTRAINT "food_servings_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_targets" ADD CONSTRAINT "nutrition_targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_food_favorites_user_food" ON "food_favorites" USING btree ("user_id","food_id");--> statement-breakpoint
CREATE INDEX "idx_food_favorites_user_id" ON "food_favorites" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_food_log_entries_user_log_date" ON "food_log_entries" USING btree ("user_id","log_date");--> statement-breakpoint
CREATE INDEX "idx_food_log_entries_user_logged_at" ON "food_log_entries" USING btree ("user_id","logged_at");--> statement-breakpoint
CREATE INDEX "idx_food_log_entries_food_id" ON "food_log_entries" USING btree ("food_id");--> statement-breakpoint
CREATE INDEX "idx_food_servings_food_id" ON "food_servings" USING btree ("food_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_foods_source_source_id" ON "foods" USING btree ("source","source_id") WHERE "foods"."source_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_foods_name_lower" ON "foods" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "idx_nutrition_targets_user_effective" ON "nutrition_targets" USING btree ("user_id","effective_from");