# Technical Debt Registry

> Living document cataloging known technical debt in the Hyrox-Companion codebase.
> Last audited: 2026-04-04

---

## P0 — Quick Wins (< 2 hours each)

### 1. Remove unused `aiService.ts` re-export wrapper
- **File:** `server/services/aiService.ts`
- **Issue:** This file is a 2-line backward-compatibility re-export. It adds an unnecessary indirection layer.
- **Fix:** Delete the file and update any imports to reference `server/services/ai/index.ts` directly.
- **Effort:** 30 min

### 2. Move Gemini model names to environment config
- **File:** `server/gemini/client.ts` (lines 6-7)
- **Issue:** Model names `gemini-2.5-flash-lite` and `gemini-3.1-pro-preview` are hardcoded. Changing models requires a code change and redeploy.
- **Fix:** Add `GEMINI_MODEL` and `GEMINI_SUGGESTIONS_MODEL` to `env.ts` schema with current values as defaults.
- **Effort:** 30 min

### 3. Replace `console.log` with structured logger
- **Files:** `server/env.ts` (line 3), `script/build.ts`, `script/cleanup-orphans.ts`
- **Issue:** These files use `console.log` instead of the pino logger, producing inconsistent log format and missing structured context. The `env.ts` case is intentional (pino not yet initialized at boot) but should still emit structured JSON.
- **Fix:** For `env.ts`, keep console but ensure structured format (already partially done). For scripts, import and use pino directly.
- **Effort:** 1 hour

### 4. Fix weak `isStreamData` type guard
- **File:** `client/src/hooks/useChatSession.ts` (lines 10-12)
- **Issue:** The type guard only checks `typeof v === "object" && v !== null` — this would match any object, including arrays, Dates, etc. It does not validate that the expected properties (`ragInfo`, `text`, `error`) actually exist.
- **Fix:** Add property existence checks (e.g., `"text" in v || "error" in v || "ragInfo" in v`).
- **Effort:** 15 min

### 5. Route all `process.env` access through `env.ts`
- **Files:** `server/index.ts` (line 266), `server/emailTemplates.ts`, `vitest.integration.setup.ts`
- **Issue:** Direct `process.env` access bypasses the Zod-validated env schema, creating risk of undefined values and inconsistent configuration.
- **Fix:** Replace direct access with imports from `env.ts`. For test setup files, use a test-specific env helper.
- **Effort:** 1 hour

### 6. Consolidate timeout constants
- **Files:** `server/constants.ts`, `server/gemini/client.ts`, `server/strava.ts`, various route files
- **Issue:** AI timeouts, DB timeouts, and Strava timeouts are scattered across multiple files with no single source of truth.
- **Fix:** Create a centralized timeout config section in `server/constants.ts` and reference it everywhere.
- **Effort:** 1 hour

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
- **Files:** Throughout `server/` (36+ `throw new Error` instances)
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

### 15. Reduce state management complexity
- **Files:**
  - `client/src/pages/Timeline.tsx` (line 36) — `useTimelineState()` returns 8+ properties
  - `client/src/components/plans/GeneratePlanDialog.tsx` (lines 49-58) — 9 separate `useState` calls
- **Issue:** Hooks managing too much state become hard to test and reason about. Multiple related `useState` calls suggest the need for a reducer or form library.
- **Fix:** Split `useTimelineState` into domain-specific hooks (e.g., `useTimelineFilters`, `useTimelineData`). Convert `GeneratePlanDialog` state to `useReducer` or a form library like react-hook-form.
- **Effort:** 1-2 days

### 16. Improve test type safety
- **Files:** `server/services/planService.test.ts`, `server/emailScheduler.test.ts`, `server/storage/users.test.ts`, `shared/unitConversion.test.ts`, and others
- **Issue:** 20+ instances of `as unknown as` type assertions in test mocks, defeating TypeScript's purpose in tests. Makes refactoring risky since tests won't catch type mismatches.
- **Fix:** Create typed mock factories using `vi.fn()` with proper generic types. Use Vitest's `vi.mocked()` helper for typed mock access.
- **Effort:** 2 days

### 17. Fix email scheduler race conditions
- **File:** `server/emailScheduler.ts`
- **Issue:** If multiple server instances start simultaneously, they may trigger duplicate email sends. No distributed locking or deduplication.
- **Fix:** Use pg-boss's built-in job deduplication and retry mechanisms instead of the custom scheduler.
- **Effort:** 1 day

### 18. Add request ID / tracing context
- **Files:** `server/index.ts` (middleware), `server/logger.ts`
- **Issue:** Logs lack correlation IDs, making it impossible to trace a single request across multiple log entries.
- **Fix:** Add middleware that generates a UUID per request, stores it in `AsyncLocalStorage`, and includes it in all pino log output.
- **Effort:** 1 day

---

## P3 — Low Priority / Ongoing

### 19. Resolve dependency security overrides
- **File:** `package.json` (npm overrides section)
- **Issue:** 4 dependency overrides mask known vulnerabilities instead of fixing root causes. If upstream packages update, these overrides may silently break compatibility.
- **Fix:** Investigate each override, determine if the vulnerability is exploitable in this context, and either upgrade the parent dependency or document the accepted risk.
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

---

## Summary

| Priority | Count | Estimated Total Effort |
|----------|-------|----------------------|
| P0 — Quick Wins | 6 | 1-2 days |
| P1 — High | 6 | 8-14 days |
| P2 — Medium | 6 | 7-10 days |
| P3 — Low | 6 | 7-9 days |
| **Total** | **24** | **~23-35 days** |
