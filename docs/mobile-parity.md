# Android app: catching up with the web

Written 2026-11-09 from two inventories:
- the web client's features (`client/src`);
- the Android app's features (`mobile/`).

At that point, the app used 58 of the 174 endpoints in its generated client.

Every gap below already has a server endpoint, so closing one is client work only. A wave is a pull request or two. Each wave is ordered by how often an athlete meets the feature. Tick a line when it ships.

## Wave 1: the daily training loop

### Workout detail (logged workout)
- [x] **Ask coach** about this workout in its own thread, pre-seeded with the workout. The chat sends `focusWorkoutLogId` or `focusPlanDayId`; history comes from `GET /chat/history?focus…`.
- [x] Edit the title, RPE, notes, duration and time of day — `PATCH /workouts/{id}`.
- [x] Delete, with an undo toast — `DELETE /workouts/{id}`, then `POST /recycle-bin/{id}/restore`.
- [x] Add and delete sets — `POST /workouts/{id}/sets`, `DELETE /workouts/{id}/sets/{setId}`.
- [x] Add an exercise from the library (the catalogue is already in `core`).
- [x] Reorder exercises — `PATCH /workouts/{id}/set-order`.
- [x] **Last time** and **next target** rows per exercise — `GET /exercises/{name}/history`.
- [x] Session grade card ("did the session do its job") — `GET /workouts/{id}/session-grade`.
- [x] Link to a plan day, or unlink — `PATCH /workouts/{id}/plan-day`.
- [x] Counts-as-training switch — `PATCH /workouts/{id}`.
- [x] Device detail: pace, cadence, power, calories, moving time.

### Timeline
- [x] Move a session from a menu: Today / Tomorrow / +7 days / Pick date. A planned day uses `PATCH /plans/days/{id}` with `scheduledDate`; a logged one uses `PATCH /workouts/{id}` with `date`.
- [x] Skip dialog: **Move instead** — Tomorrow / Next week / pick date.
- [x] Delete a skipped plan day, with undo — `DELETE /plans/days/{id}`, then restore.
- [x] **Load older workouts**: cursor paging with `GET /timeline?before=`.
- [x] Status filter: All / Completed / Planned / Missed / Skipped.
- [x] Annotations (injury, illness, travel, rest block): day cards, plus create, edit and delete — `/timeline-annotations`.
- [x] "This week" card: today's session, plan week and phase, race countdown, station radar.
- [x] PR trophies on exercise chips — `GET /personal-records`.
- [x] Coach note with its "based on" chips.
- [x] "Coach reviewing" banner while the auto-coach runs.
- [x] Strava badge:
  - link or unlink an activity — `POST`/`DELETE /workouts/{id}/device-link`;
  - "Was this your …?" suggestion — `DELETE …/device-link/suggestion`.

### Plan day (log and preview sheets)
- [x] Edit the prescription text (main, accessory, notes) — `PATCH /plans/days/{id}`.
- [x] Re-parse from text or a photo — `POST /plans/days/{id}/reparse`, `…/reparse-from-image`.
- [x] Sets table: edit, add, delete, reorder — `/plans/days/{id}/sets`, `…/set-order`.
- [x] Session priority (Key / Supporting / Optional) — `PATCH /plans/days/{id}`.
- [x] Rename the title — `PATCH /plans/days/{id}` with `focus`.

### Log workout
- [x] Add an exercise by hand from the library; reorder exercises.
- [x] **Duplicate last workout** — `GET /workouts/latest`.
- [x] Connect to a plan day — `GET /plans/{id}`, then `planDayId` on save.
- [x] Extra fields: time of day, distance, average and max heart rate.

## Wave 2: weekly review and analytics

- [x] **Weekly review** screen:
  - summary, highlights, sessions and next-week intent — `GET /weekly-review`, `POST /weekly-review/intent`;
  - a timeline prompt from Sunday evening to Tuesday;
  - the `/review` link from emails and push.
- [x] Analytics **Race predictor**: prediction, percentile, readiness, segment breakdown — `GET /race-prediction`.
- [x] Analytics **Session quality** — `GET /session-grades`.
- [x] Analytics **Coach insights**: generate and regenerate — `/coach-insights`.
- [x] Analytics **Breakdown**: categories, movement patterns, muscle map (all already in the overview response).
- [ ] Overview:
  - AI chart explanations — `/overview-analysis`;
  - charts for the ACWR trend, form and monotony, body-system load, the consistency heatmap, and RPE, duration and mileage trends;
  - annotation bands on the charts.
- [ ] **MAF trend** for MAF-style athletes — `GET /maf-tests`.
- [ ] **Fuelling** tab: intake against training load — `GET /nutrition/block`.

## Wave 3: nutrition

- [ ] **Describe a meal** (AI) — `POST /nutrition/parse/text`. **Snap a meal** — `…/parse/photo`. Both open a review sheet, then `POST /nutrition/logs/batch`.
- [ ] **Barcode** scan or entry — `POST /nutrition/foods/barcode`. Scanning needs a camera barcode library.
- [ ] **Nutrition label** scan — `POST /nutrition/parse/label`, which pre-fills a custom food.
- [ ] Favourites and recent quick-add — `/nutrition/favorites`, `GET /nutrition/foods/recent`.
- [ ] Remember the usual portion for each food.
- [ ] Log again today; copy yesterday's meal; repeat the previous day — `POST /nutrition/logs/repeat`.
- [ ] Custom foods and named portions — `/nutrition/foods`, `…/servings`.
- [ ] Recipes — `/nutrition/recipes`.
- [ ] Per-meal target overrides — `/nutrition/meal-targets`.
- [ ] Targets: calculate from the profile; scale carbs by training load; adaptive targets.
- [ ] Energy balance card (already in the summary response); micronutrients (`GET /nutrition/micros`); AI insights (`/nutrition/insights`).
- [ ] Session fuelling:
  - before a planned session — `GET /nutrition/planned-session-estimate/{planDayId}`;
  - around a logged one — `GET /nutrition/session-fuelling/{workoutId}`;
  - a fuelling chip on each timeline day — `GET /nutrition/summary-range`.

## Wave 4: plans, coach extras, settings

- [ ] Plan tools:
  - rename — `PATCH /plans/{id}`;
  - goal — `…/goal`;
  - reschedule — `POST /plans/{id}/schedule`;
  - archive or restore — `…/retirement`;
  - delete, with undo.
- [ ] Generate an AI plan outside onboarding, including "supersede the current plan".
- [ ] Coach:
  - workout suggestions with Apply — `/timeline/ai-suggestions`;
  - voice dictation;
  - AI budget warning;
  - training-style badge.
- [ ] Settings → Training:
  - race profile: division, gender, age;
  - body composition;
  - resting and max heart rate, FTP;
  - meals per day;
  - weekly workout goal;
  - adherence-insights toggle;
  - training style, including MAF setup.
- [ ] **Athlete card**: list, add, edit, retire and restore, "still true?" — `/athlete-facts`.
- [ ] Notifications:
  - a send hour for each email;
  - push refuel and logging reminders;
  - a **test notification** button.
- [ ] **Recycle bin**: restore, delete forever, empty — `/recycle-bin`.
- [ ] Automatic timezone sync — `PATCH /preferences` with `userTimezone`.

## Staying on the web (decided in docs/mobile-app-plan.md)

- Coaching-materials upload and the RAG status card.
- Data tools: structuring old workouts (batch re-parse), migration reviews.
- Bulk CSV workout import.
- The RAG debug badge.
- CSV plan import. The app could add it later through the system file picker; it is not planned.
- Web-only plumbing: Web Push (VAPID) endpoints, `POST /emails/check`, non-streaming `POST /chat`.
