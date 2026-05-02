ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "training_style_id" text DEFAULT 'balanced_default';
