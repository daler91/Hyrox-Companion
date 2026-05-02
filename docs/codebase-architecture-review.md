# Codebase Architecture Review

## Executive Summary

Hyrox-Companion is a TypeScript full-stack monorepo with a React/Vite SPA (`client/`) and Express API (`server/`), sharing schema/types via `shared/`. The codebase is substantial (526 files; ~66k lines in `client/`, `server/`, `shared`) and already has strong baseline practices: Zod validation, route-level guards, rate limiting, background jobs (`pg-boss`), and broad test coverage (Vitest + Cypress).

Highest-value improvements are not rewrites; they are incremental structural changes:
- Split oversized route/service modules that currently mix orchestration and domain logic.
- Consolidate repeated route wiring/middleware stacks and repeated validation/error patterns.
- Reduce direct `storage` coupling from route handlers via use-case/service seams.
- Improve pagination consistency and query-shape standardization for scale.
- Add targeted contract/integration tests before high-risk refactors.

## Current Architecture

- **Application type**: Training planner/logging/coaching web app (PWA) for Hyrox athletes.
- **Languages/runtime/package manager**: TypeScript, Node.js >=20, pnpm (`package.json`, `pnpm-lock.yaml`).
- **Frontend**: React 18 + Vite + Wouter + TanStack Query (`client/src/App.tsx`, `client/src/main.tsx`).
- **Backend**: Express app with route modules under `server/routes/`, services under `server/services/`, and Drizzle-based persistence in `server/storage/`.
- **Shared contracts**: Zod schemas and OpenAPI generation in `shared/schema/types.ts` and `shared/openapi.ts`.
- **Primary entry points**:
  - Server boot: `server/index.ts`
  - Route registration: `server/routes.ts`
  - Client mount: `client/src/main.tsx` and app shell in `client/src/App.tsx`
- **Domain concepts**: workouts, exercise sets, training plans/plan days, analytics, AI parsing/coaching, RAG coaching materials, push/email notifications, auth/preferences.
- **Data/control flow**:
  - Client routes/components call API via query/mutation flows.
  - Route handlers apply auth + middleware + validation, then call `storage` and/or service functions.
  - Services orchestrate higher-level workflows (AI parsing/coaching, plan generation, exports, queue jobs).
  - Storage layer executes Drizzle queries and returns typed entities.
- **Architectural style (observed)**: Pragmatic layered monolith with partial separation (routes/services/storage), but with inconsistent boundary enforcement (some route modules still contain orchestration/business logic).

## Highest-Priority Findings

### 1) Oversized mixed-responsibility backend modules
- **Priority**: P1
- **Category**: Refactoring / Separation of concerns
- **Files involved**: `server/index.ts`, `server/routes/workouts.ts`, `server/services/workoutService.ts`, `server/storage/workouts.ts`
- **Problem**: Large files combine multiple concerns (HTTP setup + observability + security + lifecycle in one place; route definition + validation + orchestration; dense service logic).
- **Evidence**: `server/index.ts` (642 lines), `server/routes/workouts.ts` (435), `server/services/workoutService.ts` (841), `server/storage/workouts.ts` (621).
- **Why it matters**: Increases change risk, review burden, and test complexity; makes regression isolation slower.
- **Recommendation**: Extract focused modules by concern (e.g., server bootstrapping vs observability vs health checks; split workouts routes by capability such as CRUD/reparse/timeline/export).
- **Impact**: High
- **Effort**: Medium
- **Risk**: Medium

### 2) Repeated middleware/route wiring patterns
- **Priority**: P1
- **Category**: Deduplication / Maintainability
- **Files involved**: `server/routes/*.ts` (especially `ai.ts`, `workouts.ts`, `plans.ts`, `coaching.ts`, `push.ts`, `preferences.ts`)
- **Problem**: Repeated route signatures with similar stacks (`...protectedMutationGuards`, `rateLimiter(...)`, `validateBody(...)`, `asyncHandler(...)`) and repeated per-endpoint guard composition.
- **Evidence**: Many repetitive route declarations in `server/routes/workouts.ts`, `server/routes/ai.ts`, `server/routes/plans.ts`.
- **Why it matters**: Policy drift risk (missing a guard/rate limit on new endpoints) and verbose boilerplate.
- **Recommendation**: Introduce small route-builder helpers (e.g., `protectedPost`, `protectedPatch`) that compose standard middleware consistently while still allowing endpoint-specific overrides.
- **Impact**: Medium
- **Effort**: Small/Medium
- **Risk**: Low

### 3) Inconsistent validation pattern across routes
- **Priority**: P2
- **Category**: Deduplication / Testability
- **Files involved**: `server/routes/timelineAnnotations.ts`, `server/routes/preferences.ts`, `server/routes/workouts.ts`, `server/routes/ai.ts`, `server/routes/plans.ts`
- **Problem**: Some endpoints use centralized `validateBody(...)`, others do manual `safeParse` and inline 400 responses.
- **Evidence**: Manual parse blocks in `timelineAnnotations.ts`, `preferences.ts`, `workouts.ts` alongside `validateBody` use in many other routes.
- **Why it matters**: Inconsistent error contracts and duplicated failure handling.
- **Recommendation**: Normalize on a single validation middleware convention for request body/query/params and standard error shape.
- **Impact**: Medium
- **Effort**: Small
- **Risk**: Low

### 4) Route modules directly depend on storage details
- **Priority**: P1
- **Category**: Modularity / Boundary health
- **Files involved**: `server/routes/workouts.ts`, `server/routes/plans.ts`, `server/routes/ai.ts`, `server/storage/index.ts`, `server/services/*`
- **Problem**: Many route handlers directly call storage methods; service boundaries are used inconsistently.
- **Evidence**: Direct `storage.*` invocations throughout route modules (e.g., workouts and plans handlers).
- **Why it matters**: Makes HTTP layer tightly coupled to persistence details; harder to reuse domain flows and test in isolation.
- **Recommendation**: Move complex route orchestration into explicit use-case/service functions; keep routes as thin adapters.
- **Impact**: High
- **Effort**: Medium/Large
- **Risk**: Medium

## Deduplication Opportunities

1. **Guard + limiter + validation boilerplate duplication**
   - **Files/symbols**: Route handlers in `server/routes/ai.ts`, `workouts.ts`, `plans.ts`, `coaching.ts`, `push.ts`.
   - **What is duplicated**: Endpoint wrapper pattern and middleware ordering.
   - **Why it matters**: Easy to omit security middleware accidentally.
   - **Consolidation**: Add small higher-order route registration helpers that enforce default stack and allow opt-outs.
   - **Impact**: Medium | **Effort**: Small | **Risk**: Low

2. **Pagination parsing and limits repeated at route layer**
   - **Files/symbols**: `server/routes/workouts.ts` (`parsePagination` usage), `server/routes/ai.ts` cursor parsing, storage methods with local limits.
   - **What is duplicated**: Request query parsing, default/maximum limit enforcement.
   - **Why it matters**: Inconsistent behavior and API ergonomics.
   - **Consolidation**: Shared pagination utility supporting offset and cursor variants with consistent validation/errors.
   - **Impact**: Medium | **Effort**: Medium | **Risk**: Low

3. **Validation error handling duplication**
   - **Files/symbols**: `safeParse` blocks in `server/routes/preferences.ts`, `timelineAnnotations.ts`, `workouts.ts`, `ai.ts`.
   - **What is duplicated**: Parse-result checks and 400 responses.
   - **Why it matters**: Error contract drift.
   - **Consolidation**: Extend `validateBody`/`validateQuery` middleware and standardize response envelope.
   - **Impact**: Medium | **Effort**: Small | **Risk**: Low

## Refactoring Opportunities

1. **`server/index.ts` boot sequence decomposition**
- **File path**: `server/index.ts`
- **Code area**: App initialization, Sentry init, health probes, middleware stack, lifecycle handlers.
- **Problem**: Too many responsibilities in one file.
- **Why it matters**: Harder operational changes and lower confidence in startup/shutdown edits.
- **Recommended refactor**: Extract modules: `observability.ts`, `health.ts`, `appConfig.ts`, `lifecycle.ts`.
- **Tradeoffs**: More files and indirection.
- **Priority**: P1

2. **`server/routes/workouts.ts` endpoint partitioning**
- **File path**: `server/routes/workouts.ts`
- **Code area**: CRUD, reparse, timeline, export, custom exercises in one router.
- **Problem**: Feature breadth creates dense coupling and difficult navigation.
- **Why it matters**: Slows onboarding and increases merge conflicts.
- **Recommended refactor**: Split into `workoutsCrud.routes.ts`, `workoutsAi.routes.ts`, `timeline.routes.ts`, `export.routes.ts` and compose.
- **Tradeoffs**: Router composition complexity.
- **Priority**: P1

3. **Client app shell duplication in auth-bypass vs clerk mode**
- **File path**: `client/src/App.tsx`
- **Code area**: Repeated provider tree in `App()` branches.
- **Problem**: Duplicated `QueryClientProvider` + `ThemeProvider` + `TooltipProvider` + shared children.
- **Why it matters**: Provider drift risk between auth modes.
- **Recommended refactor**: Extract common `BaseProviders` wrapper; conditionally include `ClerkProvider` only.
- **Tradeoffs**: Slight abstraction cost.
- **Priority**: P2

## Scalability Concerns

1. **Large in-memory timeline shaping risk (partially mitigated)**
- **Evidence**: `server/storage/timeline.ts` computes SQL over-fetch (`computeSqlOverFetch`) and then slices in memory.
- **Failure mode**: As data grows, over-fetch + in-memory transforms can increase latency/memory.
- **Recommendation**: Push more filtering/windowing into SQL; benchmark with production-like cardinalities.
- **Status**: Confirmed pattern; severity depends on data volume.
- **Priority**: P2 | **Effort**: Medium

2. **Mixed pagination paradigms (offset and cursor) across endpoints**
- **Evidence**: Offset pagination in workouts/timeline routes; cursor pagination for chat history (`server/routes/ai.ts`, `server/storage/users.ts`).
- **Failure mode**: Inconsistent client behavior; offset degradation on deep pages.
- **Recommendation**: Standardize endpoint-by-endpoint (cursor where unbounded growth is expected).
- **Status**: Confirmed inconsistency; scale impact is context-dependent.
- **Priority**: P2 | **Effort**: Medium

3. **Potential hot-path route bloat**
- **Evidence**: `server/routes/workouts.ts` centralizes many heavily-used paths.
- **Failure mode**: Higher cognitive load leads to accidental performance regressions and hard-to-isolate tuning.
- **Recommendation**: Modularize and add per-subdomain perf tests/benchmarks for critical operations.
- **Status**: Theoretical risk with strong maintainability evidence.
- **Priority**: P3 | **Effort**: Medium

## Modularity and Boundary Issues

1. **Current structure**: Routes sometimes perform orchestration directly with storage.
- **Why problem**: Dependency direction leaks persistence concerns into HTTP layer.
- **Target**: Routes -> use-cases/services -> repositories/storage.
- **Incremental migration**:
  1. Add service functions for one bounded area (e.g., plan day updates).
  2. Move route logic behind service APIs without changing route contracts.
  3. Add contract tests, then repeat module-by-module.

2. **Current structure**: Shared schemas are strong, but validation strategy differs by route.
- **Why problem**: Inconsistent API errors and duplicated parse logic.
- **Target**: Central validation middleware for body/query/params + standard error formatter.
- **Incremental migration**: Convert 2-3 routes first (`timelineAnnotations`, `preferences`, `ai history`) then expand.

## Testing Recommendations

- Add/expand **route contract tests** around error envelopes before validation middleware unification.
- Add **service-level unit tests** for extracted use-cases prior to splitting `workouts.ts` and `workoutService.ts`.
- Add **pagination behavior tests** (deep pages, boundary limits, invalid cursors) across workouts/timeline/chat endpoints.
- Add **performance guard tests** (or benchmark scripts) for timeline queries with larger fixtures to protect future refactors.
- Refactors that should wait for tests:
  - Route builder abstraction rollout.
  - Workouts route partitioning.
  - Storage-to-service boundary tightening.

## Suggested Migration Roadmap

### Quick wins (1-2 PRs)
- Standardize validation middleware usage where manual `safeParse` exists.
- Extract shared provider wrapper in `client/src/App.tsx`.
- Introduce route registration helpers for repeated protected mutation stacks.

### Medium-sized refactors (2-4 PRs)
- Split `server/routes/workouts.ts` into capability routers.
- Extract startup/observability/health modules from `server/index.ts`.
- Standardize pagination utilities and response metadata patterns.

### Larger architectural improvements (phased)
- Establish explicit application service/use-case layer for route orchestration-heavy domains (workouts/plans/AI).
- Progressively reduce direct storage calls from route handlers.

## PR-by-PR Refactoring Plan

1. **PR Title**: Standardize Route Validation Middleware
- **Goal**: Remove manual `safeParse` duplication and unify error shape.
- **Files likely affected**: `server/routes/timelineAnnotations.ts`, `server/routes/preferences.ts`, `server/routes/ai.ts`, `server/routeUtils.ts` (or equivalent validation utils).
- **Steps**: Add/extend query/body validators; migrate selected routes; keep response contract stable.
- **Tests to add/update**: Route tests for 400 payload consistency.
- **Validation command**: `pnpm test -- server/routes/__tests__/preferences.test.ts server/routes/__tests__/timelineAnnotations.test.ts`
- **Risk**: Low
- **Rollback**: Revert route-by-route migration.
- **Dependencies**: None.

2. **PR Title**: Extract Common Route Guard Builders
- **Goal**: Deduplicate protected mutation middleware composition.
- **Files likely affected**: `server/routes/*.ts`, shared route helper module.
- **Steps**: Implement helper(s); migrate a subset (`push`, `coaching`); expand.
- **Tests**: Middleware presence tests + existing endpoint behavior tests.
- **Validation command**: `pnpm test -- server/routes/__tests__/coaching.test.ts server/routes/__tests__/auth.test.ts`
- **Risk**: Low/Medium
- **Rollback**: Revert helper adoption per file.
- **Dependencies**: PR #1 preferred.

3. **PR Title**: Partition Workouts Router by Capability
- **Goal**: Reduce file size/coupling in workouts routing.
- **Files likely affected**: `server/routes/workouts.ts` -> new route modules.
- **Steps**: Split endpoints into sub-routers; compose in index router; keep path contracts unchanged.
- **Tests**: Existing workouts route suite + smoke tests.
- **Validation command**: `pnpm test -- server/routes/__tests__/workouts.test.ts server/routes/tests/smoke.test.ts`
- **Risk**: Medium
- **Rollback**: Keep monolithic router file snapshot.
- **Dependencies**: PR #2 helpful.

4. **PR Title**: Decompose Server Bootstrap and Health Modules
- **Goal**: Isolate boot concerns for maintainability.
- **Files likely affected**: `server/index.ts`, new modules (`server/health.ts`, `server/observability.ts`, etc.).
- **Steps**: Move code with no behavior change; preserve middleware order.
- **Tests**: Startup/health route tests and integration smoke.
- **Validation command**: `pnpm test -- server/routes/tests/smoke.test.ts`
- **Risk**: Medium
- **Rollback**: Revert module extraction commit.
- **Dependencies**: None.

5. **PR Title**: Pagination Contract Unification
- **Goal**: Establish consistent pagination parsing and metadata emission.
- **Files likely affected**: `server/routes/workouts.ts`, `server/routes/ai.ts`, shared pagination utility, related storage signatures.
- **Steps**: Define standard; migrate one endpoint family at a time; update docs/openapi.
- **Tests**: Pagination boundary/invalid-input tests across endpoints.
- **Validation command**: `pnpm test -- server/routes/__tests__/ai.test.ts server/routes/__tests__/workouts.test.ts`
- **Risk**: Medium
- **Rollback**: Feature-flagged parser fallback or revert per endpoint.
- **Dependencies**: PR #1 recommended.

## Commands Run

- ✅ `pwd; rg --files -g 'AGENTS.md'` (passed; no AGENTS.md found in repo scope)
- ✅ `rg --files | head -n 200` (passed)
- ✅ `rg --files | rg '(^|/)package.json$|pnpm-workspace.yaml|tsconfig.json|vite.config|cypress.config|drizzle.config|README|AGENTS.md'` (passed)
- ✅ `cat package.json` (passed)
- ✅ `sed -n '1,220p' README.md` (passed)
- ✅ `rg --files client server shared | wc -l` (passed)
- ✅ `find client server shared -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | xargs -0 wc -l | sort -nr | head -n 25` (passed)
- ✅ `sed -n '1,240p' server/index.ts` (passed)
- ✅ `sed -n '1,260p' server/routes.ts` (passed)
- ✅ `sed -n '1,260p' client/src/main.tsx` (passed)
- ✅ `sed -n '1,260p' client/src/App.tsx` (passed)
- ✅ `rg -n "try\s*\{|catch\s*\(" server/routes server/services | head -n 80` (passed)
- ✅ `rg -n "app\.use\(|router\.(get|post|put|delete|patch)" server/routes server/routes.ts | head -n 120` (passed)
- ✅ `rg -n "z\.object\(|safeParse\(|parse\(" server/routes server/services shared | head -n 120` (passed)
- ✅ `rg -n "pagination|limit|offset|cursor" server/routes server/storage server/services | head -n 120` (passed)

## Limitations

- This review is static inspection only; no runtime execution, build, lint, or test commands were run in this analysis task.
- Findings are grounded in inspected files and search evidence; performance concerns are identified from code patterns and should be validated with profiling/benchmarks in a test environment.
