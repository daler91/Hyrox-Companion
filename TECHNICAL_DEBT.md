# Technical Debt Registry

> Register of the technical-debt items opened in this file. It is **not** the complete list
> of open debt: later audits keep their own open findings, and the ones an owner planning
> work most needs are indexed under [Open items tracked in other documents](#open-items-tracked-in-other-documents)
> below. Resolved items are struck through rather than deleted, and each carries the date and
> evidence of its own resolution, so the register doubles as a record of what was fixed
> and when. Read those per-entry dates rather than looking for a single "last audited"
> stamp at the top — this file carried one for months after it stopped being true, while
> the entries beneath it were being updated. `git log -- TECHNICAL_DEBT.md` is the
> authority on when the file last changed.

---

## ~~P0 — Quick Wins~~ (RESOLVED)

> All P0 items resolved on 2026-04-04.

- ~~**1. Remove unused `aiService.ts` re-export wrapper**~~ — Deleted file, updated 4 importers.
- ~~**2. Move Gemini model names to environment config**~~ — Added to `env.ts` with defaults.
- ~~**3. Replace `console.log` with structured logger**~~ — Not needed: `env.ts` is pre-logger boot (intentional), scripts are standalone CLI tools where console is appropriate.
- ~~**4. Fix weak `isStreamData` type guard**~~ — Added `!Array.isArray` and property existence checks.
- ~~**5. Route all `process.env` access through `env.ts`**~~ — Fixed in 3 production files.
- ~~**6. Consolidate timeout constants**~~ — Already centralized in `server/constants.ts`. No action needed.

---

## ~~P1 — High Priority~~ (6/6 RESOLVED)

- ~~**7. Replace Proxy-based storage abstraction**~~ — Replaced with explicit `DatabaseStorage` class delegating ~60 methods. (Since superseded: `server/storage/index.ts` now composes 17 per-domain classes into the `storage` object, with no delegating class.)
- ~~**8. Fix migration naming conflict + consolidate startup SQL**~~ — `0016_rename_hyrox_station_to_functional.sql` is now in the Drizzle journal (it was missing from the prior fix attempt, so the category rename never actually ran via drizzle-kit). `server/maintenance.ts` startup SQL consolidated into `0018_backfill_plan_dates_and_workout_links.sql`: orphaned plan_day_id cleanup, plan start/end date backfill, and workout log plan_id backfill. Deleted the redundant `ensureSchemaUpToDate()` function (all columns it defensively added are already declared in earlier migrations). Vector-DB setup (`ensurePgvectorExtension`, `ensureVectorSchema`) intentionally remains code-driven since it runs on a separate `vectorPool` that drizzle migrations don't manage.
- ~~**9. Remove legacy RAG path**~~ — Deleted unused `buildRetrievedMaterialsSection` from ragService.ts. Added sanitization to the active `buildRetrievedChunksSection` in prompts.ts.
- ~~**11. Formalize API error codes**~~ — Created `AppError` class with `ErrorCode` enum in `server/errors.ts`. Updated Express error handler. Migrated all service-layer `throw new Error` call sites to `throw new AppError` (planService, planGenerationService, chatService, exerciseParser, strava, sanitize). Startup/invariant errors correctly remain as `Error`.
- ~~**12. Re-enable CI quality gates**~~ — Replaced empty SonarQube job with ESLint + TypeScript checking CI steps.

- ~~**10. Add Drizzle relations, remove manual JOINs**~~ — Added `relations()` definitions for all 10 tables in `shared/schema/tables.ts` (users, trainingPlans, planDays, workoutLogs, stravaConnections, exerciseSets, customExercises, chatMessages, coachingMaterials, documentChunks). Refactored 5 manual-JOIN call sites to `db.query.<table>.findMany({ with: { ... } })`: `PlanStorage.getPlanDay`, `AnalyticsStorage.getMissedWorkoutsForDate`, `TimelineStorage.fetchScheduledDays`, `TimelineStorage.getUpcomingPlannedDays`, and `queryExerciseSetsWithDates` in `storage/shared.ts`. Two complex queries retained as manual SQL (`WorkoutStorage.getWorkoutsWithoutExerciseSets` uses an anti-join, `AnalyticsStorage.getWeeklyStats` uses GROUP BY aggregates). Verified end-to-end by running fresh migrations + test suite + a 15-check smoke test exercising user isolation and result shapes against real Postgres.

---

## ~~P2 — Medium Priority~~ (6/6 RESOLVED)

- ~~**13. Refactor oversized files**~~ — Extracted Timeline.tsx IIFE into `TimelineContent`. Split `server/prompts.ts` (414→285 lines) into `server/prompts/coachingContext.ts` + `server/prompts/materialsBuilder.ts`. Split `client/src/pages/Landing.tsx` (495→50 lines) into `client/src/pages/landing/{useInView,Hero,Features,HowItWorks,ExerciseShowcase,CtaFooter}.tsx`. `sidebar.tsx` is shadcn/ui vendor, left as-is.
- ~~**15. Reduce GeneratePlanDialog state complexity**~~ — Extracted 10 useState calls into `useGeneratePlanForm()` hook.
- ~~**17. Migrate email scheduler to pg-boss queue**~~ — Cron now enqueues per-user `send-weekly-summary` and `send-missed-reminder` jobs. Workers registered in `queue.ts`.
- ~~**18. Propagate request ID / tracing context to service layer**~~ — Added `AsyncLocalStorage`-based `requestContext.ts` with middleware. `getContextLogger()` returns child logger with request context.

### 14. Centralize magic numbers and constants
- **Files:** `client/src/components/plans/GeneratePlanDialog.tsx`, `client/src/hooks/useChatSession.ts`, `server/services/workoutService.ts`
- **Issue:** Configuration values are defined locally in individual files.
- **Status:** On review, these constants are correctly colocated with their usage (plan constants in plan dialog, chat limits in chat hook, concurrency in workout service). Moving to a shared file would be over-engineering. Downgraded to no-action.

- ~~**16. Improve test type safety**~~ — Created `test/factories.ts` with 5 typed mock factories. Refactored `workouts.test.ts` (7 casts), `planService.test.ts` (5 casts), `useWorkoutActions.test.tsx` (13 `TimelineEntry` casts via `createMockTimelineEntry`), and `useWorkoutForm.test.tsx` (4 voice-handler `as any` casts). Remaining casts are intentional (mocking framework APIs like `Response`/hook returns, or testing deliberately invalid data).

---

## P3 — Low Priority / Ongoing

- ~~**24. Hardcoded CORS origins**~~ — Moved to `ALLOWED_ORIGINS` env var with backward-compatible fallback.
- ~~**25. Strict mode disabled in test TypeScript config**~~ — Enabled `strict: true` in `tsconfig.test.json`. Tests now enforce the same type safety as production code.
- ~~**26. Silent data loss in offline mutation queue**~~ — Added `onMutationDropped` callback with `useOfflineDropNotifier` hook showing destructive toast on data loss.
- ~~**27. No route guards for authenticated pages**~~ — Added auth loading guard in `App.tsx` showing spinner while auth state loads.
- ~~**28. Full pdfjs-dist namespace import**~~ — Changed to targeted `{getDocument, GlobalWorkerOptions}` import.

- ~~**19. Resolve dependency security overrides**~~ — Documented all 4 overrides with CVE/GHSA IDs, parent dependency info, and removal conditions. Fixed esbuild range inconsistency. Found `serialize-javascript` is removable now, `undici` safe to remove on next lockfile regen.

- ~~**20. Persistent rate limiter**~~ — Replaced `MemoryStore` with `PostgresRateLimitStore` in `server/routeUtils.ts` (backed by the `rate_limit_buckets` table in `shared/schema/tables.ts`; `server/rateLimitStore.ts` implements the adapter). `MemoryStore` is only used in tests. Multi-replica deployments now share per-user limits.

- ~~**21. Improve PWA offline strategy**~~ — Added Workbox runtimeCaching: NetworkFirst for API (10s timeout), CacheFirst for fonts (1yr), StaleWhileRevalidate for images (30d).

### ~~22. CSRF protection~~ (RESOLVED)
- **Files:** `server/middleware/csrf.ts`, `server/routes.ts`, `server/env.ts`
- **Issue:** The app uses cookie-based auth (`credentials: "include"`) via Clerk, which is CSRF-vulnerable in principle; CORS is not a CSRF control.
- **Resolution:** Double-submit-cookie CSRF protection (`csrf-csrf`) is now enforced on all state-changing `/api/v1` routes. `csrfProtection` (`server/middleware/csrf.ts`) wraps the `csrf-csrf` `doubleCsrfProtection` handler and is mounted on `/api/v1` in `registerRoutes()` (`server/routes.ts`); the token is issued by `GET /api/v1/csrf-token`, mounted just before it, and clients echo it back via the `x-csrf-token` header. Since the native app arrived, the wrapper lets through a request Clerk authenticated from an `Authorization: Bearer` header that carries no session cookie, which another site cannot forge; cookie-authenticated requests are checked exactly as before. The token is bound to the Clerk `userId` session identifier, the cookie is `__Host-`-prefixed with `httpOnly` / `sameSite=strict` / `secure` in production, and `CSRF_SECRET` is required in production and must differ from `ENCRYPTION_KEY` (enforced in `server/env.ts`). Defense-in-depth (CORS allowlist, SameSite cookies, nonce CSP) remains.
- **Status:** RESOLVED. The original "documented as acceptable — no action needed" note was superseded when `csrf-csrf` was implemented; the entry stayed stale until the 2026-05-29 review.

- ~~**23. Performance optimizations**~~ — Added 120s-TTL in-memory cache for RAG retrieval in `server/services/ragService.ts` (keyed by userId+query+topK, invalidated on `embedCoachingMaterial`). Debounced auto-coach via pg-boss `singletonKey: auto-coach:${userId}`/`singletonSeconds: 60` in `server/services/workoutService.ts` so bulk workout creation coalesces into a single coach run per user. (That pair alone is pg-boss's throttle, not a debounce: a later trigger in the same window was dropped. Now `queue.sendDebounced` in `server/services/autoCoachQueue.ts` — AI12, CODEBASE_ANALYSIS_2026-10-03.)

- **29. Dual TypeScript installs (6.x + 7.x side by side)** — OPEN (intentional, blocked on ecosystem)
- **Files:** `package.json` (`typescript` 6.0.3 + `typescript7` npm alias for 7.0.2), `.github/dependabot.yml` (typescript major/minor ignore), `CONTRIBUTING.md` (contributor-facing notes)
- **Issue:** Type-checking runs on the TypeScript 7 native compiler (`check`/`check:strict`/`check:test` invoke `node node_modules/typescript7/bin/tsc`), but the package named `typescript` must stay on 6.0.x because typescript@7 ships no JS compiler API and both typescript-eslint (type-aware linting crashes at module load under TS 7; peer range `<6.1.0`) and Cypress's spec preprocessor (its TS≥7 babel fallback is broken in released binaries ≤15.19.0) resolve that package. This is the interim pattern Microsoft and the typescript-eslint maintainers recommend.
- **Cost:** two TS installs (~one extra native binary per platform at install time), a permanent pnpm warning about the conflicting `tsc` bin, `typescript7` must be bumped manually (Dependabot ignores `npm:` aliases), and editors using the workspace tsserver check with 6.x while CI checks with 7.x.
- **Remove when ALL hold:** (i) TypeScript 7.1 ships its stable API, (ii) typescript-eslint releases TS 7 support (watch typescript-eslint/typescript-eslint#10940), (iii) Cypress ≥ 15.19.1 is published — **satisfied**: the repo is on Cypress 16.3.0, so only (i) and (ii) still block. Then: drop the `typescript7` alias and the 6.0.x pin, set `typescript` to 7.x, restore plain `tsc` in the three check scripts, remove the Dependabot ignore block, and delete the dual-install notes in CONTRIBUTING.md and the `//overrides` guardrail about aliased typescript.

---

## Opened 2026-11-17 — documentation verification pass

Found while every reference doc was checked claim by claim against the code. Nothing here
was reproduced by running the app: each entry is marked **Confirmed** (the cited lines were
read and say what the entry says) or **Reported** (flagged during the pass and not traced
end to end). Where the doc and the code disagreed, the doc was corrected to match the code,
so the docs describe the behaviour below as it is; these entries are the cases where the
behaviour itself looks wrong or unfinished. Line numbers are as of that date.

### Security and data exposure

- ~~**30. Migration reviews treat a NULL owner as shared**~~ — Resolved 2026-11-17.
  `listBackfillReviews` matched `user_id = me OR user_id IS NULL`, so a flag with no owner
  was returned to every athlete by `GET /api/v1/workouts/migration/reviews`. It now matches
  the athlete's own id only, and `upsertReviewFlag` requires an owner. Guarded by
  `server/services/assistedMigrationService.integration.test.ts` (another athlete's flag and
  an ownerless one are not returned). Existing ownerless rows, if any, are now visible to no
  one; they were not deleted.
- ~~**31. Any `planDayId` bypasses the text-only write guard**~~ — Resolved 2026-11-17.
  The guard let through any request carrying a `planDayId` string, and `createWorkout`
  skipped the legacy parse on it, before ownership was checked; a day that was not the
  caller's was then dropped, leaving a text-only, unlinked log. `POST /api/v1/workouts` now
  checks the day belongs to the caller before the guard exempts the write
  (`TextOnlyWriteContext.ownedPlanDayLink` in `server/routes/structuredWriteGuard.ts`), and
  `createWorkout` skips the parse only for an owned day. A foreign or deleted day is treated
  as no link: `422 STRUCTURED_ROWS_REQUIRED` while the gate is on. Guarded by
  `structuredWriteGuard.test.ts`, `workouts.test.ts` and `workoutUseCases.test.ts`.
- ~~**32. Shared custom foods expose their author's user id on two paths**~~ — Resolved
  2026-11-17. `redactFoodOwner` ran on search, recent and food detail only;
  `GET /api/v1/nutrition/favorites` and the `food` on `/parse/text` and `/parse/photo` items
  returned the author's id. It now lives in `server/routes/nutrition/shared.ts` and those
  routes use it too (`redactParsedFoodOwners` for the parse items). No other nutrition
  response carries a whole food row. Guarded by `nutrition.routes.test.ts`.
- ~~**33. RAG excerpts carry no "data, not instructions" framing**~~ — Resolved 2026-11-18.
  Uploaded coaching material was escaped but, unlike the athlete's own message, not framed
  as data. Both builders in `server/prompts/materialsBuilder.ts` (the RAG path and the
  full-text fallback) now wrap each piece in a `<coaching_material>` tag the escaped text
  cannot close, and tell the model to treat it strictly as data
  (`COACHING_MATERIALS_ARE_DATA`). Guarded by `materialsBuilder.test.ts`.
- **34. Dev auth bypass stays active alongside Clerk keys** — Reported. In development or test
  with `ALLOW_DEV_AUTH_BYPASS=true` and both Clerk keys set, a request without a valid Clerk
  session runs as `dev-user` unless it sends `x-test-no-bypass: true`
  (`server/clerkAuth.ts:86-125`). Not reachable in production.
- **35. Training-style fields are stored as the client sends them, and style history is never
  written** — Confirmed. `trainingStyleId` is any string up to 100 characters
  (`shared/schema/types/users.ts:67`); the previous id and changed-at timestamp come from the
  client (`client/src/pages/settings/usePreferencesForm.tsx`). An unregistered id is stored
  and coached as Balanced. No runtime code writes `user_training_style`: only migration
  `0035` and `script/backfill-user-training-style.ts` insert rows.

### Correctness

- ~~**36. `RAG_CHUNK_SIZE` has no lower bound**~~ — Resolved 2026-11-17. A size of `0` or
  less never advanced `chunkText()`, so the embed job spun. `server/env.ts` now requires
  `RAG_CHUNK_SIZE` to be a positive whole number and `RAG_CHUNK_OVERLAP` a whole number from
  `0` to one less than the size; anything else is fatal at startup. Guarded by
  `server/env.test.ts`.
- ~~**37. An empty plan-day PATCH body returns 500**~~ — Resolved 2026-11-18. Reproduced
  against the real schema: `storage.plans.updatePlanDay` handed an update with nothing to
  write to drizzle's `.set()`, which throws "No values to set", so three PATCH routes
  answered 500. It now returns the owned day unchanged, as the workout PATCH does. Guarded by
  `server/storage/__tests__/planDayEmptyUpdate.integration.test.ts`.
- **38. Reparse edge cases** — (a) Confirmed: the plan-day reparse writes the caller's
  override text whenever the parse returns a result, even when the response is then `422`
  for zero sets (`server/routes/plans.ts:573-577`); the workout reparse saves overrides only on
  success. (b) Confirmed: `planDayReparseBodySchema` has no length cap on `mainWorkout` /
  `accessory` (`shared/schema/types/plansRequests.ts:42-47`); the workout reparse caps each at
  50,000 characters. (c) Reported: a workout reparse that yields structure blocks but no
  accepted rows may replace the log's sets with none and then return `422`
  (`server/services/workoutService/reparse.ts:107-117`).
- **39. An email is lost when its send fails** — Confirmed (by design). Every email worker
  claims its ledger column before sending and the send queues do not retry
  (`server/emailScheduler.ts:89-98`, `NO_RETRY_JOB_OPTIONS` in `server/queue.ts`), so with Resend
  failing or `RESEND_API_KEY` unset the claim is spent and that window's email is never sent.
- ~~**40. Per-user AI budget lookups fail open in five inline generators**~~ — Resolved
  2026-11-17. Coach insights, overview analysis, nutrition insights, race prediction and the
  structured apply logged a failed lookup and made the provider call. None does now: the
  three nightly generators let the error fail the recompute job, which releases its daily
  claim and is retried; race prediction returns its deterministic estimate with
  `aiUnavailableReason: "ai_error"`; the structured apply (timeline-suggestion and
  plan-proposal apply routes) answers `503 AI_BUDGET_UNAVAILABLE`, as the budget middleware
  does, before anything is written. The global spend check still fails open to the per-user
  cap, by design. Guarded by `coachInsightsService.test.ts`,
  `overviewAnalysisService.range.test.ts`, `nutritionInsightsService.test.ts`,
  `racePredictionService.test.ts` and `aiSuggestionService.test.ts`.
- ~~**41. Food-embedding spend is not counted**~~ — Resolved 2026-11-18. The backfill's
  spend belongs to no athlete, and `ai_usage_logs.user_id` was NOT NULL. Migration `0127`
  makes it nullable; `embedMissingFoods` records each batch with no user (feature
  `food_embedding`), which counts toward `AI_GLOBAL_DAILY_LIMIT_CENTS` and no athlete's cap or
  export, and skips the batch once that ceiling is reached (`isGlobalAiBudgetExhausted`,
  which throws rather than spend unconfirmed). Guarded by `foodEmbeddings.test.ts`,
  `aiUsageService.test.ts` and `server/storage/__tests__/aiUsage.integration.test.ts`.
- ~~**42. The Clerk profile is fetched once**~~ — Resolved 2026-11-18. A failed first fetch
  left the row without an email for good, so email notifications skipped that athlete.
  `ensureUserExists` now fetches the profile again while the row has no email, at most once
  an hour per athlete (`PROFILE_RETRY_INTERVAL_MS`, claimed in `server_runtime_cache`).
  Guarded by `server/clerkAuth.test.ts`. Not in scope: a row that has an email still does
  not pick up later changes made in Clerk; that needs Clerk's webhooks.
- ~~**43. `POST /api/v1/weekly-review/intent` validates `week` by shape only**~~ — Resolved
  2026-11-18. `weeklyReviewIntentSchema` now uses `calendarDateSchema`, the GET's
  `isIsoCalendarDate` check, so `2026-02-31` is a `400 VALIDATION_ERROR` instead of an intent
  written to the week of 2 March. Guarded by `server/routes/__tests__/analytics.test.ts`.
- **44. Repeating a nutrition day stamps noon UTC** — Confirmed.
  `POST /api/v1/nutrition/logs/repeat` writes `${targetDate}T12:00:00Z` under a comment that
  says "local noon" (`server/routes/nutrition/nutritionLogs.routes.ts:116-118`). `logDate` is
  set explicitly, so the day is right; the instant can fall on another local day far from UTC.
- **45. Workout list ordering has no tiebreaker** — Confirmed. `listWorkoutLogs` orders by
  `date` alone (`server/storage/workoutLogReads.ts:37`), so `GET /api/v1/workouts/latest` and
  page boundaries are arbitrary among logs on the same day.
- **46. Combine checks the new workout's date less strictly than create does** — Reported.
  `POST /api/v1/workouts/combine` validates `newWorkout.date` with the schema only; create
  and update also refuse a date past the athlete's own tomorrow
  (`server/services/workoutUseCases.ts:101-108`).
- **47. `document_chunks` declares foreign keys the real table does not have** — Confirmed.
  `shared/schema/tables.ts` declares cascading keys to `coaching_materials` and `users`;
  `ensureVectorSchema()` creates the table without them (`server/maintenance.ts:188-198`).
  Deletes are explicit today. `drizzle-kit generate` would emit the keys if the table ever
  left its no-op migrations.
- **48. `APP_INSTANCE_COUNT` is dead configuration** — Confirmed. Validated in
  `server/env.ts:136`, read by no code. Remove it or give it a job.
- **49. The v1 encryption key cannot be retired** — Reported. `ENCRYPTION_KEY` is required by
  the schema and `ENCRYPTION_KEY_V2` must differ from it, so the rotation procedure in
  `docs/env-reference.md` has no supported end state in which the old key is removed.
- **50. Unit brands stop at the storage boundary** — Reported. `MafTestMetrics` and the
  Drizzle rows are plain `number`, so assigning minutes to `durationSeconds` still compiles;
  and rule 4 of `docs/adr-units.md` ("required, not defaulted") is not met by
  `server/prompts/exerciseSetFormatter.ts`, whose `weightUnit` is optional and falls back to kg.
- ~~**51. The offline queue flushes on `online` without the owner check**~~ — Resolved
  2026-11-18. The `online` listener now goes through `retryPendingWrites()`, like the timer
  and focus retries, so a reconnect before the signed-in athlete's reconcile (or after a
  sign-out without a reload) no longer replays the previous athlete's queue. Guarded by
  `client/src/lib/offlineQueue.test.ts`.

### Client and UX

- ~~**52. The desktop sidebar can be hidden with no visible way back**~~ — Resolved
  2026-11-18. The header with the `SidebarTrigger` moved to `client/src/components/AppHeader.tsx`,
  which still always shows below md and now also shows on desktop while the sidebar is
  collapsed, so Ctrl/Cmd+B or the week-long cookie can no longer strand it. The unused
  `--sidebar-width-icon` override is gone. Guarded by
  `client/src/components/__tests__/AppHeader.test.tsx`.
- ~~**53. No breadcrumb label for Nutrition or Weekly Review**~~ — Resolved 2026-11-18.
  `ROUTE_LABELS` has `/nutrition` and `/review`. Guarded by
  `client/src/components/__tests__/Breadcrumbs.test.tsx`.
- **54. Service worker updates have no prompt** — Confirmed. `registerType: "prompt"`
  (`vite.config.ts:38`) with an empty `onNeedRefresh` (`client/src/main.tsx:61-63`): a new
  build activates only once every tab is closed.
- **55. Garmin rate-limit messages do not reach the athlete** — Reported. The server's `429`
  "wait N more minutes" and `503` circuit-open messages are not shown, and Sync stays enabled
  while the circuit is open.
- **56. Feature error boundaries send no feature tag** — Confirmed.
  `FeatureErrorBoundaryWrapper` takes `featureName` but passes nothing to
  `Sentry.ErrorBoundary` (`client/src/components/FeatureErrorBoundaryWrapper.tsx:20`).
- ~~**57. Two messages describe the wrong thing**~~ — Resolved 2026-11-18. The sync-complete
  event counts how many drops expired (`expired`), and the summary toast names each reason
  (more than 7 days queued, or too many failed attempts); the other drop reasons never
  reach that toast and keep their own. The micronutrient empty state now says opening a USDA
  food to log it fetches its micronutrients. Guarded by `client/src/lib/offlineQueue.test.ts`,
  `client/src/components/ui/__tests__/OfflineIndicator.a11y.test.tsx` and
  `client/src/pages/nutrition/MicronutrientPanel.test.tsx`.
- **58. Weekly review shows deltas for a week still in progress** — Confirmed.
  `client/src/components/review/WeeklyReviewSummary.tsx:62-68,97-104` renders the session and
  duration deltas whatever `isCurrentWeek` is; `docs/weekly-review-spec.md` §6.5 asks for
  none. The streak, coldest station and training-load delta scoped in §2 were never built.
- **59. The web fuelling chip estimates locally** — Confirmed.
  `client/src/components/timeline/timeline-workout-card/FuellingTargetChip.tsx` calls
  `estimatePlannedSession` and never reads the API's `sessionEstimate`, so the chip and the fuelling panel can disagree.
- ~~**60. The PWA theme colour is the superseded lime**~~ — Resolved 2026-11-18.
  `theme_color` is `#B1F584`, and `test/build/pwaManifest.test.ts` converts it to HSL and
  pins it to the stylesheet's `--accent`. Still open outside the code: the designed PDF in
  `docs/BrandKit/` prints `#C4F37E` and needs re-exporting from its source.

### Android app

- **61. Structure lint never runs in the app** — Confirmed. `LogWorkoutViewModel.kt:322` sends
  `structureBlocks` on `POST /api/v1/workouts` unlinted, and the ported lint has no caller
  under `mobile/composeApp`, so a structure the server will refuse can be queued.
- **62. Coach cues go stale after an optimistic notes edit** — Reported. `TimelineEntry.edited`
  (`core/data/TimelineRepository.kt:357-362`) changes `notes` but keeps the old `coachNotes`,
  which the entry prefers until the next refresh.
- **63. The unit-stamp ports are unused** — Reported. The set editor edits in the row's
  stored unit (`ui/workout/ExerciseGroups.kt:215,220`) instead of the preference unit with
  `restampSetPatch`, as the web does.
- **64. No Baseline Profile is committed** — Confirmed. Release builds read the profile
  from `androidApp/src/release/generated/baselineProfiles` (`mobile/androidApp/build.gradle.kts`);
  that directory does not exist, so they ship without one.

### CI and tooling

- **65. SonarCloud may not be evaluating coverage** — Reported. Under Automatic Analysis no
  lcov report is uploaded, so "Coverage on New Code" may never be computed.
- ~~**66. `mobile.yml` runs on a push that touches `mobile-release.yml` but not on a pull
  request that does**~~ — Resolved 2026-11-18. The pull-request paths now match the push
  paths. Guarded by `test/build/workflowPaths.test.ts`, which compares the two lists for
  every workflow that filters both.
- **67. `sonar-project.properties` declares a much narrower test set than
  `.sonarcloud.properties`** — Confirmed
  (`sonar.tests=client/src/hooks/__tests__,server/routes/__tests__`). It would misclassify
  tests if the CI scanner were switched back on.
- ~~**68. `pnpm/action-setup` is labelled two ways**~~ — Resolved 2026-11-18. The pinned
  commit is tag v6.1.1, and all eight uses now say so. Guarded by
  `test/build/workflowPins.test.ts`: every pin of one commit must name one release.
- **69. `script/coach-memory-usage.ts` cannot measure the athlete card** — Confirmed. It has
  no query on `athlete_facts`, though its header still calls it the gate for that decision.
- **70. No test pins the middleware order** — Reported. `docs/adr-startup-pattern.md` names
  such a test as the precondition for changing the order.

### Stale code comments

- ~~**71. Comments that no longer match the code beside them**~~ — Resolved 2026-11-18. Each
  comment was checked against its code and rewritten: `shared/units.ts` (the example now uses
  a `Seconds`-typed parameter, and says the storage types are unchecked, #50),
  `server/routes/account.ts`, `server/queue.ts`, `server/emailScheduler.ts`, `server/cron.ts`,
  `server/garmin.ts`, `shared/schema/tables.ts` (the Garmin token, the entry methods, and the
  `trainingConstraints` column too), `shared/schema/nutrition.ts`,
  `shared/schema/types/users.ts`, `server/storage/analytics.ts`,
  `server/services/weeklyProgress.ts`, `server/services/nutrition/foodEmbeddings.ts`,
  `server/routes/plans.ts`, `server/middleware/errorHandler.ts`, `server/crypto.ts` (which
  now names `ENCRYPTION_REENCRYPT_ON_BOOT` and points at #49),
  `client/src/lib/errorReportingConsent.ts`, `ReviewSurface.tsx`, `StructureLintInput.kt`,
  the Android manifest and `Speech.android.kt` (the phone's default recogniser),
  `FitaiColors.kt` and `mobile-release.yml`.

---

## Open items tracked in other documents

Later reviews verified these and left them open. They live in their source documents,
which hold the evidence, file references and current status; this index exists so that
planning from this file does not miss them. Listed as of 2026-10-08 (A15,
CODEBASE_ANALYSIS_2026-10-03); check the source before acting.

**[Refactoring review, 2026-09-23](docs/REFACTORING_REVIEW_2026-09-23.md)**

- *Deferred refactors worth doing next* (R1-R6). R1 is a live trap: `server/emailScheduler.ts`
  repeats `void sendPushToUser(…).catch(…)` six times, so a new email kind that copies the
  call without `.catch` brings back the C1 process crash. R2: seven claim-ledger methods
  that differ only by column. R3: a hand-copied absence `NOT EXISTS` behind the adherence
  denominator. R4: advisory-lock keys spread over three files. R5: four copies of the AI
  consent/budget gate (only the race-prediction one is tested). R6: hand-written retryable
  status branches and five copies of the constant-time secret compare.
- *Needs an owner decision* (D1-D11): unit-less max weight/distance in the chat prompt,
  two plan-day PATCH routes that differ on auto-coach, stale `trainingOverview` after a
  device sync, block-type labels, a raw `fetch` in `useMigrationReview`, offline saves from
  the ad-hoc log sheet, a UTC "today" in `trainingOverviewLoader`, throwing timezone calls in
  the nutrition routes, substring station matching, RPE-trend flags the prompt never shows,
  and whether a Garmin 429 should end the connection.

**[Calculation audit, 2026-08-20](docs/CALCULATION_AUDIT_2026-08-20.md)** (left open on purpose)

- M11: logged nutrition joins live to `foods`, so editing a recipe or custom food rewrites
  past days.
- H20: a session's UTSS differs by about 2x depending on whether its sets were typed in.
- L5: `mafHrDataAvailable` is collected and stored but read by no calculation.

## Summary

The counts below cover this file's own numbered entries only; the items indexed above are
not in them.

| Priority | Resolved | Remaining | Notes |
|----------|----------|-----------|-------|
| P0 — Quick Wins | 6/6 | 0 | All resolved |
| P1 — High | 6/6 | 0 | All resolved |
| P2 — Medium | 6/6 | 0 | All resolved |
| P3 — Low | 10/11 | 1 | #22 CSRF resolved via `csrf-csrf` double-submit; #29 dual-TS installs open (blocked on TS 7.1 API + typescript-eslint) |
| Docs verification, 2026-11-17 | 18/42 | 24 | #30–#71, found while checking the docs against the code; #30, #31, #32, #36 and #40 resolved 2026-11-17; #33, #37, #41, #42, #43, #51, #52, #53, #57, #60, #66, #68 and #71 resolved 2026-11-18 |
| **Total** | **46/71** | **25** | #29 is intentional interim state; the other 24 of #30–#71 are untriaged |
