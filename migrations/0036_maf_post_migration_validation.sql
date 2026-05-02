-- Post-migration validation + remediation for MAF artifacts.

CREATE TABLE IF NOT EXISTS "data_remediation_log" (
  "id" bigserial PRIMARY KEY,
  "run_at" timestamptz NOT NULL DEFAULT now(),
  "table_name" text NOT NULL,
  "record_id" text,
  "issue" text NOT NULL,
  "action" text NOT NULL,
  "before_data" jsonb,
  "after_data" jsonb
);
--> statement-breakpoint

-- Hard safety checks that legacy imports may violate.
ALTER TABLE "maf_profile"
  ADD CONSTRAINT "maf_profile_final_hr_positive_check"
  CHECK ("final_hr" > 0);
--> statement-breakpoint
ALTER TABLE "maf_workout_analysis"
  ADD CONSTRAINT "maf_workout_analysis_compliance_pct_range_check"
  CHECK ("compliance_pct" IS NULL OR ("compliance_pct" BETWEEN 0 AND 100));
--> statement-breakpoint

-- Validation view: rows indicate violations that should be investigated.
CREATE OR REPLACE VIEW "v_maf_post_migration_validation" AS
SELECT 'missing_fk_user_training_style' AS check_name, uts.id::text AS record_id,
       jsonb_build_object('user_id', uts.user_id) AS details
FROM user_training_style uts
LEFT JOIN users u ON u.id = uts.user_id
WHERE u.id IS NULL
UNION ALL
SELECT 'missing_fk_maf_profile_user', mp.id::text,
       jsonb_build_object('user_id', mp.user_id)
FROM maf_profile mp
LEFT JOIN users u ON u.id = mp.user_id
WHERE u.id IS NULL
UNION ALL
SELECT 'missing_fk_maf_test_results_user', mtr.id::text,
       jsonb_build_object('user_id', mtr.user_id)
FROM maf_test_results mtr
LEFT JOIN users u ON u.id = mtr.user_id
WHERE u.id IS NULL
UNION ALL
SELECT 'missing_fk_maf_workout_analysis_user', mwa.id::text,
       jsonb_build_object('user_id', mwa.user_id)
FROM maf_workout_analysis mwa
LEFT JOIN users u ON u.id = mwa.user_id
WHERE u.id IS NULL
UNION ALL
SELECT 'invalid_workout_fk', mwa.id::text,
       jsonb_build_object('workout_log_id', mwa.workout_log_id)
FROM maf_workout_analysis mwa
LEFT JOIN workout_logs wl ON wl.id = mwa.workout_log_id
WHERE mwa.workout_log_id IS NOT NULL AND wl.id IS NULL
UNION ALL
SELECT 'duplicate_effective_date_per_user', x.id::text,
       jsonb_build_object('user_id', x.user_id, 'effective_date', x.effective_date, 'rows_on_date', x.rows_on_date)
FROM (
  SELECT min(id) AS id, user_id, effective_date, count(*) AS rows_on_date
  FROM user_training_style
  GROUP BY user_id, effective_date
  HAVING count(*) > 1
) x
UNION ALL
SELECT 'multiple_active_styles_per_user', y.user_id::text,
       jsonb_build_object('active_row_ids', y.active_ids, 'active_count', y.active_count, 'today', CURRENT_DATE)
FROM (
  SELECT user_id,
         array_agg(id) FILTER (WHERE is_current_active) AS active_ids,
         count(*) FILTER (WHERE is_current_active) AS active_count
  FROM (
    SELECT uts.*,
           (uts.effective_date = max(uts.effective_date) FILTER (WHERE uts.effective_date <= CURRENT_DATE)
              OVER (PARTITION BY uts.user_id)
            AND uts.effective_date <= CURRENT_DATE) AS is_current_active
    FROM user_training_style uts
  ) ranked
  GROUP BY user_id
) y
WHERE y.active_count > 1
UNION ALL
SELECT 'future_only_style_history', z.user_id::text,
       jsonb_build_object('min_effective_date', z.min_effective_date, 'today', CURRENT_DATE)
FROM (
  SELECT user_id, min(effective_date) AS min_effective_date
  FROM user_training_style
  GROUP BY user_id
) z
WHERE z.min_effective_date > CURRENT_DATE
UNION ALL
SELECT 'impossible_strict_mode_without_final_hr', mp.id::text,
       jsonb_build_object('strict_maf', mp.strict_mode, 'final_maf_hr', mp.final_hr)
FROM maf_profile mp
WHERE mp.strict_mode = true AND (mp.final_hr IS NULL OR mp.final_hr <= 0);
--> statement-breakpoint

-- Remediation for common legacy issues with explicit audit logging.
DO $$
DECLARE
  rec record;
  kept_id varchar(255);
BEGIN
  -- Normalize nullable/blank training style fields.
  FOR rec IN
    SELECT * FROM user_training_style
    WHERE style IS NULL OR btrim(style) = '' OR effective_date IS NULL OR source IS NULL
  LOOP
    INSERT INTO data_remediation_log(table_name, record_id, issue, action, before_data)
    VALUES ('user_training_style', rec.id, 'null_or_blank_style_fields',
            'normalize style/source/effective_date', to_jsonb(rec));

    UPDATE user_training_style
    SET style = COALESCE(NULLIF(btrim(style), ''), 'balanced_default'),
        source = COALESCE(source, 'migration_default'),
        effective_date = COALESCE(effective_date, CURRENT_DATE)
    WHERE id = rec.id;

    INSERT INTO data_remediation_log(table_name, record_id, issue, action, after_data)
    SELECT 'user_training_style', rec.id, 'null_or_blank_style_fields',
           'normalized', to_jsonb(uts)
    FROM user_training_style uts WHERE uts.id = rec.id;
  END LOOP;

  -- For duplicate effective_date rows per user, keep newest and delete others.
  FOR rec IN
    SELECT user_id, effective_date
    FROM user_training_style
    GROUP BY user_id, effective_date
    HAVING count(*) > 1
  LOOP
    SELECT id INTO kept_id
    FROM user_training_style
    WHERE user_id = rec.user_id AND effective_date = rec.effective_date
    ORDER BY created_at DESC NULLS LAST, id DESC
    LIMIT 1;

    INSERT INTO data_remediation_log(table_name, record_id, issue, action, before_data)
    SELECT 'user_training_style', uts.id, 'duplicate_effective_date_per_user',
           'delete_duplicate_keep_newest', to_jsonb(uts)
    FROM user_training_style uts
    WHERE uts.user_id = rec.user_id
      AND uts.effective_date = rec.effective_date
      AND uts.id <> kept_id;

    DELETE FROM user_training_style
    WHERE user_id = rec.user_id
      AND effective_date = rec.effective_date
      AND id <> kept_id;
  END LOOP;
END $$;
