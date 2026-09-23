# Refactoring Review — 2026-09-23

**What this is.** A pass over the whole codebase for refactoring opportunities (dead code,
duplication, misplaced or stale comments, awkward seams), plus a check of every core-reference
document against the code it describes. It started from `main` at `1de5d9b` and was implemented
on the branch `claude/festive-albattani-b48po3`. Line numbers below are as of that branch's
final commit; where a line may drift, the symbol name is given too.

**Method.** Six read-only reviewers, one per area: storage and integrations, the HTTP layer,
non-AI services, the AI layer, client hooks/lib/pages, and client components. A seventh set of
findings came from reading build config and shared code directly. Each reviewer had to give
file:line evidence and, for anything framed as a bug, a concrete input that produces a wrong
result. Every finding acted on here was re-read in the current code first. Library behaviour
that a finding depended on was checked in `node_modules` rather than assumed:

- drizzle 0.45 wraps driver errors in `DrizzleQueryError`;
- TanStack Query sends a throw inside `onSuccess` to `onError`;
- pino-http evaluates `customProps` when the request starts;
- pg-boss defaults to a `batchSize` of 1.

Where a bug fix adds a test that fails on the old code, that was checked by reverting the fix
and running the test again.

**Result.** Seven bug fixes, about 1,900 lines of dead code and its tests removed, a few small
consolidations, comment corrections, and a documentation sweep. The rest is listed below:

- eight behaviour changes left for the owner to decide;
- about forty refactors that are real but were deferred;
- a short list of checked-and-dropped items, so they are not raised again.

Excluding Markdown, the branch changes 130 files (+741 / −2,397). Tests account for
+350 / −786 of that: deleted tests covered deleted code, and the new ones cover the fixes and
the new shared helpers.

---

## Implemented on this branch

### Bug fixes

Five of these seven are pinned by a test that fails without the fix. The other two are marked
in the table.

| Commit    | What was wrong                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c8e283c` | **Wrapped unique violations were missed.** The `users_email_unique` checks in `server/storage/users.ts` and `server/clerkAuth.ts` read only the top-level error. drizzle 0.45 puts the pg error on `.cause` of a `DrizzleQueryError`, so these checks never matched. A Clerk profile whose email already belonged to another row threw instead of syncing without the email, as both catch blocks intend. All five copies now use `isUniqueViolation(err, constraint?)` in `server/dbErrors.ts`, which walks the cause chain. |
| `1cbb7fa` | **Plan week and station gaps used the UTC date.** `buildTrainingContext` resolves one athlete-local `today`, but `computeCurrentWeek` and `computeExerciseGaps` still used UTC today. For an athlete west of UTC, that is the wrong week and wrong gap counts overnight. This also removes `server/types.ts` `toDateStr`, a UTC helper that got past the lint rule against deriving UTC today. |
| `fccea2e` | **`getTrainingPlan` was bound to the wrong object.** `GET /api/v1/plans/:id` bound it to the storage facade instead of `storage.plans`. It worked only because that method happens not to use `this`, so the bug was latent. The route had no test and now has two, but they cover the route: they pass on the old code as well. |
| `ff2547e` | **Settings reported a successful save as failed.** `usePreferencesForm` wrote to `localStorage` unguarded inside `onSuccess`. A quota or private-mode error there goes to `onError`, so the user saw "Failed to save settings" after the server had saved. |
| `9ad179e` | **Auto-coach overwrote plan-day notes.** For `notes`, `getExistingFieldValue` in `server/services/coachService.ts` returned `""`, so an "append" replaced the athlete's notes. The manual suggestion path already appended. |
| `b857d38` | **Timed-out AI calls kept running.** The Anthropic and OpenAI-compatible providers dropped the retry wrapper's per-attempt abort signal, so a hung call held its socket past the timeout. Gemini already merged it. The helper is now shared as `combineSignals` in `server/ai/providers/http.ts`. This was open since the 2026-07-19 analysis. |
| `527e50f` | **Raw zod issues were logged.** Four AI-output validators logged the raw issue array. The overview schema's `z.record` puts keys chosen by the model into issue paths, so model text reached the logs. They now use `formatZodIssues`, like the other six. This changes only what is logged, and it has no new test. |

### Dead code removed

Every item below had no production caller. Each was checked across `client/`, `server/`,
`shared/`, `script/` and the tests.

- **`15ef77a`** — 12 `WorkoutStorage` methods, `CoachingStorage.insertChunks`,
  `PushStorage.getUsersWithPushSubscriptions` and a stray re-export. Two of them were hazards,
  not just clutter:
  - `deleteWorkoutLogByPlanDayId` hard-deleted every log on a plan day without a recycle-bin
    snapshot (the shape of the H2 bug).
  - `createWorkoutLog` completed a plan day without the prescription copy and adherence
    snapshot that `createWorkoutInTx` takes.
- **`bd4e9e6`** — the `…WithDiagnostics` text/image parsers, the `GEMINI_MODEL` constants,
  `structuredRowsRequiredMessage`, and the test-only `computeSseDeadlineMs` shim. Its test now
  also asserts the deadline `reason`, which nothing covered before.
- **`68bc7a5`** — eleven client API wrappers. One of them, `api.timeline.get`, has silently
  returned only the first page since cursor paging. Also removed: `useBlockCounts`,
  `useUpdateCoachingMaterial`, `isUnauthorizedError` and four date helpers.
- **`d0fc07e`** — the `ExerciseInput` editor, its five widgets and `workout/ExerciseRow`
  (~830 lines), rendered only by tests. The types still in use (`SetData`,
  `StructuredExercise`, `createDefaultSet`) moved to `client/src/lib/structuredExercise.ts`.
- **`7295fcf`** — the embedding cache's read of `server_runtime_cache`. Nothing writes those
  keys, by design, so every cache miss cost a database round trip that could only find nothing.
- **`b6e4f80`** — Tailwind plugins were registered twice (`@plugin` in `index.css` and the
  config's `plugins` array), which duplicated every `.prose` rule and the animation keyframes.
  Also removed: an unused `status-*` palette and a Vite alias to a directory that does not
  exist.

### Consolidations

- **`000a957`** — the auth-bypass predicate was copied three times (`App`, `useAuth`,
  `useSignOut`). It now lives once, with tests, in `client/src/lib/authBypass.ts`. The three
  copies must agree, or Clerk hooks run outside `ClerkProvider` and throw.
- **`3bbb831`** — the legacy-unit backfill rebuilt its two UPDATEs inline, so the SQL its tests
  pin was not the SQL that runs. It now executes `stampUpdateFor` inside the transaction.
- **`ca9352b`** — the backfill script had its own copy of the flag parser; it now uses the
  shared one.
- **`fe720fe`** — `AdhocLogSheet` hand-copied `invalidateWorkoutWriteQueries` and
  `getTodayString`; it now calls them.
- **`45984f1`** — the queue's email workers took a nullable context they could never receive,
  and all six callers carried a dead `context ? … : false`. Garmin's `/connect` inlined its own
  copy of `rejectIfCircuitOpen`, and the breaker message was built in three places.

### Comments corrected

**`4de5e83`** and **`fe720fe`** fix comments that described code that had moved or changed:

- JSDoc blocks stranded above the wrong function (`runBatch`, `buildPersonalRecordSummaries`,
  three stacked blocks in `planGenerationService.ts`);
- a claim that pg-boss retries only a batch's failed jobs (it retries the whole batch);
- request-logging comments that assumed Clerk runs before pino-http;
- cross-references to deleted files;
- client comments describing per-keystroke saves and a deleted invalidation helper.

### Documentation

Every core-reference document was checked claim by claim against the code, and drift was fixed
in `api-reference`, `server`, `architecture`, `authentication`, `database`, `testing`, `client`,
`state-management`, `integrations`, `env-reference`, `ai-and-rag` and `nutrition`. The root and
operations docs were fixed too (`README`, `CONTRIBUTING`, `TECHNICAL_DEBT`, `design_guidelines`,
`test/audit/README`, `pending-manual-steps`, the review-command README). The most consequential
corrections:

- **Unauthenticated routes.** The API reference said the health probes were the only ones. The
  real list also has `csrf-token`, the Strava callback and webhook, email unsubscribe and the
  cron trigger. The unsubscribe routes are also a second CSRF exception.
- **Clerk ordering.** Clerk runs _after_ pino-http and the request context, so `req.log` is
  always `"anonymous"`. `server.md`, `architecture.md` and two code comments said otherwise.
- **CSRF secret.** When `CSRF_SECRET` is unset, the server generates a random per-process
  secret; it never falls back to `ENCRYPTION_KEY`. The must-differ rule applies in every
  environment.
- **Database.** 101 migrations, not 96. The index summaries now reflect the three
  redundant-index drops. The storage interface lists all 17 domains, and startup maintenance
  has nine steps, not five.
- **Coverage thresholds.** 68/62/60/67, not 80 across the board.

---

## Needs an owner decision

These are behaviour changes, so none of them was made. Each was confirmed in the current code.

| #   | Where                                                                                                                      | What                                                                                                                                                                                                                                                                                                        | Suggested fix                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `server/prompts/coachingContext.ts:78-91` `buildStructuredPerformance`                                                     | The chat prompt prints `max weight: N` and `max distance: N` with no unit. The suggestion renderer (`server/gemini/suggestionService.ts`) appends the stored distance unit (audit H16), and per-set lines elsewhere in the prompt label both.                                                                    | Pass `trainingContext.weightUnit` / `distanceUnit` through, as `exerciseSetFormatter.ts` does. Prompt snapshots will change.                                     |
| D2  | `server/routes/plans.ts:221-233`                                                                                           | Two PATCH routes update a plan day. `/plans/:planId/days/:dayId` ignores `:planId` and never queues the auto-coach. `/plans/days/:dayId` queues it when `scheduledDate` changes. The client's wrapper for the scoped route had no callers and was removed in `68bc7a5`.                                      | Retire the scoped route, or make it delegate to `updatePlanDayWithCleanup`. The API reference now documents the difference.                                     |
| D3  | `client/src/hooks/useStravaMutations.ts:58-64`, `useGarminMutations.ts:39-45`                                              | Device sync invalidates timeline, workouts and analytics but not `trainingOverview`, which `invalidateWorkoutWriteQueries` does include. The training summary card stays stale until its query refetches. The derived-analytics key list is also hand-copied across about seven hooks.                             | One shared "workout data changed" invalidation set, used by the sync hooks too.                                                                                  |
| D4  | `client/src/components/workout-structure/StructureBlocksEditor.tsx:110-112`                                                | `formatBlockType` labels every type other than EMOM/AMRAP as "Rounds". `WorkoutStructureEditor.tsx:38-45` has distinct labels for steady, interval and for-time.                                                                                                                                                 | Reuse `BLOCK_TYPE_LABELS`.                                                                                                                                      |
| D5  | `client/src/components/workout-detail/ReviewSurface.tsx:74-89` (`useMigrationReview`)                                      | Uses a raw `fetch` and parses the body without checking `res.ok`, so an error body is treated as review data.                                                                                                                                                                                              | Go through `apiRequest` / the default query function.                                                                                                          |
| D6  | `client/src/components/workout-detail/AdhocLogSheet.tsx:345-358`                                                           | The only workout-create path that does not use `runWithOfflineFallback`, so an offline save fails instead of queueing.                                                                                                                                                                                     | Wrap it like `useSaveWorkoutMutation`, if offline logging from this sheet is wanted.                                                                           |
| D7  | `server/services/trainingOverviewLoader.ts:18,168`                                                                         | The load window is anchored on `todayUtcYyyyMmDd()` when no `to` is given. This is the H11 class of bug: near midnight the athlete's day and the server's differ. The helper is also written so the UTC-today lint rule cannot see it.                                                                          | Use the athlete-local date the callers already resolve.                                                                                                         |
| D8  | `server/routes/nutrition/*.routes.ts` (11 calls)                                                                           | These routes call the throwing `getLocalDateStr`. A stored timezone the runtime rejects gives a 500. `PATCH /preferences` validates new values, so only legacy rows or a zone the runtime has dropped are exposed.                                                                                           | `getLocalDateStrSafe` (`server/timezone.ts:176`) already exists.                                                                                                |

---

## Verified, deferred refactors

All are behaviour-preserving in intent, and all were confirmed in the current code. They were
deferred for one of three reasons: they need tests that do not exist yet, they touch a lot of
code for the gain, or they are cosmetic. They are ranked by how much risk they remove, not by
size.

### Worth doing next

| #   | Where                                                                                                                                                                             | What                                                                                                                                                                                                                                                  | Why it matters / coverage                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | `server/emailScheduler.ts:159,212,271,379,432,542`                                                                                                                                | Six copies of `void sendPushToUser(…).catch(…)`, the C1 crash guard. Five opt-in/refetch preambles are near-identical too.                                                                                                                             | A new email kind that copies the call without `.catch` brings back a process crash (C1). The test at `emailScheduler.test.ts:891` says "three" sites and pins three. A `sendPushDetached(userId, payload, label)` helper removes the trap. |
| R2  | `server/storage/users.ts:735-825`                                                                                                                                                 | Seven claim-ledger methods (`claimWeeklySummary` … `claimAnalysisDigest`) differ only in the column name.                                                                                                                                             | Each method names its column three times, so a mixed-up copy double-sends or suppresses that email or push. Tests cover two of the seven. Consolidate into a private `claimLedger(column, …)` and add a test that renders its WHERE clause.                       |
| R3  | `server/storage/analytics.ts:334-363` `getDueSessionCount`                                                                                                                        | Hand-writes the declared-absence `NOT EXISTS` that `absenceDeclaredForPlanDay` (`absenceGuard.ts:75`) already builds, byte for byte.                                                                                                                  | This count is the Avg Adherence denominator (H10), and it is covered only by mocked tests. Use `not(absenceDeclaredForPlanDay(db, userId))`.                                                                          |
| R4  | `server/cron.ts:43-67`, `server/services/keyRotation.ts:13`, `server/maintenance.ts:32`                                                                                           | Advisory-lock keys live in three files. The uniqueness test covers only `CRON_LOCK_KEYS`. The two outside keys are tracked by a hand-written comment that says a collision is silent.                                                                     | Move every key into one registry and test its uniqueness.                                                                                                                                  |
| R5  | `coachInsightsService.ts`, `nutritionInsightsService.ts`, `overviewAnalysisService.ts`, `racePredictionService.ts`                                                                | Four copies of the AI gate (disabled / consent / budget), with three identical `…BlockedReason` unions.                                                                                                                                                | Only the race-prediction copy is tested. Consolidate into `resolveAiBlocker()` in `aiUsageService`.                                                                                                  |
| R6  | `strava.ts:140,379,520,624`, `offClient.ts:191`, `usdaClient.ts:249,295`, `nutrition/utils.ts:46`; `strava.ts:88`, `stravaWebhook.ts:448`, `emailUnsubscribeToken.ts:81`, `routes/email.ts:41`, `routes/analytics.ts:90` | Eight hand-written "429/5xx → `RetryableHttpError`" branches, and five copies of sha256 + `timingSafeEqual`.                                                                                                                                         | A shared constant-time compare is the kind of code that should exist once. Add `throwIfRetryableStatus()` and `safeEqualDigest()`.                                                                            |

### Consolidation, moderate payoff

- **Training-load inputs.** `calculateTrainingLoad`'s athlete options are assembled at seven
  call sites. `dailyLoad.ts` repeats its four-query fetch in two functions, although its comment
  says "exactly one place".
- **Cron scheduling.** 11 of the 15 jobs in `server/cron.ts` inline the shape of
  `scheduleLockedCronJob`, and 15 task variables are stopped by hand.
- **`server/gemini/suggestionService.ts`** has three near-identical pairs (prompt, generate,
  parse). The review-notes side is untested.
- **Vision calls.** `exerciseParser/provider.ts` re-implements `callGeminiVisionJson`
  (`nutrition/visionParsing.ts`). These are the only production users of the re-export shim in
  `gemini/client.ts`.
- **Label sanitising.** The "`&` → `and`" sanitiser exists five times across the AI services,
  and `resolveGeneratedConfidence` duplicates `resolveConfidence` (`mapping.ts`).
- **`coachService.ts`** re-implements `buildReviewNotes`, `aiSuggestionService.ts` duplicates
  `toUpcomingWorkout`, and the RAG-over-legacy rule is rendered three times.
- **Stored analysis reads.** Four "stored analysis first" GET handlers (`ai.ts` ×2,
  `analytics.ts`, `nutritionInsights.routes.ts`) could share a `readStoredAnalysis` helper.
- **Route wiring.** The exercise-set use case is wired identically in `routes/plans.ts` and
  `workoutsCrud.routes.ts`.
- **AI guards.** Ten `ai.ts` routes pass `aiConsentCheck`/`aiBudgetCheck` as middleware, while
  14 routes use the builder's `aiConsent: true`. The middleware style skips the builder's
  "AI guards require auth" check.
- **Near-duplicate helpers:**
  - `resolveUserToday` exists in `storage/plans.ts:536` and `storage/timeline.ts:437`, with a
    near copy in `planGenerationService.ts:888`.
  - `ownsPlanDay` exists twice with the same SQL and opposite parameter order
    (`storage/workouts.ts:797`, `storage/recycleBin.ts:101`).
  - Clerk's `getAuth` try/catch is written four times.
- **`emailTemplates.ts`** re-implements `pluralSuffix` three times and shadows it once. Its
  weekly-summary button duplicates `ctaButton()`. Snapshots pin the output, so a merge is safe
  to verify.
- **Client helpers:**
  - Two private `isTimeoutLikeError` copies duplicate the exported `isTimeoutLikeApiError`.
  - Two `extractApiErrorCode` implementations; duplicated photo-parse, AI-limit and
    `PLAN_OVERLAP` toasts.
  - The food-log invalidation set is written five times in `useNutrition.ts`.
  - `format(new Date(), "yyyy-MM-dd")` appears at about 16 sites where `getTodayString()`
    exists.
  - `useMoveTimelineEntry` re-implements `buildOptimisticTimelineHandlers`.
  - The annotation-delete mutation is duplicated in `useTimelinePageController`.
  - The 30-field draft `ExerciseSet` literal is written twice (`AdhocLogSheet`,
    `DraftExerciseTable`).
- **Client components:**
  - Sheet title and action markup repeats across LogSheet, ReviewSurface, SkippedSheet and
    PreviewSheet.
  - Coverage analysis is duplicated between `MuscleHeatMapCard` and `CategoryBreakdownTab`,
    with day thresholds hardcoded instead of using `STALE_AFTER_DAYS`/`WATCH_AFTER_DAYS`.
  - A `MoveEntryMenu` could be extracted from `TimelineWorkoutCard`; its move rules are
    untested.
  - A `useImagePreview` hook would serve both `PrescriptionEditor` and `WorkoutComposer`.
  - Analytics tabs repeat empty states and formatters.

### Small or cosmetic

- **Numeric helpers.** `median` has three byte-identical copies (`unitSwitchDetection.ts:65`,
  `loadAnchors.ts:48`, `runPace.ts:40`), plus `clamp` ×4 and `round1` ×3. This is a dedupe, not
  a bug: the 2026-09-04 verification found that the copies do not diverge.
- **Epley 1RM** is computed on the server (`analyticsService.ts:54`) and again on the client
  (`nextTarget.ts:56`). `PersonalRecordsTab` also hardcodes the "2-10 reps" range.
- **Date arithmetic.**
  - Monday-of-week is computed four ways, and `addDaysLocal` duplicates `addDaysToISODate`.
  - `dateRange` (`trainingLoad/utils.ts:54`) has no guard against a malformed bound, unlike
    `eachDate` (`nutrition/blockView.ts:21`). All current callers pass server-computed dates;
    they were not traced to an input that could reach it.
- **Import cycle.** `EMBEDDING_DIMENSIONS` keeps the cycle
  `storage → coaching → gemini/client → aiUsageService → storage` alive. The 07-19 analysis
  proposed moving it to `constants.ts`.
- **Training styles.**
  - `TrainingStyleStrategy` declares `computeProfile`, `analyzeWorkout`, `phaseLogic` and
    `safetyRules` (`training_styles/types.ts:11-15`), and nothing calls them. Yet
    `docs/new-training-style-checklist.md` tells authors to implement them. Either wire them up
    or drop them and correct the checklist.
  - `prescribeNext` is the identity function for both styles.
- **Exported only for tests:**
  - `decideMatch` (`deviceActivityMatcher.ts:431`), `persistRacePrediction`
    (`analyticsPersistence.ts:127`), `planWeekForDisplay` / `isPlanEnded`.
  - `saveLogWorkoutDraftFromTimelineEntry`; its comment says it is planned.
  - `getContextLogger`, which has no callers.
  - Re-exports from the `trainingLoadService` and `nutrition/rollup` barrels.
- **Unreachable code:**
  - the `"plan_overlap"` restore reason;
  - the legacy-import allow-list branch in `structuredWriteGuard.ts`;
  - the `normalized.exercises ?? rawArray` fallback in the exercise parser (×8).
- **Naming and parsing:**
  - `MAX_PLAN_WEEKS = 52` in `planService.ts:104` (a limit on CSV-import span) shadows the
    shared `MAX_PLAN_WEEKS = 24` (a limit on generation length). Rename the import one.
  - `main.tsx:26` parses its feature flag with `=== "true"`, while `featureFlags` also
    accepts `1`/`yes`.
- **Configuration.** `process.env` is read outside `env.ts` in `bootstrap/observability.ts` and
  `index.ts`.
- **Lint warnings.** `max-lines` and complexity warnings remain; the lint gate fails only on
  errors.

---

## Checked and dropped

Recorded so they are not raised again:

- **`void idempotencyMiddleware(...)` in `routeGuards.ts`.** It looks like the C1 crash
  pattern, but every await inside it is already caught, so it cannot reject.
- **All 41 `NutritionStorage` bindings.** They have production callers. The nutrition barrel's
  test-only re-exports are pinned by the partition test on purpose.
- **Restated unit factors in `unitSwitchDetection.ts`.** They are documented as deliberate. The
  SQL source mapping and `resolveCounterSource` agree for every value that can occur.
- **Converting `usePlanImport`'s seven raw `useMutation` calls to `useApiMutation`.** This is
  not behaviour-preserving: it adds `humanizeApiError` descriptions and delays toasts until the
  refetch finishes.
- **Out of scope by decision:** Garmin credential custody (an owner decision, per the
  [2026-09-19 security audit](SECURITY_AUDIT_2026-09-19.md)) and the "⚡ Bolt" comments (left in
  place, per the [2026-08-31 analysis](CODEBASE_ANALYSIS_2026-08-31.md)).

## Coverage and limits

- `shared/` was read where server or client code led into it. `script/` was reviewed only for
  the backfill script, and `cypress/` only for the testing docs.
- Nothing here was run against production data or a deployed instance. The fixes are verified
  by unit and integration tests, typecheck, lint and a production build.
- Prettier is not enforced in CI, and about 800 files do not match it. Edits follow the style
  of the code around them rather than reformatting whole files.
- Mermaid diagrams edited in `architecture.md` were checked by reading only; no Mermaid renderer
  is installed in the repo.
