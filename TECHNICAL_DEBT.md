# Technical Debt Registry

> Living document cataloging known technical debt in the Hyrox-Companion codebase.
> Last audited: 2026-04-05

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

- ~~**7. Replace Proxy-based storage abstraction**~~ — Replaced with explicit `DatabaseStorage` class delegating ~60 methods.
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
- ~~**25. Strict mode disabled in test TypeScript config**~~ — Enabled `strict: true` in `tsconfig.test.json`. Tests now enforce the same type safety as production code.

### 14. Centralize magic numbers and constants
- **Files:** `client/src/components/plans/GeneratePlanDialog.tsx`, `client/src/hooks/useChatSession.ts`, `server/services/workoutService.ts`
- **Issue:** Configuration values are defined locally in individual files.
- **Status:** On review, these constants are correctly colocated with their usage (plan constants in plan dialog, chat limits in chat hook, concurrency in workout service). Moving to a shared file would be over-engineering. Downgraded to no-action.

- ~~**16. Improve test type safety**~~ — Created `test/factories.ts` with 5 typed mock factories. Refactored `workouts.test.ts` (7 casts), `planService.test.ts` (5 casts), `useWorkoutActions.test.tsx` (13 `TimelineEntry` casts via `createMockTimelineEntry`), and `useWorkoutForm.test.tsx` (4 voice-handler `as any` casts). Remaining casts are intentional (mocking framework APIs like `Response`/hook returns, or testing deliberately invalid data).

---

## P3 — Low Priority / Ongoing

- ~~**24. Hardcoded CORS origins**~~ — Moved to `ALLOWED_ORIGINS` env var with backward-compatible fallback.
- ~~**26. Silent data loss in offline mutation queue**~~ — Added `onMutationDropped` callback with `useOfflineDropNotifier` hook showing destructive toast on data loss.
- ~~**27. No route guards for authenticated pages**~~ — Added auth loading guard in `App.tsx` showing spinner while auth state loads.
- ~~**28. Full pdfjs-dist namespace import**~~ — Changed to targeted `{getDocument, GlobalWorkerOptions}` import.

- ~~**19. Resolve dependency security overrides**~~ — Documented all 4 overrides with CVE/GHSA IDs, parent dependency info, and removal conditions. Fixed esbuild range inconsistency. Found `serialize-javascript` is removable now, `undici` safe to remove on next lockfile regen.

- ~~**20. Persistent rate limiter**~~ — Documented limitation and Redis upgrade path in `server/routeUtils.ts`. Acceptable for single-instance Railway deployment.

- ~~**21. Improve PWA offline strategy**~~ — Added Workbox runtimeCaching: NetworkFirst for API (10s timeout), CacheFirst for fonts (1yr), StaleWhileRevalidate for images (30d).

### 22. CSRF protection assessment
- **Files:** `server/index.ts`, `server/clerkAuth.ts`
- **Issue:** The app uses cookie-based auth (`credentials: "include"`) via Clerk, which is CSRF-vulnerable in principle.
- **Mitigations already in place:** CORS with explicit origin allowlist rejects cross-origin requests. Clerk uses SameSite cookies by default. CSP with nonce prevents inline script injection.
- **Remaining risk:** Low. A same-site CSRF attack would require XSS first (mitigated by CSP). Consider adding `csrf-csrf` middleware if the threat model changes.
- **Status:** Documented. No immediate action needed.

- ~~**23. Performance optimizations**~~ — Added 120s-TTL in-memory cache for RAG retrieval in `server/services/ragService.ts` (keyed by userId+query+topK, invalidated on `embedCoachingMaterial`). Debounced auto-coach via pg-boss `singletonKey: auto-coach:${userId}`/`singletonSeconds: 60` in `server/services/workoutService.ts` so bulk workout creation coalesces into a single coach run per user.

---

## Summary

| Priority | Resolved | Remaining | Notes |
|----------|----------|-----------|-------|
| P0 — Quick Wins | 6/6 | 0 | All resolved |
| P1 — High | 6/6 | 0 | All resolved |
| P2 — Medium | 6/6 | 0 | All resolved |
| P3 — Low | 9/10 | 1 | #22 (CSRF) documented as acceptable — low risk, no action needed |
| **Total** | **27/28** | **1** | Only #22 remains, documented as acceptable under current threat model |
