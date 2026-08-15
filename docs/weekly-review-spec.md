# In-app Weekly Review — scope

**Status.** PR1–PR3 of 5 landed (§7); the rest is scope. Register entry: recommendation #10 in
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

**The verdict line.** Sessions logged vs weekly goal (`users.weeklyGoal`, `tables.ts:55`), and
— separately — plan days completed out of plan days scheduled. Both come from
`WeeklyReviewCounts`; see §6.1 for why they are two numbers rather than one rate. Streak is
not in the payload: it is a full-history read the client already holds from
`/api/v1/training-overview`.

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

**PRs this week.** Named, not counted — naming the PR is the emotional payload.
`listPersonalRecordsInRange` (PR2, in `weeklyReviewService.ts`) returns the records at the
same per-metric grain the email's `countPersonalRecordsInRange` counts them; that counter is
untouched and still serves the email.

**Coldest station.** Rendered client-side from `buildStationCoverage`, which the client
already holds from `/api/v1/training-overview` and already renders in `StationRadar.tsx`. It
is deliberately absent from the weekly-review payload — see §3.

**Next week's intent. — new.** One free-text line, plus the previous week's intent shown
back. This is the half that makes it a ritual rather than a report. See §5.

**Out of scope for v1.** Nutrition/fuelling for the week (needs its own weekly aggregation
and doubles the surface), AI narrative summary, image export / share card, multi-week
comparison beyond the immediately previous week.

---

## 3. Server — shipped in PR2

**Endpoint.** `GET /api/v1/weekly-review?week=YYYY-MM-DD`, on the `analytics` rate limiter
(20/min) alongside `/api/v1/training-overview`. `week` accepts **any date inside** the wanted
week rather than only a Monday — a link to a Wednesday opens that week instead of 400-ing —
and the week is anchored from it. Absent → the most recently _completed_ week.

`isWeekParamValid` is stricter than the shared `dateStringSchema`, which checks only the
`YYYY-MM-DD` shape: `2026-02-31` passes that regex and then rolls forward into March, handing
back a week nobody asked for. Validation round-trips the date components instead, using
neither `Intl` nor string parsing, both of which throw on the inputs it exists to reject.

**Not persisted.** `analytics_results.feature` is constrained to four literals
(`shared/schema/tables.ts:205-206`), so a stored `weekly_review` feature would need a
constraint migration plus a recompute path plus staleness handling — for a payload that is
four bounded queries.

**Service.** `server/services/weeklyReviewService.ts` → `buildWeeklyReview(storage, userId,
{ now, week })`, reading:

- `storage.analytics.getWorkoutLogsByDateRange` ×2 — this week and the week before
- `storage.analytics.getPlanDaysByDateRange` ×2 — **new**, see below
- `storage.analytics.getExerciseSetsForPersonalRecords(userId)` — full history, because a PR
  means an all-time best; a week-scoped fetch would call every heaviest lift of the week a record
- `storage.timelineAnnotations.list` — filtered by overlap, not containment

**Two changes from the draft.** `getTimeline(userId)` is not used: unbounded, it hydrates
exercise sets for the athlete's entire history, and it does not expose `plan_days.skip_reason`
at all. A purpose-built `getPlanDaysByDateRange` replaces it and `getWeeklyStats` together —
one indexed range query returning every status plus the skip reason, so the counts all come
from one source. And **streak and coldest station are not in the payload**: both need
full-history reads, and the client already holds them from `/api/v1/training-overview`. They
belong to the page (PR3), not to this endpoint.

**Wire type.** `WeeklyReview` in `shared/schema/types/analytics.ts`, beside `TrainingOverview`.

---

## 4. Client — the page shipped in PR3, the entry points are PR4

**Route.** `/review`, lazy-loaded in `AuthenticatedRouter` and wrapped in
`FeatureErrorBoundaryWrapper` like every other page. Week selection via `useUrlQueryState`,
so a week is linkable and shareable — `/review?week=2026-08-04`. **Nothing links to it yet**;
until PR4 lands it is reachable only by URL.

**Data.** `api.analytics.getWeeklyReview(week)`, `QUERY_KEYS.weeklyReview(week)`, and the
`useWeeklyReview` hook. A closed week never changes, so it is cached with
`staleTime: Infinity` and paging back through the year re-fetches nothing; the in-progress
week keeps normal staleness. No localStorage snapshot (unlike `useRacePrediction`) — this is
not an expensive AI payload.

**The client computes the week twice, and the server wins.** The browser knows only its own
timezone, so `client/src/lib/weekDates.ts` (`mondayOf`, `lastCompletedWeekStart`, mirroring
the server's `getWeekRangeForDate`) decides which week to _request_. Everything rendered —
the header range, the prev/next anchor, the in-progress badge — comes from the payload's
`weekStart` / `isCurrentWeek`. Paging from the requested string instead would skip or repeat
a week whenever the athlete's stored timezone differs from the browser's.

**Components.** `pages/Review.tsx` composes three pieces under
`components/review/`: `WeeklyReviewSummary` (the four tiles, reusing `DeltaIndicator`),
`WeeklyReviewHighlights` (annotations and named PRs), `WeeklyReviewSessions` (what happened
and what didn't). The adherence tile is suppressed entirely when `hasPlan` is false, and the
RPE delta is suppressed when either week has no RPE.

**Entry points (PR4), in order of expected traffic.**

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

1. **Completion rate can exceed 100% — settled in PR2.** `getWeeklyStats` counts
   `completedCount` from `workout_logs` but `planned`/`missed`/`skipped` from `plan_days`, so
   ad-hoc sessions with no plan day inflate the numerator against a denominator that never saw
   them (`total = completed + missed + skipped`, `analytics.ts:131-180`). The email has carried
   this quietly; a page with a progress bar would not. **Resolved as two numbers, not a rate**:
   `WeeklyReviewCounts` ships `sessionsLogged` (from `workout_logs`) beside `sessionsPlanned` /
   `plannedCompleted` / `missed` / `skipped` / `outstanding` (all from `plan_days`), and
   `plannedCompleted` can never exceed `sessionsPlanned`. The API returns no rate at all; if the
   page wants one, it computes it from the plan-day pair alone. `getWeeklyStats` itself is
   untouched — the email reports its counts rather than a rate, so it was never affected.
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
| 2   | `weeklyReviewService` + `GET /api/v1/weekly-review` + `getPlanDaysByDateRange` + tests + `WeeklyReview` wire type        | M    | landed |
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
