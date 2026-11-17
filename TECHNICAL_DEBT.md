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

- **30. Migration reviews treat a NULL owner as shared** — Confirmed. `listBackfillReviews`
  matches `user_id = me OR user_id IS NULL` (`server/services/assistedMigrationService.ts:161`),
  so a review row with no owner is returned to every signed-in athlete by
  `GET /api/v1/workouts/migration/reviews`, and `upsertReviewFlag` accepts a null `userId`.
  The foreign key was already switched to `ON DELETE CASCADE` for this reason
  (`shared/schema/tables.ts`, comment on `structuredExerciseBackfillReviews.userId`); the
  query still has the branch. Whether such rows exist in production was not checked.
- **31. Any `planDayId` bypasses the text-only write guard** — Confirmed.
  `rejectTextOnlyWriteIfNeeded` returns early for any non-empty `planDayId` string, before
  ownership is checked (`server/routes/structuredWriteGuard.ts:73-76`), and `createWorkout`
  skips the legacy parse on the same raw value (`server/services/workoutUseCases.ts:123`).
  A plan day that is not the caller's is then dropped, leaving a text-only, unlinked log.
- **32. Shared custom foods expose their author's user id on two paths** — Confirmed.
  `redactFoodOwner` runs on search, recent and food detail only
  (`server/routes/nutrition/nutritionFoods.routes.ts:66,78,131`).
  `GET /api/v1/nutrition/favorites` (`nutritionFavorites.routes.ts:19`) and the `food` object
  on `/parse/text` and `/parse/photo` items (`server/services/nutrition/mealParser.ts:140-157`)
  return the row unredacted.
- **33. RAG excerpts carry no "data, not instructions" framing** — Confirmed.
  `buildRetrievedChunksSection` (`server/prompts/materialsBuilder.ts:47-60`) escapes each
  excerpt and tells the model to use them to guide its coaching; other athlete-supplied text
  is labelled as data (for example `server/prompts/chatPhoto.ts:14`). Uploaded material is the
  largest athlete-controlled text in the prompt.
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

- **36. `RAG_CHUNK_SIZE` has no lower bound** — Confirmed. The schema is
  `z.coerce.number().default(600)` (`server/env.ts:150`); with `0` or a negative value
  `chunkText()` never advances (`server/services/ragService.ts:85-121`) and the embed job
  spins. `RAG_CHUNK_OVERLAP` is unbounded too, though the loop guards that case.
- **37. An empty plan-day PATCH body probably returns 500** — Reported.
  `PATCH /api/v1/plans/days/:dayId/status` with `{}` or only `{ skipReason }`, and
  `PATCH /api/v1/plans/:planId/days/:dayId` with `{}`, reach `storage.plans.updatePlanDay`
  with nothing to set (`server/services/planService.ts:793-805`, `server/storage/plans.ts:455-458`).
  drizzle throws "No values to set" there; the workout PATCH already guards the same case
  (`server/services/workoutService/workouts.ts:443-447`).
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
- **40. Per-user AI budget lookups fail open in five inline generators** — Confirmed. Coach
  insights (`server/services/coachInsightsService.ts:109`), overview analysis
  (`overviewAnalysisService.ts:447`), nutrition insights
  (`nutrition/nutritionInsightsService.ts:145`), race prediction
  (`racePrediction/racePredictionService.ts:435`) and the structured apply
  (`aiSuggestionService.ts:264`) log a failed lookup and make the provider call. The
  middleware and the auto-coach job fail closed. The nightly recompute goes through these.
- **41. Food-embedding spend is not counted** — Confirmed.
  `server/services/nutrition/foodEmbeddings.ts` calls `generateEmbeddings` without
  `trackEmbeddingUsage`, so the embedding cron is neither counted against
  `AI_GLOBAL_DAILY_LIMIT_CENTS` nor recorded in `ai_usage_logs`.
- **42. The Clerk profile is fetched once** — Confirmed. `ensureUserExists` copies name,
  email and image from Clerk only when it creates the row (`server/clerkAuth.ts:257-269`); a
  failed fetch is logged and never retried (`:304-309`). That athlete has no email on file, so
  `getUsersWithEmailNotifications` skips them for good, and later changes in Clerk are not
  synced either.
- **43. `POST /api/v1/weekly-review/intent` validates `week` by shape only** — Confirmed.
  `weeklyReviewIntentSchema` uses `dateStringSchema` (`shared/schema/types/requests.ts:74-75`)
  where the GET uses `isWeekParamValid` (`server/routes/analytics.ts:125`), so `2026-02-31` is
  accepted and lands in the week of 2 March.
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
- **51. The offline queue flushes on `online` without the owner check** — Confirmed. The
  `online` listener calls `flushQueue()` directly (`client/src/lib/offlineQueue.ts:526-534`);
  the timer and focus retries go through `retryPendingWrites()`, which waits for
  `reconciledOwner` (`:207-212`).

### Client and UX

- **52. The desktop sidebar can be hidden with no visible way back** — Confirmed. Ctrl/Cmd+B
  toggles it and a 7-day cookie remembers the choice (`client/src/components/ui/sidebar.tsx`),
  but the only `SidebarTrigger` is in a header that is `md:hidden` (`client/src/App.tsx:198-199`).
  `--sidebar-width-icon` (`App.tsx:178`) is unused.
- **53. No breadcrumb label for Nutrition or Weekly Review** — Confirmed. `ROUTE_LABELS`
  lacks both routes (`client/src/components/Breadcrumbs.tsx:10-17`).
- **54. Service worker updates have no prompt** — Confirmed. `registerType: "prompt"`
  (`vite.config.ts:38`) with an empty `onNeedRefresh` (`client/src/main.tsx:61-63`): a new
  build activates only once every tab is closed.
- **55. Garmin rate-limit messages do not reach the athlete** — Reported. The server's `429`
  "wait N more minutes" and `503` circuit-open messages are not shown, and Sync stays enabled
  while the circuit is open.
- **56. Feature error boundaries send no feature tag** — Confirmed.
  `FeatureErrorBoundaryWrapper` takes `featureName` but passes nothing to
  `Sentry.ErrorBoundary` (`client/src/components/FeatureErrorBoundaryWrapper.tsx:20`).
- **57. Two messages describe the wrong thing** — Confirmed. The offline drop toast says
  "discarded after too many failed attempts" for every reason, including `max_age` and
  `wrong_account` (`client/src/components/ui/OfflineIndicator.tsx:79`). The micronutrient
  empty state says to "re-search a food" (`client/src/pages/nutrition/MicronutrientPanel.tsx:21`);
  the backfill happens when a USDA food's detail is opened.
- **58. Weekly review shows deltas for a week still in progress** — Confirmed.
  `client/src/components/review/WeeklyReviewSummary.tsx:62-68,97-104` renders the session and
  duration deltas whatever `isCurrentWeek` is; `docs/weekly-review-spec.md` §6.5 asks for
  none. The streak, coldest station and training-load delta scoped in §2 were never built.
- **59. The web fuelling chip estimates locally** — Confirmed.
  `client/src/components/timeline/timeline-workout-card/FuellingTargetChip.tsx` calls
  `estimatePlannedSession` and never reads the API's `sessionEstimate`, so the chip and the fuelling panel can disagree.
- **60. The PWA theme colour is the superseded lime** — Confirmed. `theme_color: "#C4F37E"`
  in `vite.config.ts:57`; the stylesheet, the logo files, the Android app and (since
  2026-11-17) `docs/BrandKit/BRAND.md` use `#B1F584`. The designed PDF in `docs/BrandKit/`
  also still prints `#C4F37E` and needs re-exporting from its source.

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
- **66. `mobile.yml` runs on a push that touches `mobile-release.yml` but not on a pull
  request that does** — Confirmed (`.github/workflows/mobile.yml`, the two `paths` lists).
- **67. `sonar-project.properties` declares a much narrower test set than
  `.sonarcloud.properties`** — Confirmed
  (`sonar.tests=client/src/hooks/__tests__,server/routes/__tests__`). It would misclassify
  tests if the CI scanner were switched back on.
- **68. `pnpm/action-setup` is labelled two ways** — Confirmed. All eight uses pin the same
  commit; `build.yml`, `openapi-breaking.yml` and the second job in `migrations.yml` comment
  it `# v4`, the rest `# v6.1.1`.
- **69. `script/coach-memory-usage.ts` cannot measure the athlete card** — Confirmed. It has
  no query on `athlete_facts`, though its header still calls it the gate for that decision.
- **70. No test pins the middleware order** — Reported. `docs/adr-startup-pattern.md` names
  such a test as the precondition for changing the order.

### Stale code comments

- **71. Comments that no longer match the code beside them** — each Confirmed unless marked.
  - `shared/units.ts:22-25` — the example said not to compile does compile; `:39` names a
    column, `maf_test_results.duration_seconds`, that does not exist.
  - `server/routes/account.ts:14-18` — lists 13 cascading tables as if complete; about 30
    cascade from `users`.
  - `server/queue.ts:78-83` — says the "sent" marker is persisted after the send; claims are
    taken before it.
  - `server/emailScheduler.ts:82` and `:629` — "daily cron" / "once-daily cron"; the scan is
    hourly.
  - `server/cron.ts:168` — idempotency rows "have a 24h TTL"; it is 7 days
    (`server/middleware/idempotency.ts:14`). `server/cron.ts:306-311` names two analytics
    features; the recompute covers four.
  - `server/garmin.ts:81-85` — the 429 breaker freezes Garmin "on this instance"; the trip is
    shared through `server_runtime_cache`.
  - `shared/schema/tables.ts:817-819` — "we re-login when current time passes this value";
    the code re-mints the OAuth2 token from OAuth1.
  - `shared/schema/tables.ts:1851-1852` — the non-manual nutrition entry methods are called
    dormant; they are in use.
  - `shared/schema/nutrition.ts:168-169` — `apiDegraded` is described as "the USDA API was
    unreachable"; it means no provider was reached. `:598-599` — targets are called
    insert-only; a same-day save replaces.
  - `shared/schema/types/users.ts:90-91`, `server/storage/analytics.ts:143-144` — describe
    the training-constraints note and `skipReason` as they were before the athlete card and
    the missed-session flow.
  - `server/services/weeklyProgress.ts:82-83` — says `getMondayWeekBoundaries` anchors to UTC
    and powers the training-overview charts; every caller passes a timezone and the charts
    use `getMonday`.
  - `server/services/nutrition/foodEmbeddings.ts:78` — "mirrors … halfvec cast"; the chunk
    search no longer casts.
  - `server/routes/plans.ts:585-586` — points at a 10 MB parser "in server/index.ts"; it is
    in `server/largeBodyParsers.ts`. `server/middleware/errorHandler.ts:143-145` lists two of
    the five body limits.
  - `server/crypto.ts:28` — "run the re-encrypt job" without naming
    `ENCRYPTION_REENCRYPT_ON_BOOT`, the variable that runs it.
  - `client/src/lib/errorReportingConsent.ts:12,38,44` — "takes effect on the next reload";
    the consent card applies the change at once.
  - `client/src/components/workout-detail/ReviewSurface.tsx:84-86` — the footer list omits
    Combine.
  - `mobile/core/src/commonMain/kotlin/com/fitai/coach/core/structure/StructureLintInput.kt:13`
    — says the create and update requests have no `structureBlocks` field; both do.
  - `mobile/androidApp/src/main/AndroidManifest.xml:9` — "on-device speech recogniser"; the
    default recogniser is used, with no offline preference.
  - `mobile/composeApp/src/commonMain/kotlin/com/fitai/coach/ui/theme/FitaiColors.kt:16-18` —
    says the brand kit lists `#C4F37E` and that nothing renders it; the kit now lists
    `#B1F584`, and the PWA manifest (#60) does render the old value.
  - `.github/workflows/mobile-release.yml:11` — calls its secrets repository secrets; the job
    runs in the `play-store` environment.

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
| Docs verification, 2026-11-17 | 0/42 | 42 | #30–#71, found while checking the docs against the code; none reproduced by running |
| **Total** | **28/71** | **43** | #29 is intentional interim state; #30–#71 are untriaged |
