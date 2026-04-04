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

### 7. Replace Proxy-based storage abstraction
- **File:** `server/storage/index.ts` (54 lines)
- **Issue:** Uses a JavaScript `Proxy` to dynamically delegate method calls to sub-storage classes at runtime. This makes debugging difficult (stack traces point to Proxy internals), breaks IDE go-to-definition, requires `eslint-disable` comments, and has a runtime cost for every storage call due to linear delegate scanning.
- **Fix:** Replace with explicit composition — either a class that delegates explicitly, or barrel exports that merge the storage instances. The compile-time `AssertAllKeys` check can remain.
- **Effort:** 1-2 days

### 8. Unify migration system and fix naming conflict
- **Files:** `migrations/` (Drizzle), `server/maintenance.ts` (258 lines of raw startup SQL)
- **Issue:** Two parallel migration approaches: Drizzle migrations in `migrations/` and raw SQL `ALTER TABLE` statements that run on every startup in `server/maintenance.ts`. Additionally, two migration files share the same `0015` prefix (`0015_rename_hyrox_station_to_functional.sql` and `0015_thin_nextwave.sql`), creating ambiguity in ordering. The startup SQL in `maintenance.ts` is brittle — risk of running twice, data loss, or race conditions in clustered deployments.
- **Fix:** Rename one `0015` migration to `0016`. Convert `maintenance.ts` ALTER TABLE logic into proper Drizzle migrations. Remove startup schema patching.
- **Effort:** 2-3 days

### 9. Remove legacy RAG path
- **File:** `server/services/ai/aiContextService.ts`
- **Issue:** Contains both old and new RAG implementations. The legacy path is dead code that increases maintenance burden and confusion.
- **Fix:** Identify and remove the legacy code path. Ensure the new RAG path has full test coverage before removal.
- **Effort:** 1 day

### 10. Add Drizzle relations, remove manual JOINs
- **Files:** `server/storage/*.ts`, `shared/schema.ts`
- **Issue:** Drizzle ORM is used without its relations API. Storage layer has manual SQL JOINs that are verbose, error-prone, and don't benefit from Drizzle's type-safe query builder.
- **Fix:** Define Drizzle relations in the schema and refactor queries to use the relational query API.
- **Effort:** 2-3 days

### 11. Formalize API error codes
- **Files:** Throughout `server/` (28 `throw new Error` instances across 17 files)
- **Issue:** Errors are ad-hoc strings with no structured error codes. API consumers cannot programmatically distinguish error types. Additionally, `server/services/workoutService.ts` (lines 267, 282) dynamically imports the logger inside catch blocks — an anti-pattern that adds latency to error paths.
- **Fix:** Create an `AppError` class with error codes (e.g., `VALIDATION_ERROR`, `NOT_FOUND`, `AI_TIMEOUT`). Add error-code mapping to HTTP status codes in error middleware. Move logger imports to module level.
- **Effort:** 2-3 days

### 12. Re-enable CI quality gates
- **File:** `.github/workflows/build.yml`
- **Issue:** SonarQube manual scan is disabled due to "Automatic Analysis conflict." No automated code quality checks are running in CI.
- **Fix:** Either resolve the SonarQube configuration conflict or replace with an alternative (CodeFactor, Codacy, or ESLint reporting in CI).
- **Effort:** 2-3 hours

---

## P2 — Medium Priority (1-2 days each)

### 13. Refactor oversized files

| File | Lines | Recommendation |
|------|-------|----------------|
| `client/src/components/ui/sidebar.tsx` | 775 | Extract sub-components (SidebarHeader, SidebarNav, SidebarFooter, etc.) into separate files |
| `server/prompts.ts` | 412 | Move prompt templates to separate files under `server/prompts/` directory, organized by feature |
| `client/src/pages/Landing.tsx` | 495 | Extract hero, features, pricing, and footer sections into standalone components |
| `client/src/pages/Timeline.tsx` | 321 | Extract the deeply nested IIFE (lines 109-191) into a `TimelineContent` component |

- **Effort:** 1-2 days total

### 14. Centralize magic numbers and constants
- **Files:**
  - `client/src/components/plans/GeneratePlanDialog.tsx` (lines 12-28) — `MAX_WEEKS`, `MIN_WEEKS`, `DEFAULT_WEEKS`, etc.
  - `client/src/hooks/useChatSession.ts` (lines 118-120) — `MAX_HISTORY_MESSAGES`, `MAX_HISTORY_CHARS`
  - `server/services/workoutService.ts` (line 301) — `CONCURRENCY_LIMIT = 5`
- **Issue:** Configuration values are defined locally in individual files. Changes require finding all occurrences.
- **Fix:** Create `shared/constants.ts` for cross-cutting values and domain-specific constant files where appropriate.
- **Effort:** 1 day

### 15. Reduce GeneratePlanDialog state complexity
- **File:** `client/src/components/plans/GeneratePlanDialog.tsx` (329 lines, 11 useState references)
- **Issue:** Many individual `useState` calls managing multi-step form state interleaved with UI logic. Hard to test and reason about.
- **Fix:** Extract form state into a `useGeneratePlanForm()` hook or use `useReducer` for the multi-step flow. Extract step UI into sub-components.
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

### 28. Full pdfjs-dist namespace import
- **File:** `client/src/components/settings/coaching/useCoachingUpload.ts` (line 4)
- **Issue:** `import * as pdfjsLib from "pdfjs-dist"` imports the entire library (~500KB). Only `getDocument` is needed.
- **Fix:** Use a targeted import: `import { getDocument } from "pdfjs-dist/legacy/build/pdf"`.
- **Effort:** 30 min

---

## Summary

| Priority | Count | Estimated Total Effort |
|----------|-------|----------------------|
| P0 — Quick Wins | 6 | 1-2 days |
| P1 — High | 6 | 8-14 days |
| P2 — Medium | 6 | 7-10 days |
| P3 — Low | 10 | 10-13 days |
| **Total** | **28** | **~27-39 days** |
