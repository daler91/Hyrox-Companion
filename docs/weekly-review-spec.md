# In-app Weekly Review — scope

**Status.** PR1 of 5 landed (§7); the rest is scope. Register entry: recommendation #10 in
[`PRODUCT_OPPORTUNITIES.md`](PRODUCT_OPPORTUNITIES.md).

**One-line pitch.** A Sunday-night page: what you planned, what you did, what changed, and
one thing to carry into next week.

**Why it is cheap.** Almost every number is already computed. `processWeeklySummary`
(`server/emailScheduler.ts:40-100`) assembles the whole thing today and then posts it to an
email address. This is largely a surfacing job, in the same "built-but-unwired" pattern as
Wave 0.

---

## 1. The decision that had to be made first — settled in PR1

**There are two definitions of "a week" in the codebase.**

| Definition             | Where                                                           | Used by                                                                      |
| ---------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| UTC, Monday-anchored   | `getMondayWeekBoundaries` (`server/services/weeklyProgress.ts`) | `buildWeeklySummaries` → training overview charts, `weeklyCompletedWorkouts` |
| Local, Monday-anchored | `getLocalMondayWeekBoundaries` (same file, added in PR1)        | The weekly summary email, and the weekly review                              |

**A correction to the first draft of this spec.** It claimed the email used a trailing
seven-day window that would disagree with Monday weeks by a day for most of the world. That
is what the arithmetic at `emailScheduler.ts` looked like in isolation — but the function
returns early unless `getLocalDayOfWeek(now, tz) === 1`, so it only ever runs on the
athlete's local Monday, where "the seven days ending yesterday" **is** the local Monday→Sunday
week that just closed. The email was already right. There was no user-visible bug to fix, and
PR1 is a de-duplication rather than a repair.

**Decision: local-timezone, Monday-anchored** for every athlete-facing weekly surface. Monday
weeks because that is what plan days are aligned to (`plan_days.weekNumber`), and local
because every athlete-facing date in the product already is (`server/timezone.ts`).

**What PR1 did.**

1. Added `getDayOfWeekForDateStr(dateStr)` to `server/timezone.ts` — the date-only counterpart
   of `getLocalDayOfWeek`, since a calendar date falls on the same weekday in every timezone.
2. Added `getWeekRangeForDate(dateStr)` and `getLocalMondayWeekBoundaries(now, tz)` to
   `server/services/weeklyProgress.ts`, returning `{ weekStart, weekEnd }` (Monday, Sunday,
   both inclusive). Pure calendar-string math, so DST-proof by construction. An unusable
   `users.userTimezone` degrades to UTC via `getLocalDateStrSafe` rather than throwing.
3. Refactored `processWeeklySummary` onto the shared helper — behaviour-preserving, with the
   equivalence pinned by a test that reconstructs the old inline arithmetic and asserts it
   matches, plus window assertions for UTC, Sydney, Los Angeles and Honolulu that the file
   previously had none of.
4. **Left `buildWeeklySummaries` on UTC weeks.** Migrating the overview charts changes every
   historical bar for non-UTC athletes and deserves its own PR and its own decision. A chart
   binned by UTC weeks next to a review binned by local weeks is a defensible inconsistency;
   an email and a page that disagree would not have been.

---

## 2. What the page shows

Ordered by how it should read top to bottom. Every row below is backed by data that exists
today unless marked **new**.

**Header.** Week of Mon 4 Aug – Sun 10 Aug, with prev/next week navigation and a
"this week so far" state when the requested week is the current one.

**The verdict line.** Sessions completed vs weekly goal (`users.weeklyGoal`, `tables.ts:55`),
completion rate, streak. Straight from `storage.analytics.getWeeklyStats`
(`server/storage/analytics.ts:131`) and `calculateStreak`.

**Deltas vs the previous week.** Sessions, total duration, average RPE, training load.
`OverviewStats`/`WeeklySummary` (`shared/schema/types/analytics.ts`) already carry these
shapes, and `DeltaIndicator.tsx` already renders the up/down affordance.

**The sessions themselves.** One row per logged session: date, focus, duration, RPE, and
adherence. `workout_logs` already stores `compliancePct`, `matchedSetCount`, `addedSetCount`,
`removedSetCount` — so rendering the add/drop detail here also delivers **register quick win
#14** for free, in a place where the athlete has time to read it.

**What did not happen, and why.** Missed and skipped days, with the skip reason.
`plan_days.skip_reason` is captured today (`SkipConfirmDialog.tsx`) and **read by nothing** —
this page would be its first consumer, which is the argument for building it here rather than
in a chart.

**Context, before conclusions.** Any `timeline_annotations` overlapping the week (injury,
illness, travel, rest). A week with a logged injury must not be framed as failure. This is
the same predicate recommendation #2 needs; if #2 ships first, reuse its overlap query.

**PRs this week.** `countPersonalRecordsInRange` (`server/services/analyticsService.ts:143`)
returns a count today; widen it to return the records themselves (`countPersonalRecordsInRange`
stays, add `listPersonalRecordsInRange` beside it) so the page can name them. Naming the PR is
the emotional payload; a number is not.

**Coldest station.** Reuse `buildStationCoverage` — already on the wire, already rendered by
`StationRadar.tsx`, so this is a second render of a payload the client can already fetch.

**Next week's intent. — new.** One free-text line, plus the previous week's intent shown
back. This is the half that makes it a ritual rather than a report. See §5.

**Out of scope for v1.** Nutrition/fuelling for the week (needs its own weekly aggregation
and doubles the surface), AI narrative summary, image export / share card, multi-week
comparison beyond the immediately previous week.

---

## 3. Server

**Endpoint.** `GET /api/v1/weekly-review?week=YYYY-MM-DD`, where `week` is the local Monday.
Absent → the most recently _completed_ week. Built with `protectedGet`
(`server/routes/_helpers/protectedRouteBuilder.ts`) and the existing `analytics` rate limiter
(20/min), matching `/api/v1/training-overview` (`server/routes/analytics.ts:155`).

**Do not persist it.** `analytics_results.feature` is constrained to four literals
(`shared/schema/tables.ts:205-206`), so a stored `weekly_review` feature needs a constraint
migration plus a recompute path plus staleness handling — for a payload assembled from
queries the email already runs weekly. Compute on read; wrap in `analyticsRouteCache` if the
timeline query proves heavy.

**Service.** `server/services/weeklyReviewService.ts`, exporting
`buildWeeklyReview(userId, weekStart, tz)`. It orchestrates existing storage calls — no new
SQL if avoidable:

- `storage.analytics.getWeeklyStats(userId, start, end)` — counts and duration
- `storage.timeline.getTimeline(userId)` — sessions, statuses, skip reasons, focus
- `storage.analytics.getAllExerciseSetsWithDates(userId)` — PRs (already used by the email)
- `storage.timelineAnnotations` — overlapping ranges
- `buildStationCoverage` / training-load overview — coldest station, load delta

**Wire type.** `WeeklyReview` in `shared/schema/types/analytics.ts`, beside `TrainingOverview`.

---

## 4. Client

**Route.** `/review` in `AuthenticatedRouter` (`client/src/App.tsx:80-88`), wrapped in
`FeatureErrorBoundaryWrapper` like every other page. Week selection via `useUrlQueryState`
(`client/src/hooks/useUrlQueryState.ts:43`) so a week is linkable and shareable —
`/review?week=2026-08-04`.

**Data.** `api.analytics.getWeeklyReview(week)` in `client/src/lib/api/analytics.ts`, a
`QUERY_KEYS.weeklyReview` entry (`client/src/lib/api/index.ts:88`), and a `useWeeklyReview`
hook. Past weeks are immutable once the week closes — `staleTime: Infinity` for a completed
week, normal staleness for the current one. No localStorage snapshot needed (unlike
`useRacePrediction`); this is not an expensive AI payload.

**Entry points, in order of expected traffic.**

1. **The weekly summary email and its push.** `emailScheduler.ts:96` currently sends the push
   to `url: "/analytics"` — a page showing different numbers over a different window. Point
   both at `/review?week=…`. Cheapest, highest-intent traffic there is.
2. **A Timeline banner**, appearing Sunday evening through Tuesday local, dismissible, once
   per week. Slots above `TimelineSummaryCard` (`client/src/pages/Timeline.tsx:389`).
3. **A link from the Analytics overview tab.** A link, not a tab: the review is week-scoped
   while Analytics is range-scoped (`?range=90`), and putting a fixed-window surface inside a
   variable-window page invites exactly the "why do these disagree" confusion §1 is about.

---

## 5. Intent capture (v1.1, ship close behind)

**Table.** `weekly_reviews`: `userId` FK cascade, `weekStart` date, `intent` text
(length-capped), `viewedAt`, `createdAt`, unique on `(userId, weekStart)`. Shaped like
`maf_test_results` (`tables.ts:1097`) — the in-repo precedent for a typed per-user
result row keyed to a date.

**Behaviour.** One line, optional, editable all week. Shown back at the top of the _next_
review ("Last week you said: get three runs in"). No scoring, no self-assessment against it —
the value is the recall, and grading an athlete against their own aspiration is how a ritual
becomes a chore.

**Reaches the coach for free.** If item #8 (coach memory) ships, the current intent is a
natural durable fact with a one-week lifetime. Do not wire it into prompts before that
mechanism exists.

---

## 6. Edge cases that will otherwise ship broken

1. **Completion rate can exceed 100%.** `getWeeklyStats` counts `completedCount` from
   `workout_logs` but `planned`/`missed`/`skipped` from `plan_days`, so ad-hoc sessions with
   no plan day inflate the numerator against a denominator that never saw them
   (`total = completed + missed + skipped`, `analytics.ts:131-180`). The email has carried
   this quietly; a page with a progress bar will not. Either clamp and label, or split
   "planned sessions completed" from "sessions logged" into two numbers. **Two numbers is the
   honest answer** and it is also the more useful one.
2. **The planless athlete.** No plan → `planned`/`missed`/`skipped` are all zero and
   completion rate is meaningless. The page must lead with what was logged, not with a 0%.
3. **The annotated week.** Injury or illness overlapping the week suppresses the
   missed-session framing entirely. Same predicate as recommendation #2.
4. **The empty first week.** A new athlete's first review must read as a starting point, not
   a report card. No red, no zero-percent hero number.
5. **The in-progress week.** "So far" framing, no completion verdict, no delta against a week
   that has not finished.
6. **Missing or invalid timezone.** `getLocalDateStrSafe` (`server/timezone.ts:154`) already
   handles this; use it rather than assuming `userTimezone` is populated.
7. **Deleted plans.** `workout_logs.planId` is `ON DELETE SET NULL` — a week whose plan was
   deleted still has logged sessions and must still render.

---

## 7. Delivery

| PR  | Contents                                                                                                                 | Size | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ---- | ------ |
| 1   | `getDayOfWeekForDateStr`, `getWeekRangeForDate`, `getLocalMondayWeekBoundaries` + unit tests; email refactored onto them | S    | landed |
| 2   | `weeklyReviewService` + `GET /api/v1/weekly-review` + route tests + `WeeklyReview` wire type                             | M    | next   |
| 3   | `/review` page, hook, API client, empty/edge states + component tests                                                    | M    |        |
| 4   | Entry points: email CTA, push deep link, Timeline banner, Analytics link                                                 | S    |        |
| 5   | v1.1 — `weekly_reviews` table, intent capture, carry-forward                                                             | S–M  |        |

**Total: M.** PR1 stood alone: the week helpers are the vocabulary every later PR is written
in, and the email now shares one definition of "last week" with the page that does not exist
yet.

**Testing notes.** The week math needs unit tests across DST transitions in both hemispheres,
year boundaries, and the Sunday `getUTCDay() === 0` case the existing function special-cases.
Route tests follow `server/routes/__tests__/analytics.test.ts`. Client tests should cover the
planless athlete, the annotated week, and the empty first week — the three states most likely
to ship wrong.

**Success signal.** Weekly review opens per active athlete; % who set a next-week intent;
completion rate in the week following a review versus a week without one; email→page
click-through versus the current email→`/analytics` rate.
