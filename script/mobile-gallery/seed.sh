#!/bin/bash
# Seeds a LOCAL web server's dev user with a few days that exercise the app's
# main screens, for mobile's LayoutGalleryTest (see mobile/README.md, "Comparing
# with the web app"): a plan in its fifth week, yesterday's session missed, two
# Strava recordings that could be it, and a short coach conversation.
#
#   script/mobile-gallery/seed.sh [server URL] [database URL]
#
# It deletes the dev user's plans and workouts first, so it refuses any
# database that isn't on this machine.
set -euo pipefail

SERVER=${1:-http://localhost:5000}
DB=${2:-postgresql://postgres:postgres@localhost:5432/postgres}
USER_ID=dev-user

case "$DB" in
  *@localhost[:/]* | *@127.0.0.1[:/]*) ;;
  *) echo "Refusing to seed $DB: only a database on localhost." >&2; exit 1 ;;
esac

JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT
TOKEN=$(curl -fsS -c "$JAR" "$SERVER/api/v1/csrf-token" | python3 -c "import json,sys;print(json.load(sys.stdin)['csrfToken'])")
call() {
  local method=$1 path=$2 body=${3:-}
  curl -fsS -b "$JAR" -c "$JAR" -H "x-csrf-token: $TOKEN" -H "content-type: application/json" -X "$method" "$SERVER$path" ${body:+-d "$body"}
}

TODAY=$(date -u +%F)
YESTERDAY=$(date -u -d "yesterday" +%F)
# The Monday four weeks before this week's: today falls in the plan's week 5.
PLAN_START=$(date -u -d "$TODAY -$(($(date -u +%u) - 1)) days -28 days" +%F)

psql -q -v ON_ERROR_STOP=1 "$DB" >/dev/null <<SQL
DELETE FROM exercise_sets
 WHERE workout_log_id IN (SELECT id FROM workout_logs WHERE user_id = '$USER_ID')
    OR plan_day_id IN (SELECT d.id FROM plan_days d JOIN training_plans p ON p.id = d.plan_id WHERE p.user_id = '$USER_ID');
DELETE FROM workout_logs WHERE user_id = '$USER_ID';
DELETE FROM plan_days WHERE plan_id IN (SELECT id FROM training_plans WHERE user_id = '$USER_ID');
DELETE FROM training_plans WHERE user_id = '$USER_ID';
SQL

# Pounds and the MAF method: the unit labels and the heart-rate chip both show.
call PATCH /api/v1/preferences '{"weightUnit":"lbs","distanceUnit":"km","onboardingCompleted":true,"age":35,"gender":"male","division":"open","trainingStyleId":"maf_method","mafAge":35,"mafCategory":"consistent_2y_plus_improving","bodyweightKg":76}' >/dev/null
PLAN=$(call POST /api/v1/plans/sample '{}' | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
call POST "/api/v1/plans/$PLAN/schedule" "{\"startDate\":\"$PLAN_START\"}" >/dev/null
DAY=$(psql -qtA "$DB" -c "SELECT id FROM plan_days WHERE plan_id = '$PLAN' AND scheduled_date = '$YESTERDAY' LIMIT 1")
if [[ -z "$DAY" ]]; then
  echo "The sample plan has no day on $YESTERDAY." >&2
  exit 1
fi

psql -q -v ON_ERROR_STOP=1 "$DB" >/dev/null <<SQL
UPDATE plan_days
   SET focus = 'Posterior Strength + Burpee',
       main_workout = 'Romanian Deadlift 3x8, Lat Pulldown 3x8, Reverse Lunge 2x10, Burpee Broad Jump 3x8',
       accessory = NULL, notes = NULL, status = 'missed'
 WHERE id = '$DAY';
DELETE FROM exercise_sets WHERE plan_day_id = '$DAY';
INSERT INTO exercise_sets (plan_day_id, exercise_name, category, set_number, reps, weight, weight_unit, sort_order)
SELECT '$DAY', e.name, 'strength', s, e.reps, e.weight, 'lbs', e.ord * 10 + s
  FROM (VALUES ('romanian_deadlift', 8, 175::real, 1, 3), ('lat_pulldown', 8, 160::real, 2, 3),
               ('reverse_lunge', 10, NULL::real, 3, 2), ('burpee_broad_jump', 8, NULL::real, 4, 3)) AS e(name, reps, weight, ord, sets),
       generate_series(1, 3) s
 WHERE s <= e.sets;

INSERT INTO workout_logs (id, user_id, date, focus, main_workout, notes, duration, source, strava_activity_id, calories,
                          distance_meters, avg_heartrate, max_heartrate, avg_speed, avg_cadence, avg_watts, suffer_score,
                          started_at, suggested_plan_day_id, suggested_link_confidence, device_activity)
VALUES ('gallery-run', '$USER_ID', '$YESTERDAY', 'Run', '3.83 km, 23m', 'Morning Run | Avg HR: 169 bpm (max 188)', 23, 'strava',
        'gallery-1001', 467, 3830, 169, 188, 2.76, 74, 338, 71, '$YESTERDAY 07:10:00+00', '$DAY', 0.5,
        '{"raw":{"name":"Morning Run","sport_type":"Run","type":"Run","moving_time":1388,"elapsed_time":1400}}'::jsonb),
       ('gallery-weights', '$USER_ID', '$YESTERDAY', 'WeightTraining', '12m session',
        'Morning Weight Training | Avg HR: 105 bpm (max 141)', 13, 'strava', 'gallery-1002', 88, NULL, 105, 141, NULL, NULL, NULL, 6,
        '$YESTERDAY 07:40:00+00', '$DAY', 0.5,
        '{"raw":{"name":"Morning Weight Training","sport_type":"WeightTraining","type":"WeightTraining","moving_time":760,"elapsed_time":780}}'::jsonb);
INSERT INTO exercise_sets (workout_log_id, exercise_name, category, set_number, distance, time, distance_unit, sort_order)
VALUES ('gallery-run', 'easy_run', 'running', 1, 3830, 23.13, 'm', 1);

UPDATE users SET ai_coach_enabled = true WHERE id = '$USER_ID';
DELETE FROM chat_messages WHERE user_id = '$USER_ID';
INSERT INTO chat_messages (user_id, role, content, timestamp) VALUES
 ('$USER_ID', 'user', 'Combine today''s two workouts into one reasonable one', now() - interval '2 hours'),
 ('$USER_ID', 'assistant',
  'I can''t combine today''s two sessions into one because the current training state blocks intensity, and the stations session includes hard intervals that would violate that. Let''s keep them separate or adjust differently if you''d like.',
  now() - interval '2 hours' + interval '1 minute');
SQL

echo "Seeded $USER_ID on $SERVER: plan $PLAN from $PLAN_START, yesterday ($YESTERDAY) missed with two recordings."
