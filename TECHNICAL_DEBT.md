# Technical Debt Registry

> Living document cataloging known technical debt in the Hyrox-Companion codebase.
> Last audited: 2026-04-04

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

## P1 — High Priority (1-3 days each)

- ~~**7. Replace Proxy-based storage abstraction**~~ — Replaced with explicit `DatabaseStorage` class delegating ~60 methods.
- ~~**8. Fix migration naming conflict**~~ — Renamed to `0016_rename_hyrox_station_to_functional.sql`, added to Drizzle journal. Note: `server/maintenance.ts` startup SQL still needs converting to Drizzle migrations (deferred — requires DB testing).
- ~~**9. Remove legacy RAG path**~~ — Deleted unused `buildRetrievedMaterialsSection` from ragService.ts. Added sanitization to the active `buildRetrievedChunksSection` in prompts.ts.
- ~~**11. Formalize API error codes (infrastructure)**~~ — Created `AppError` class with `ErrorCode` enum in `server/errors.ts`. Updated Express error handler. Fixed dynamic logger imports in workoutService.ts. Note: incrementally migrating 28 `throw new Error` to `throw new AppError` is ongoing.
- ~~**12. Re-enable CI quality gates**~~ — Replaced empty SonarQube job with ESLint + TypeScript checking CI steps.

### 10. Add Drizzle relations, remove manual JOINs
- **Files:** `server/storage/*.ts`, `shared/schema.ts`
- **Issue:** Drizzle ORM is used without its relations API. Storage layer has manual SQL JOINs that are verbose, error-prone, and don't benefit from Drizzle's type-safe query builder.
- **Fix:** Define Drizzle relations in the schema and refactor queries to use the relational query API.
- **Effort:** 2-3 days
- **Status:** Deferred — requires DB access for testing.

---

## P2 — Medium Priority (1-2 days each)

- ~~**13. Refactor oversized files (partial)**~~ — Extracted Timeline.tsx IIFE into named `TimelineContent` component. Remaining: sidebar.tsx (775 lines, likely shadcn/ui vendor), prompts.ts (412 lines), Landing.tsx (495 lines).
- ~~**15. Reduce GeneratePlanDialog state complexity**~~ — Extracted 10 useState calls into `useGeneratePlanForm()` hook.

### 14. Centralize magic numbers and constants
- **Files:**
  - `client/src/components/plans/GeneratePlanDialog.tsx` (lines 12-28) — `MAX_WEEKS`, `MIN_WEEKS`, `DEFAULT_WEEKS`, etc.
  - `client/src/hooks/useChatSession.ts` (lines 118-120) — `MAX_HISTORY_MESSAGES`, `MAX_HISTORY_CHARS`
  - `server/services/workoutService.ts` (line 301) — `CONCURRENCY_LIMIT = 5`
- **Issue:** Configuration values are defined locally in individual files. Changes require finding all occurrences.
- **Fix:** Create `shared/constants.ts` for cross-cutting values and domain-specific constant files where appropriate.
- **Effort:** 1 day

### 16. Improve test type safety
- **Files:** 73 occurrences across 23 test files. Worst offenders: `client/src/hooks/__tests__/useWorkoutActions.test.tsx` (17), `server/services/planService.test.ts` (9), `client/src/hooks/__tests__/useWorkoutForm.test.tsx` (8), `server/storage/__tests__/workouts.test.ts` (7).
- **Issue:** `as unknown as` type assertions bypass TypeScript entirely in test mocks. Tests don't catch interface drift, making refactoring risky.
- **Fix:** Create typed mock factories using `vi.fn()` with proper generic types. Use Vitest's `vi.mocked()` helper for typed mock access.
- **Effort:** 2 days

### 17. Migrate email scheduler to pg-boss queue
- **File:** `server/emailScheduler.ts` (171 lines)
- **Issue:** Processes all users synchronously in a cron callback. The app already has pg-boss (`server/queue.ts`) for async job processing, but the email scheduler doesn't use it. Risk of startup race conditions, duplicate sends in clustered deployments, and blocking the event loop.
- **Fix:** Refactor the cron to enqueue one pg-boss job per user. Let pg-boss handle concurrency, retries, and dead-letter.
- **Effort:** 1 day

### 18. Propagate request ID / tracing context to service layer
- **Files:** `server/index.ts` (lines 178-204), service layer files
- **Issue:** `pino-http` already generates request IDs at the HTTP layer, but service-layer functions (storage, AI services, email) don't receive or log request context. Correlating a user-facing error to backend logs requires manual timestamp matching.
- **Fix:** Use `AsyncLocalStorage` to propagate request context. Create a middleware that stores `{ requestId, userId }` and a `getRequestContext()` helper that services can call.
- **Effort:** 1 day

---

## P3 — Low Priority / Ongoing

### 19. Resolve dependency security overrides
- **File:** `package.json` (lines 90-94 and 138-143)
- **Issue:** 4 dependency overrides (`esbuild`, `yauzl`, `undici`, `serialize-javascript`) mask known vulnerabilities. Duplicated in both npm and pnpm override sections. GitHub Dependabot reports 10 vulnerabilities (5 high, 5 moderate).
- **Fix:** Investigate each override, determine if the vulnerability is exploitable in this context, and either upgrade the parent dependency or document the accepted risk. Consolidate duplicate override sections.
- **Effort:** 1 day

### 20. Persistent rate limiter
- **File:** `server/index.ts` (rate limiting setup)
- **Issue:** Rate limiter is memory-backed and resets on every server restart. In a multi-instance deployment, limits are per-instance rather than global.
- **Fix:** Use a Redis-backed store (e.g., `rate-limit-redis`) for shared, persistent rate limiting.
- **Effort:** 1 day

### 21. Improve PWA offline strategy
- **File:** `vite.config.ts` (VitePWA config)
- **Issue:** Service worker only uses precache strategy. No runtime caching, background sync, or intelligent cache invalidation.
- **Fix:** Add Workbox runtime caching strategies (StaleWhileRevalidate for API, CacheFirst for assets) and background sync for offline mutations.
- **Effort:** 2 days

### 22. Global CSRF protection
- **File:** `server/strava.ts`, `server/index.ts`
- **Issue:** CSRF state tokens are only implemented for Strava OAuth flow, not globally. Other state-changing endpoints rely solely on Clerk auth tokens.
- **Fix:** Evaluate whether SameSite cookies + Clerk tokens provide sufficient CSRF protection, or add a global CSRF middleware.
- **Effort:** 1 day

### 23. Performance optimizations
- **Files:** `server/services/ai/aiContextService.ts`, `server/emailScheduler.ts`, `server/services/workoutService.ts`
- **Issues:**
  - RAG retrieval is not cached between requests — identical context lookups repeat vector searches
  - Auto-coach is triggered per workout instead of batched via cron
  - Email cron processes users synchronously, blocking until all are done
- **Fix:** Add short-TTL cache for RAG results. Batch auto-coach into periodic cron job. Make email cron async with concurrency limits.
- **Effort:** 2-3 days total

### 24. Hardcoded CORS origins
- **File:** `server/index.ts` (lines 65-98)
- **Issue:** Allowed origins include hardcoded domains (`fitai.coach`) and localhost ports. Adding a new domain requires a code change.
- **Fix:** Move allowed origins to environment configuration (comma-separated env var).
- **Effort:** 30 min

### 25. Strict mode disabled in test TypeScript config
- **File:** `tsconfig.test.json` (lines 19-21)
- **Issue:** `strict: false`, `noImplicitAny: false`, `strictNullChecks: false` in the test config. This means tests don't catch type errors that would appear in production code. The 80% coverage threshold in `vitest.config.ts` is undermined because tests can pass with type-unsafe code.
- **Fix:** Enable strict mode in `tsconfig.test.json` to match production settings. Fix resulting type errors in test files (likely related to the `as unknown` casts noted in item #16).
- **Effort:** 1-2 days

### 26. Silent data loss in offline mutation queue
- **File:** `client/src/lib/offlineQueue.ts` (lines 24-26)
- **Issue:** After 5 retries, offline mutations are silently dropped with no user notification. Users may believe their workout data was saved when it was actually lost.
- **Fix:** Add a callback/toast notification when mutations are permanently dropped. Consider increasing retry count or adding a manual retry UI.
- **Effort:** 1 day

### 27. No route guards for authenticated pages
- **File:** `client/src/App.tsx` (lines 57-69)
- **Issue:** `AuthenticatedRouter` is rendered without proper route-level auth guards. If the auth check fails or is slow, users may briefly see authenticated content.
- **Fix:** Add route-level auth guards or a loading state that prevents rendering protected content until auth is confirmed.
- **Effort:** 1 day

- ~~**28. Full pdfjs-dist namespace import**~~ — Changed to targeted `{getDocument, GlobalWorkerOptions}` import.

---

## Summary

| Priority | Resolved | Remaining | Notes |
|----------|----------|-----------|-------|
| P0 — Quick Wins | 6/6 | 0 | All resolved |
| P1 — High | 5/6 | 1 | #10 (Drizzle relations) deferred — needs DB |
| P2 — Medium | 3/6 | 3 | #14, #16, #17, #18 remaining |
| P3 — Low | 1/10 | 9 | #28 resolved; rest are ongoing/low priority |
| **Total** | **15/28** | **13** | |
