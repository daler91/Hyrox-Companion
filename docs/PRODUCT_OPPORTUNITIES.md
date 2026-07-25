# Product Opportunities — 2026-07-25

**What this is.** A prioritised register of new features and improvements to existing
features, ranked for two goals: **retention / daily habit** and **depth for serious
athletes**. Every item was checked against the code before it was written down — file and
line references are the evidence, not decoration.

**Constraint applied.** Nothing here requires a new paid third-party service. Everything
builds on what is already wired: Gemini/Anthropic/OpenAI-compatible, Clerk, Resend, Web
Push, Strava, Garmin, Postgres, pgvector.

**Scope.** Product only. No tech-debt, testing, security, or refactor items — those live in
[`CODEBASE_ANALYSIS_2026-07-19.md`](CODEBASE_ANALYSIS_2026-07-19.md) and the issue tracker.

**Method.** A 21-agent sweep: five surface analysts mapped the shipped product
(training, race, nutrition, coach, engagement/platform), four ideation lenses generated
candidates, batched feasibility agents re-checked each one against real code and killed the
ones that did not survive, and a synthesis pass ranked the survivors. Load-bearing claims
were then re-verified by hand. Where an idea was wrong about the codebase, the correction is
recorded rather than dropped.

---

## Where the product stands

On the intelligence axis fitai.coach is ahead of the hybrid-training category: a
deterministic load governor that overrules the AI and wins conflicts, ACWR-calibrated plan
generation, RAG-backed coach chat, per-meal fuelling anchored to each session's time of day,
and a benchmark layer distilled from 60,589 clean HYROX singles results into 34 cohorts
carrying per-station p50s, an 8-point run-leg fade curve, and p1–p99 finish CDFs. The logging
surface is genuinely excellent — five distinct workout-detail surfaces, photo and voice
parsing, planned-vs-actual adherence snapshots, drag-to-reschedule with optimistic rollback,
and a durable offline mutation queue.

Two things hold it back.

**The gym-floor moment is missing.** There is no timer of any kind in 169k lines. A grep
across `client/src` for `restTimer|stopwatch|countdown|useTimer|wakeLock` returns two false
positives; `setInterval` appears exactly once, in `OfflineIndicator.tsx:41`. Elapsed time is a
manual number input at `WorkoutStructureEditor.tsx:905`. Today this app is a form you fill in
after training, which caps how often it can be opened.

**HYROX is not an object in the product.** It is one nullable column, `raceDate` on
`training_plans` ([`shared/schema/tables.ts:224`](../shared/schema/tables.ts)), settable only
as a side effect of AI plan generation, uneditable afterwards, with no venue, no wave time, no
goal finish time, and nowhere to record that the race happened.

There is a consistent third pattern, and it is good news: **built-but-unwired assets**. The
per-exercise history endpoint, food favourites, and station coverage each ship with a
complete server, storage, and API-client layer and **zero component call sites**. The cheapest
available roadmap is mostly wiring, not building.

---

## The recommendations

Ordered by priority against the two chosen goals. **H** = habit/retention, **D** = depth.

### 1. Session Mode — the gym-floor runner · **H** · L

**Pitch.** A full-screen in-workout view: current exercise, tick off sets, automatic rest
countdown, structure playback, screen stays on — and everything is logged when you finish.

**The problem.** The athlete follows the prescription on their phone, times rests on a
separate stopwatch, counts EMOM minutes in their head, and reconstructs the session at home.
Every competitor ships this. It is the highest-frequency open in the category and it does not
exist here.

**Why this product.** The prescription is already structured and already fetchable:
`POST /api/v1/workouts/:id/seed-from-plan` exists
([`server/routes/workouts/workoutsCrud.routes.ts:147`](../server/routes/workouts/workoutsCrud.routes.ts))
and is wired through `useWorkoutDetail.ts:148`, with `patchSetDebounced`/`addSet` giving the
runner the same optimistic write path the log sheet uses. The offline queue
(`client/src/lib/offlineQueue.ts`) and Workbox PWA already exist. And the structured-block
model (EMOM/AMRAP/rounds/interval/for-time, per-step `durationSeconds`, `emomPreview.ts`
minute-by-minute expansion) is the only model in the product that can express HYROX-shaped
training — built, tested, and with nothing to execute it.

**Sketch.** New route `/session/:workoutId` in `client/src/App.tsx` `AuthenticatedRouter`,
rendering `client/src/components/session/SessionRunner.tsx`. Drive the clock off `Date.now()`
deltas held in a ref — never `setInterval` accumulation — so a backgrounded tab stays correct.
Write a general structure expander next to
[`client/src/components/workout-structure/emomPreview.ts`](../client/src/components/workout-structure/emomPreview.ts)
covering `rounds`/`interval`/`amrap`/`for_time`, and have `emomPreview` delegate to it. Wake
Lock via `navigator.wakeLock` with a `visibilitychange` re-acquire and silent fallback;
suppress the PWA update prompt on this route. Finish → existing
`useWorkoutActionMutations.ts:141` `logWorkout` → land in `ReflectStep.tsx` for RPE.

**Two corrections to the obvious plan.** `exercise_sets` has **no** `restSeconds` column —
rest defaults must come from `workout_structure_blocks.restSeconds`/`restIntervalSec`/
`workSeconds` (`tables.ts:568-575`) or a per-category constant table. And this does **not**
need `VITE_EMOM_BUILDER_ENABLED` flipped: `STRUCTURED_BLOCKS_ENABLED` already defaults
`"true"` (`server/env.ts:104`) and `StructureBlocksEditor` already renders unconditionally in
`LogSheet.tsx:223` and `ReviewSurface.tsx:639`. That flag gates exactly one thing — writing
structure onto _plan days_ (`server/routes/plans.ts:325` returns 403).

**Success signal.** Sessions started in runner mode as a % of completed workouts; median
app-foreground minutes per training day; completion rate of started sessions; drop in
same-day retroactive logging.

---

### 2. Injury and illness the coach actually respects · **H + D** · M

**Pitch.** Mark an injury and the app trains around it — no missed-day red badges, no
guilt emails, no "you're detraining" nudge for a break you told it about.

**The problem.** `timeline_annotations` (`tables.ts:800-822`) supports
injury/illness/travel/rest with a date range and a note, has full CRUD, renders on the
Timeline, and already shades the Analytics charts via `buildAnnotationBands`
(`client/src/components/analytics/training-overview/utils.ts:42`). But no coaching path sees
it. A grep for `annotation` across `server/services/` returns one unrelated comment.
`buildTrainingContext` (`server/services/ai/index.ts:240-290`) never loads them;
`TrainingContext` has no field for them; `trainingLoadGovernor.ts` never sees them.

So an athlete logs a three-week Achilles injury and the app: flips every planned day to
**missed** (both in the DB sweep at `server/storage/plans.ts:417` _and_ independently at
render time in `server/storage/timeline.ts:44-52`), emails a missed-workout reminder
(`server/queue.ts:344`), and fires an `acwr_onramp` restriction reading the load drop as
detraining (`trainingLoadGovernor.ts:294-318`). This is the difference between a scheduler
and a coach.

**Also worth knowing.** `input.injuries` in `planGenerationService.ts:127` is _not_ a
persisted profile field — it is a one-shot textarea in `GeneratePlanDetailsStep.tsx:52` that
is never stored. The annotation table is the only durable injury record the app has.

**Sketch.** No new table. (1) Extend `TrainingContext` in `server/gemini/types.ts` with
`activeConstraints`, populate it in the existing `Promise.all` in `buildTrainingContext`, and
add a `buildAthleteConstraints()` builder to `server/prompts/coachingContext.ts` alongside
`buildCurrentDateContext`. Sanitize notes with `sanitizeUserInput`. This one change reaches
chat, suggestions, and auto-coach because all three go through `aiContextService.ts:23`.
(2) Add an annotation-overlap exclusion to **both** `markMissedPlanDays`
(`server/storage/plans.ts:417`) and `calculatePlanDayStatus` (`server/storage/timeline.ts:44-52`)
— guarding only the sweep fixes nothing on screen. (3) Relabel rather than delete the
`acwr_onramp` restriction when the drop is annotation-covered: the ramp is still right after
injury, the copy is not. (4) Gate the missed-reminder enqueue on the same predicate.
(5) Prefill the plan-generation `injuries` textarea from any active annotation.
(6) Confirmation affordance on `TimelineAnnotationCard.tsx`: "Coach is training around this —
N planned days won't count as missed." The `idx_timeline_annotations_user_range` index the
overlap queries want already exists.

**Success signal.** Retention through injury windows (today likely a churn cliff); missed-day
badges shown during annotated ranges (target: zero); reduction in annotation-then-abandon.

---

### 3. Station Report Card · **D** · M (small)

**Pitch.** Your predicted split for every station next to the median for your actual
division, gender and age band — ranked by how many seconds each is costing you.

**The problem.** The predictor says "Wall Balls 6:12" and the athlete cannot tell whether
that is good, bad, or the biggest thing to fix. `SegmentRow`
([`RacePredictorTab.tsx:89-119`](../client/src/components/analytics/RacePredictorTab.tsx))
renders label + basis badge + mm:ss and nothing else.

**Why this product.** Nobody else has the cohort data, and it is _already computed_.
`featureBuilder.ts` resolves `BaselineSegmentEstimate` (`:75-88`) with `benchmarkSeconds`/
`floorSeconds` and `SegmentFeature` (`:54-72`) with `bestSeconds`/`medianSeconds`/`sampleSize`/
`lastTrainedDaysAgo`/`loadRatio`, and `buildFeaturePromptPayload` ships all of it to the
model — then both response builders project it away. `RaceSegmentPrediction`
([`shared/schema/types/analytics.ts:215-227`](../shared/schema/types/analytics.ts)) carries
none of it. This is the cheapest high-value item in the set.

**Sketch.** Widen `RaceSegmentPrediction` with `benchmarkSeconds`, `floorSeconds`,
`bestSeconds`, `medianSeconds`, `lastTrainedDaysAgo`, `loadRatio`. Populate in **both**
`buildDeterministicResponse` and `buildAiResponse` in `racePredictionService.ts` off the
`features` object those functions already hold. No new AI call, no new table, no
`featureBuilder.ts` change — the existing `analytics_results` row just gets fatter. Client:
replace `SegmentRow` with a sortable table in an `overflow-x` container, reusing
`DeltaIndicator.tsx`, plus a "biggest gains" strip.

**Two things the naive version gets wrong.** `estimatedSeconds` is clamped to
`[0.8, 1.5] × benchmarkSeconds` in both paths, so any segment with `basis === "benchmark"`
has a delta of exactly zero — gate the delta column on `basis === "logged"` and render
**"Not logged — log this station"** otherwise; that empty state _is_ the call to action. And
surface `percentile.cohortLabel` / `ageGroupAssumed` next to the numbers so an all-ages
roll-up never masquerades as an age-band median.

**Success signal.** Predictor scroll-depth past the finish number; % of viewers who log a
session containing their worst-ranked station within 14 days; drop in "what should I work on?"
coach-chat volume.

---

### 4. The Race Object — My Races, goal finish time, editable race date · **D** · M

**Pitch.** Add the races you have entered — event, date, venue, wave time, division, goal
finish — so the app plans toward a real event instead of inferring one from a plan's end date.

**The problem.** An athlete signs up for HYROX London on 14 March and there is nowhere to say
so. The only write path is the `endDateIsRaceDate` switch inside plan generation
(`GeneratePlanScheduleStep.tsx:147-152` → `planGenerationService.ts:411-417`).
`server/routes/plans.ts` exposes `PATCH /:id` (rename, `:212`) and `PATCH /:id/goal` (`:221`)
and **nothing** that edits `raceDate`. If your race moves, you regenerate the whole plan. A
B-race mid-block is impossible. And the most motivating number in the sport cannot be entered
anywhere: `trainingPlans.goal` (`tables.ts:217`) is untyped `text`, and
`GoalDialog.tsx:50` literally placeholders _"e.g. complete hyrox in under 90 minutes"_ and
then never parses it.

Worse, `TimelineSummaryCard.tsx:50` falls back `plan?.raceDate ?? plan?.endDate`, so a plan
whose end was never flagged as a race shows a "Race" countdown to an arbitrary date.

**Why this product.** Every downstream consumer is already wired to a race date and just has
no first-class owner: `deriveRaceDayOverride` (`server/storage/raceDayView.ts:38-65`),
`server/storage/timeline.ts:337/348/457/532/577`,
`server/services/nutrition/dailyLoad.ts:109` `daysUntilRace`, the peak-for-this-date line in
`planGenerationService.ts:117-119`, and the countdown in `TimelineSummaryCard.tsx:47-64`.
`users` already carries division/gender/age (`tables.ts:82-88`) — the athlete half of a race
profile exists; the event half does not.

**Sketch — ship in two steps.**

_Step A (S, ships alone, immediate value)._ Add `updateTrainingPlanRaceDate` in
`server/storage/plans.ts` beside `updateTrainingPlanGoal` (`:107`) and a
`PATCH /api/v1/plans/:id/race-date` mirroring the goal handler. No migration — the column
exists. Client: `updateRaceDate` in `client/src/lib/api/plans.ts`, a `RaceDateDialog` modelled
on `GoalDialog.tsx` using `<Input type="date">` as `SchedulePlanDialog.tsx:46-53` does, opened
from the plan panel in `TimelineFilters.tsx` and from the Race tile at
`TimelineSummaryCard.tsx:203`. Then drop the `?? plan?.endDate` fallback at `:50`.

_Step B (M)._ New `races` table: `userId` FK cascade, `name`, `venue`, `city`, `raceDate`,
`startWaveTimeMin` (0-1439, mirroring the `plannedTimeOfDayMin` check pattern), `division`,
`category`, `bib`, `status` check, `goalFinishSeconds`, nullable `planId` FK. Router at
`server/routes/races.ts` copied from
[`server/routes/timelineAnnotations.ts`](../server/routes/timelineAnnotations.ts), which
already has the exact GET/POST/PATCH/DELETE + ownership-check-then-mutate shape. Add
`resolveActiveRaceDate(userId, onDate)` to `server/storage/raceDayView.ts` preferring the
nearest upcoming race row and **falling back to `trainingPlans.raceDate`**, then call it from
`server/storage/timeline.ts:348` and `:536` — those two `planId → raceDate` Map resolutions
are the real migration cost. Keep writing `trainingPlans.raceDate` so legacy plans work.

**Ship it with its payoff.** The athlete-visible half is an editable race date, a goal time, a
Timeline race card with countdown + goal, and — reusing #3's widened wire type — a
gap-to-goal allocator distributing the deficit across the 16 segments weighted by each one's
delta from its cohort p50 ("−40s wall balls, −12s sled pull, −8s/km on runs").

**Out of scope.** The prediction-history trend line. It needs a snapshots table, and because
personalised splits are clamped to `[0.8, 1.5] × cohort median`, a 16-week block can produce a
nearly flat line — the opposite of the promised proof. Revisit if the clamp is revisited.

**Success signal.** % of athletes with an active plan who set a race date within 30 days
(today structurally near-zero, since it can only be set at generation time); % with a goal
time; reduction in plan regenerations.

---

### 5. Notifications that arrive at the right hour and say something useful · **H** · M

**Pitch.** Choose when your daily nudge lands, and get a morning push naming today's actual
session instead of a 2am guilt message about yesterday.

**The problem.** `server/cron.ts:72` schedules `"0 9 * * *"` with `{ timezone: "Etc/UTC" }`.
A US-Pacific athlete's _"You missed: Long Run. Get back on track today!"_ arrives at 2am; a
Sydney athlete's at 8pm. Push has exactly three non-test call sites, all `void
sendPushToUser(...)` riders on email jobs (`server/emailScheduler.ts:93,136,166`) — so push is
email in different clothing. There is **no forward-looking notification of any kind**, which
is the single highest-value daily message a training app can send. Settings offers one on/off
`Switch` and a Test button.

**Why this product.** The infrastructure is complete and idle: VAPID web push with
stale-subscription cleanup, node-cron with advisory locks, per-user `userTimezone` already
used correctly for the email day-of-week math, and a working claim-ledger pattern
(`claimWeeklySummary`/`claimMissedReminder`) that already prevents double sends. The timeline
read already knows today's session name, `expectedDurationMin`, and the fuelling target.

**Sketch.** Add `notifyHour` (int, default 7) and per-type booleans to `users` beside the
existing `emailNotifications`/`emailWeeklySummary`/`emailMissedReminder` block
(`tables.ts:62-65`), exposed through `server/routes/preferences.ts`. Change `server/cron.ts:72`
to `"0 * * * *"` and filter in `runEmailCronJob` on
`getLocalHour(now, user.userTimezone) === notifyHour` — add `getLocalHour` to
`server/timezone.ts` beside `getLocalDateStr`. The hourly migration is safe: the weekly claim
window is 6 days and the missed-reminder window 20h, so the first winning tick stamps and the
other 23 fail the claim. New `processTodaySessionPush` modelled on
`processMissedWorkoutReminder`, with `claimTodaySessionPush` in `server/storage/users.ts`.
Deep-link to `/?workout=<entryId>` — `useOpenWorkoutId.ts` already reads that param and
`client/public/sw-push.js:18` already navigates to `data.url`.

**Two guardrails.** The morning push must default **off** behind its own toggle — existing
subscribers consented to reminders, not to a new daily category. And an hourly tick scanning
every user needs a timezone-aware SQL pre-filter, not a load-all-then-filter-in-Node pass.

**Success signal.** Morning-push open rate vs the current missed-reminder rate;
notification-attributed sessions started; unsubscribe rate (must not move); % of users who
move `notifyHour` off the default.

---

### 6. Close the weight loop · **D** · M

**Pitch.** Log your weight, see the trend against the goal rate you set, and let your
nutrition targets follow it.

**The problem.** The app asks for a weight-goal direction and a target rate in kg/week
(`tables.ts:107-110`), computes a calorie deficit from them, and then gives the athlete no way
to see whether it is working. `bodyweightKg` is a single mutable scalar (`tables.ts:95`)
edited in place in `BodyCompositionCard.tsx`; there is no weight log, no body-fat, no time
series anywhere in the 40-table schema, and no bodyweight chart in `client/src/components/analytics/`
(the "weight" hits there are all lifting loads).

That scalar is load-bearing: it drives BMR/TDEE (`shared/nutritionTargets.ts:64`), protein and
fat g/kg (`:123-124`), session fuelling g/kg (`shared/sessionFuellingTargets.ts:92`) and
per-meal fuelling. And `nutrition_targets` is versioned by `effective_from`
(`tables.ts:1340`) while the bodyweight those targets were anchored to is not — so a target row
from three months ago silently references a weight that has since been overwritten.

_Note: this gap was surfaced by the surface analysis but no ideation lens turned it into a
candidate, so unlike the other items here it did not pass through the adversarial vetting
round. The evidence above is first-hand._

**Sketch.** New `body_metrics` table: `userId` FK cascade, `measuredOn` date, `weightKg`,
nullable `bodyFatPct`, nullable `note`, unique on `(userId, measuredOn)` — the same shape as
`maf_test_results` (`tables.ts:1081-1098`), which is the in-repo precedent for "a typed
result table keyed to the user, surfaced as its own tab". Keep `users.bodyweightKg` in sync
with the most recent entry on write, so every existing consumer keeps working unchanged and
this ships with no migration risk to nutrition. Entry point: a quick-add on the Nutrition page
(the daily-return surface) plus the existing Settings field. Chart: reuse
`MultiLineChart.tsx` + `chartConstants.ts` with a goal-trajectory reference line derived from
`weightGoalDirection` + `weightGoalRateKgPerWeek`, and a 7-day rolling average as the primary
series so day-to-day noise does not read as failure. Optionally snapshot `bodyweightKg` onto
each `nutrition_targets` row so historical targets stay interpretable.

**Success signal.** % of athletes with a weight goal who log ≥4 weights in 30 days; return
visits to the Nutrition page; targets recalculated from a real trend rather than a stale
scalar.

---

## Quick wins

Small, self-contained, mostly wiring already-built assets. Ordered by value per unit effort.

| #   | Name                                                     | What changes                                                                                                                                                                                          | Files touched                                                                                                                                                                                                                                                                                       | Why it matters                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Star a food, remember the portion**                    | Add the star button that has never existed; return `lastQuantityG`/`lastMealType` from the recents/favourites aggregate and seed the dialog with it; favourite chips log directly with an undo toast. | `client/src/pages/nutrition/FoodSearch.tsx`, `MealSection.tsx`, `MyFoodsSection.tsx`, `QuickAddBar.tsx`, `LogFoodDialog.tsx:138`, `client/src/hooks/useNutrition.ts:129`, `server/storage/nutrition.ts:287`                                                                                         | `food_favorites` is a real table with routes, storage, API client **and a working toggle mutation at `useNutrition.ts:132`** — called from zero `.tsx` files. `QuickAddBar` already renders a "Favorites" row that is permanently empty for every user. Highest-frequency interaction in the product.                                                                                                                                                                                                                                                               |
| 2   | **Station Radar on the Timeline**                        | Render `overview.stationCoverage` as a colour-graded chip row naming the coldest station in words.                                                                                                    | `client/src/components/timeline/TimelineSummaryCard.tsx:117`                                                                                                                                                                                                                                        | The component **already fetches this exact payload** — `buildStationCoverage` (`analyticsService.ts:307-341`) ships on the wire at `:586` and renders nowhere. Zero server work. Put it on the Timeline, not the breakdown tab — see "not recommended" #3.                                                                                                                                                                                                                                                                                                          |
| 3   | **"Last time: 4×8 @ 80 kg" on every set row**            | Show previous performance on the exercise header plus a "use last" fill. Add a `limit` param and run the name through `normalizeExerciseName` first (today it is an unbounded exact-string match).    | `server/routes/workouts/workoutsCrud.routes.ts:275`, `server/storage/workouts.ts:490`, `client/src/lib/api/exercises.ts:56` (widen to `(ExerciseSet & {date})[]`), `client/src/components/workout-detail/exercise-table/ExerciseRows.tsx`, `client/src/components/exercise-row/InlineSetEditor.tsx` | The endpoint is built, tested and rate-limited with **zero call sites**. Progressive overload gets no assistance at the exact moment the decision is made — at the rack.                                                                                                                                                                                                                                                                                                                                                                                            |
| 4   | **Your MAF ceiling, on the session you're about to run** | A ceiling chip on planned running sessions; colour the existing Avg HR tile on completed ones.                                                                                                        | New `MafCeilingChip.tsx` beside `timeline-workout-card/FuellingTargetChip.tsx`, rendered as a sibling in `TimelineWorkoutCard.tsx:~574`; `workout-detail/shared/WorkoutSummaryHeader.tsx:90-96`; `settings/TrainingStyleSection.tsx:52`                                                             | `users.mafHr` is computed, stored, sent to the client, used by the coach and by test scoring — and **never rendered anywhere**. `MafTrendTab` plots "MAF ceiling compliance" against a number the athlete has never seen. No server, route, or schema work at all.                                                                                                                                                                                                                                                                                                  |
| 5   | **Missed-workout push: name it, link to it**             | Replace _"You missed: X. Get back on track today!"_ / `url: "/"` with the session name and `/?workout=<id>`.                                                                                          | `server/emailScheduler.ts:136`                                                                                                                                                                                                                                                                      | `sw-push.js:18` already navigates to `data.url` and `useOpenWorkoutId.ts` already reads the param — the deep link is a string change. Scolding copy that lands nowhere is currently the app's only training notification.                                                                                                                                                                                                                                                                                                                                           |
| 6   | **Add one session to the calendar**                      | `protectedPost(router, "/api/v1/plans/:planId/days", …)` wrapping the existing `storage.plans.createPlanDays`, plus an "Add session" entry on the FAB.                                                | `server/routes/plans.ts` (beside the PATCH at `:194`), `server/storage/plans.ts:135`, `client/src/lib/api/plans.ts`, `client/src/components/timeline/FloatingActionButton.tsx`                                                                                                                      | Verified absent: there is PATCH and DELETE for a plan day but no POST. `createPlanDays` is reachable only from CSV import, the sample plan, and AI generation. "Put Saturday's club simulation on my calendar" is impossible; anyone not living inside one generated plan hits this in week one. Note `plan_days.planId` is NOT NULL — a planless athlete needs a lightweight ad-hoc plan row, not a new table.                                                                                                                                                     |
| 7   | **Collapse rest days**                                   | Group consecutive rest entries into one expandable "3 rest days" row.                                                                                                                                 | `client/src/hooks/useTimelineFilters.ts`, new `TimelineRestRow.tsx`                                                                                                                                                                                                                                 | Generated plans emit a card for every rest day (`planGenerationService.ts:142-147` requires all seven `dayName` values), so for a 4-day athlete 3 of every 7 cards are "Complete rest or light walk". **The predicate must not be `focus === 'Rest'`** — focus is free LLM text and CSV imports carry arbitrary strings; test case-insensitively for rest/recovery **and** no sets **and** no structure blocks, and never collapse a completed/skipped/annotated day. Budget the effort for the virtualised list and `scrollTodayConvergence.ts`, not the grouping. |
| 8   | **Where you sit in the field**                           | Ship a ~20-point downsampled p1–p99 curve for the athlete's resolved cohort on `RacePredictionPercentile`; draw it with a marker at their predicted finish.                                           | `server/services/racePrediction/ranking.ts` (`computeRanking` already looks up the `CohortCdf`), `shared/schema/types/analytics.ts:230-238`, `client/src/components/analytics/RacePredictorTab.tsx`                                                                                                 | 35 cohort CDFs with real sample sizes are compressed to a single integer. Un-compressing is a downsample plus one Recharts area chart — ~30 numbers on the wire. Do **not** ship `raceRankingData.generated.ts` (3,549 lines, server-only by design).                                                                                                                                                                                                                                                                                                               |
| 9   | **Week streak, not day streak**                          | `calculateWeeklyStreak(completedDates, weeklyGoal, tz)` counting weeks on goal; keep the day streak as sub-detail.                                                                                    | `server/routeUtils.ts:96`, `server/services/analyticsService.ts:505/595`, `TimelineSummaryCard.tsx:196-202`, `coach/CoachPanelStats.tsx:26`, `server/prompts/coachingContext.ts:43`, `server/emailScheduler.ts:64`                                                                                  | A 4–5×/week athlete sees "1" essentially forever on the most-viewed tile in the app. **Update the AI prompt line too** — it hard-codes the word "days" and the coach will otherwise start making false statements.                                                                                                                                                                                                                                                                                                                                                  |
| 10  | **Capture a skip reason**                                | Four chips (ill / injured / schedule / low energy) plus "move to…" on the confirm dialog.                                                                                                             | `client/src/components/timeline/SkipConfirmDialog.tsx`, `client/src/hooks/useWorkoutActions.ts:57-64`, `patchDayStatusSchema` at `server/routes/plans.ts:250`                                                                                                                                       | The athlete's most frequent negative interaction produces zero signal today and offers no recovery path — the session just disappears. Feeds #2 above once annotations reach the coach.                                                                                                                                                                                                                                                                                                                                                                             |
| 11  | **Fix a meal in slices, not grams**                      | Let edit mode use named servings like create mode does.                                                                                                                                               | `client/src/pages/nutrition/LogFoodDialog.tsx` — `deriveFoodFields` (`:160-185`), the `mode !== "create"` gates at `:236-244`, and the grams-only input at `:458-471`                                                                                                                               | Editing is currently harder than creating, in the app's highest-frequency flow. The servings data is **already fetched in edit mode** (`useFoodWithServings` runs in both) — it is purely a UI gate. Seeding the count is async, so it must be derived state, not a `useState` initializer.                                                                                                                                                                                                                                                                         |
| 12  | **"Week 6 of 12 · Build" on the summary card**           | Add `planPhase` to the training-overview payload using the existing `computePlanPhase`.                                                                                                               | `server/services/trainingOverviewLoader.ts`, `server/services/ai/coachingInsights.ts:120`, `TimelineSummaryCard.tsx`                                                                                                                                                                                | Phase reaches AI prompts only. Client-side it exists solely inside the `aiInputsUsed` blob on days that happen to have a coach note (`CoachNote.tsx:106`) — absent for most days and for anyone with AI off.                                                                                                                                                                                                                                                                                                                                                        |
| 13  | **Run-leg fade curve chart**                             | One Recharts panel plotting the athlete's 8 projected run splits against the cohort `runLegP50Seconds`.                                                                                               | `client/src/components/analytics/RacePredictorTab.tsx`, reusing `MultiLineChart.tsx` + `chartConstants.ts`                                                                                                                                                                                          | Free once #3 lands (the 8 per-leg benchmarks are already on `BaselineSegmentEstimate`). Communicates compromised running — the most HYROX-specific idea in the sport — with zero server work.                                                                                                                                                                                                                                                                                                                                                                       |
| 14  | **Show what you added and dropped**                      | Render `addedSetCount`/`removedSetCount`/`matchedSetCount` next to the adherence badge.                                                                                                               | `client/src/components/workout-detail/ReviewSurface.tsx`, `client/src/lib/adherenceFormat.ts`                                                                                                                                                                                                       | `persistAdherenceSnapshot` computes five numbers per completed session and only `compliancePct` reaches the athlete — the add/drop detail _is_ the coaching signal.                                                                                                                                                                                                                                                                                                                                                                                                 |

---

## Bigger bets

### A. Post-Race Debrief · **D** · L

Enter your official result and 16 splits after the race; get a side-by-side against the
field, against your last race, and against what you were predicted to do.

**The case.** After the biggest day of a 12-week block there is nowhere to put the result.
None of the 38 `pgTable` declarations is a race, a result, or a PB entity, and `workout_logs`
(`:297-386`) has no race or effort-type column. So there is no season progression and no race
history. Worse, the only workaround actively harms the product: logging the race as an
ordinary workout means `featureBuilder.ts` applies `RUN_FATIGUE_FACTOR = 1.15`,
`STATION_FATIGUE_FACTOR = 1.1` and the `[0.8, 1.5]` cohort clamp to already-fatigued race
splits, pessimising the athlete's best data by a further 10–15%.

Every consumer is already built: `computeRanking(division, gender, ageGroup, totalSeconds)`
(`server/services/racePrediction/ranking.ts:52`) is a pure function that will happily rank a
_real_ finish. `maf_test_results` + `MafTrendTab.tsx` is a near-exact in-repo precedent for
the whole shape.

**Sketch.** New `race_results` table modelled on `maf_test_results`: `userId` cascade,
`raceDate`, optional `raceId`/`planId` FK, division/gender snapshot, `officialFinishSeconds`,
`segmentSplitSeconds` (jsonb array of 16 ordered by `RACE_SEGMENTS` in `shared/raceConstants.ts`),
`roxzoneTotalSeconds`, `placing`, `ageGroupPlacing`, `source`, `notes`. A new table is
genuinely required — `analytics_results` is one-row-per-(user, feature) with a unique index,
overwritten on every recompute. Entry: a dialog of 16 mm:ss inputs reusing the
`InlineSetEditor.tsx` tabular aesthetic, reachable from the race-day card the timeline already
renders. Analytics: a "Races" `TabsTrigger` following the conditional-tab pattern MAF already
uses. In `featureBuilder.ts`, add a race-sourced branch bypassing both fatigue multipliers and
the clamp.

**Lead with execution, not the model.** The committed backtest is MAE 743s (~12.4 min). A
predicted-vs-actual hero number will routinely show double-digit-minute misses and burn trust.
Lead with per-segment vs cohort p50 (free once #3 lands) and race-over-race progression;
prediction accuracy is a small, honestly-labelled row.

**What must be true first.** The race object (#4), so a result has something to attach to.

---

### B. Race Day Mode · **D** · L

An offline pace card for race morning: cumulative target clock across all 16 segments, a
per-station break plan, a roxzone budget, and a warm-up + fuelling timeline anchored to your
actual wave time.

**The case.** The highest-emotion surface in the product and the one day the app is genuinely
irreplaceable. Today `server/storage/raceDayView.ts:9-17` is the _entirety_ of race day: two
hard-coded strings plus a shakeout and a recovery template. `STATION_DIMENSIONS` and
`STATION_LOADS_KG` (`shared/raceConstants.ts:84-137`) hold every rulebook fact a break plan
needs and are imported by exactly one module. The offline story is better than it looks:
`useRacePrediction.ts` already persists the full prediction to localStorage via
`client/src/lib/analyticsSnapshot.ts`, so the 16 splits are durably available with no signal.
Lean on that, **not** the Workbox API cache, which is `NetworkFirst` with a 5-minute max age
and useless in an arena.

**What must be true first.** The race object with `startWaveTimeMin` and `goalFinishSeconds`
(#4), and the Debrief (A) so there is a decided home for the result. Frame every target as a
plan, not a promise — a wrong pace card on race morning is a uniquely damaging failure given
the clamped prediction. Make split capture optional with post-race manual entry as the primary
path; HYROX athletes have no pockets and both hands on implements.

---

### C. Race-Standard Plan Generation · **D** · L

Generated plans that prescribe your division's actual loads and your goal-derived paces
instead of generic "tempo run" text.

**The case.** `buildGenerationPrompt` (`planGenerationService.ts:102-149`) emits goal,
experience level, days per week, total weeks, unit prefs, race date, focus areas, injuries,
rest days, and an optional load-posture line. **No division. No gender. No benchmarks. No
training style.** So a Pro athlete's plan can prescribe Open loads, every prescribed weight is
invented from a three-way beginner/intermediate/advanced label, and — worst — a MAF athlete
who completed setup and had a heart-rate ceiling computed gets a plan full of tempo runs and
hill repeats, precisely what the method forbids. `resolveTrainingStyle`
(`server/services/training_styles/registry.ts:158`) is called from `coachService.ts:589/810`
and `aiSuggestionService.ts:340/456` — never from plan generation. Every input is one import
away, loaded from the `users` row rather than widened onto the client-supplied
`GeneratePlanInput`.

**What must be true first.** `goalFinishSeconds` (#4), because goal-derived paces are the half
that makes this feel like coaching rather than a units fix. And a review-before-commit or
regenerate-a-week path: generation writes and schedules in one transaction, so if weeks 3–12
are wrong the only recourse is deleting the plan, and richer prescriptions raise the cost of
that. `PLAN_GENERATION_PROMPT` is already ~65 lines and runs in parallel chunks with no
cross-chunk continuity — emit the loads/benchmarks/style block only when the goal or focus
areas indicate HYROX, or risk the model dropping the RETURN FORMAT rules.

---

### D. Compromised Run Test · **D** · M–L

A protocol that measures how much slower _you_ run off a station, instead of assuming
everyone fades the field average.

**The case.** Compromised running is the sport. `featureBuilder.ts:141` is literally
`const RUN_FATIGUE_FACTOR = 1.15`, applied uniformly to every athlete, and
`shared/schema/exercises.ts:25` has exactly one race-run key (`run_1k`), so a fresh 1k and a 1k
off the sled push are the same row.

**An important correction.** The 8-point fade _curve_ is **not** unused — `featureBuilder`
already applies `curve[position]` per run leg, so runs 1–8 already get progressively slower
from real field data. `RUN_FATIGUE_FACTOR` is a single fresh→race-pace discount, not the fade
model. A measured coefficient rescales the athlete's runs; it does not personalise the shape,
and one test session never could.

**Sequencing.** Ship the cheap half now — the fade chart (quick win #13). The measurement half
only becomes worth doing once the `[0.8, 1.5]` personal-fraction clamp is widened or bypassed
for measured cases; otherwise an athlete does a 60-minute test and the prediction does not
move, which is worse for credibility than the gap. Then add `run_1k_compromised` to
`EXERCISE_DEFINITIONS` (read by 21 non-test modules — budget for the ripple) and ship the
protocol as free text on a plan day, not a new template concept. Skip auto-detect: inferring
"a run after a station" from `exerciseSets.sortOrder` will misfire on every circuit workout.

---

## Considered and not recommended

**1. Station Execution Log (grip failures, no-reps, sled breaks).** Genuinely
differentiating, wrong time. Adoption is the whole risk: it adds per-set friction on exactly
the sets hardest to log (mid-session, hands wrecked), and the entire payoff — a trend line —
arrives only after 6–8 weeks of disciplined entry. It is also narrower than it sounds:
per-set free-text notes already exist and are editable (`InlineSetEditor.tsx` `NotesField`,
`notes` at `tables.ts:509`), so "my grip goes at 120m" _is_ tellable today — it is only
un-aggregatable. Revisit after Session Mode, which makes in-set input cheap enough to be
plausible.

**2. A "Week Ahead" ritual screen.** The premise is partly false. The claim that the Timeline
is clipped to seven date groups and the athlete can never see more is wrong —
`useTimelineFilters.ts:25-26/106-109` exposes `showAllPast`/`showAllFuture` with
`hiddenPastCount`/`hiddenFutureCount`, both wired into the page. Every future day is already
visible, in date order, with drag-to-reschedule. What is missing is a side-by-side
seven-column comparison — a presentation preference, not a capability gap — and a second
surface showing the same data competes with the home screen. The genuinely missing pieces are
salvaged as quick wins #7 and #12.

**3. Re-adding "Functional Station Coverage" to the Analytics breakdown tab.** Already
decided against: `CategoryBreakdownTab.test.tsx:244-245` positively asserts the heading and the
`station-coverage-grid` testid are **not** in the document. The concept was retired in favour
of Movement Pattern Coverage + the Muscle Heat Map. Do not re-litigate it in the same place —
put station coverage on the Timeline (quick win #2), where it functions as a nudge rather than
a competing taxonomy. Related: reconcile `buildStationCoverage` (`analyticsService.ts:307`)
with `computeExerciseGaps` (`coachingInsights.ts:101`) first — they compute the gap
differently, so the card will say 24 days while the coach says 6.

**4. "Turn on the EMOM / structured-block builder" as a headline feature.** Mostly already
exists. `STRUCTURED_BLOCKS_ENABLED` defaults `"true"` (`server/env.ts:104`) and
`StructureBlocksEditor` already renders unconditionally in `LogSheet.tsx:223`,
`ReviewSurface.tsx:639` and `ConfirmStep.tsx:229`. The flag gates exactly one thing: writing
structure onto _plan days_ (`server/routes/plans.ts:325` returns 403). That is a 403 to
remove, and it should ride along with Session Mode.

**5. Shipping the cohort ranking tables to the client to draw a finish-time CDF.**
`raceRankingData.generated.ts` is 3,549 lines and server-only by explicit design. If we want
the curve, add a small endpoint returning a downsampled series for the athlete's resolved
cohort only — see quick win #8. Not worth reversing a bundle-size decision for one chart.

**6. Shareable result cards.** Deferred, not rejected. It is the only item with acquisition
upside rather than pure retention, and _"Faster than 73% of Open Men 40-44 · 3,214 athletes"_
is the most screenshot-worthy sentence the product has. But it is out of scope against the
current priorities, it needs a real result to share (a _prediction_ card invites athletes to
post a number they have not run), and the canvas work is routinely underestimated — text
wrapping, `document.fonts.ready` before first `fillText`, DPR scaling, and drawing an SVG
component onto a canvas are all unbuilt. Revisit after the Debrief.

---

## Sequencing

**Wave 0 — quick wins, all independent.** #1–#5 in the quick-wins table. Each converts an
already-built, already-tested, zero-call-site asset into something a user can see, and they
need nothing from anything else. Highest confidence in the whole register.

**Wave 1 — Station Report Card (#3).** Do this before anything else in the race arc.
Widening `RaceSegmentPrediction` is the single highest-leverage type change available: it is a
hard dependency of the run-fade chart (quick win #13), the gap-to-goal allocator in #4, the
per-segment comparison that makes the Debrief trustworthy, and the pace card in Race Day Mode.
Four things get cheaper the moment it lands.

**Wave 1b — Injury-aware coaching (#2), in parallel.** No shared dependencies. Highest value
score in the whole set, and it protects retention through exactly the windows where athletes
currently churn.

**Wave 2 — The Race Object (#4).** The keystone: it unblocks the Debrief, Race Day Mode, taper
logic, and goal-derived paces. Ship Step A (editable race date, ~S) immediately — it lights up
four already-shipped behaviours with no migration. Then Step B with the goal time, the Timeline
race card, and the gap-to-goal allocator, so it lands as a feature rather than plumbing. Keep
`trainingPlans.raceDate` as a fallback instead of hard-migrating; the two `planId → raceDate`
resolutions in `server/storage/timeline.ts` (`:348`, `:536`) are the only real risk.

**Wave 3 — Session Mode (#1), on its own track.** It shares no dependencies with the race arc
and can start from Wave 1 onward. It is the biggest _habit_ gap where the race object is the
biggest _strategic_ one, and it is the prerequisite that makes the Station Execution Log
plausible later.

**Wave 4 — Notifications (#5) and the weight loop (#6).** Both shippable any time.
Notifications are sequenced here because the best payload — "Today: Threshold Intervals ·
55 min" deep-linking into a session — only exists once Session Mode does. **The 2am-push fix
should not wait**: pull the hourly-tick + `notifyHour` half forward into Wave 2 if there is
capacity, since it silently halves the effectiveness of the entire existing engagement loop
for half the user base.

**Wave 5 — Post-Race Debrief, then Race Day Mode, then share cards.** Strictly ordered. The
Debrief decides where a race result lives; Race Day Mode writes into that decision; share
cards need a real result to be worth sharing.

**One thing to protect.** Do not let Race-Standard Plan Generation (bet C) jump the queue on
the strength of its value. It touches a prompt that already runs in parallel chunks with no
cross-chunk continuity, and richer prescriptions without a regenerate-a-week escape hatch make
a bad plan more expensive to escape, not less.
