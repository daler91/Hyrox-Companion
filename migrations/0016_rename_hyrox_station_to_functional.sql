-- Rename hyrox_station category to functional across all tables
UPDATE "exercise_sets" SET "category" = 'functional' WHERE "category" = 'hyrox_station';
--> statement-breakpoint
UPDATE "custom_exercises" SET "category" = 'functional' WHERE "category" = 'hyrox_station';
