ALTER TABLE users
  ADD COLUMN show_adherence_insights boolean DEFAULT true;

UPDATE users
SET show_adherence_insights = true
WHERE show_adherence_insights IS NULL;
