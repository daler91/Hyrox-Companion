DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users'
      AND column_name = 'email_notifications'
      AND data_type <> 'boolean'
  ) THEN
    ALTER TABLE "users" ALTER COLUMN "email_notifications"
      SET DATA TYPE boolean
      USING CASE WHEN email_notifications = 1 THEN true ELSE false END;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email_notifications" SET DEFAULT true;
