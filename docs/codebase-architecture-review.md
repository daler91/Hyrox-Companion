# Codebase Architecture Review

## Executive Summary

Hyrox-Companion is a full-stack TypeScript monorepo (React/Vite client + Express/Drizzle server + shared schemas) with strong domain coverage and extensive tests. The architecture is generally healthy and salvageable; the best path is incremental modularization and deduplication, not a rewrite.

Highest-value improvements are:
1. Reduce duplicated workout/plan-day exercise-set flows across server + client.
2. Decompose oversized orchestration files (`server/index.ts`, timeline/workout UI surfaces).
3. Standardize route composition and guard middleware to reduce drift.
4. Prepare for multi-instance scaling (in-memory/process-local assumptions).

## Current Architecture

- **Application type**: Training planner/logger + analytics + AI coaching for HYROX.
- **Languages/frameworks**: TypeScript, React 18, Vite 6, Express 4, Drizzle ORM, PostgreSQL, pgvector, TanStack Query, Wouter.
- **Package manager/runtime**: pnpm (`packageManager: pnpm@9.12.0`), Node >=20 (`package.json`).
- **Main entry points**:
  - Client: `client/src/main.tsx`, `client/src/App.tsx`
  - Server: `server/index.ts`, `server/routes.ts`
  - Shared contracts: `shared/schema/*`, `shared/openapi.ts`
- **Server layers**:
  - HTTP routes in `server/routes/*` and `server/routes/workouts/*`
  - Services in `server/services/*`
  - Storage adapters in `server/storage/*`
  - Middleware in `server/middleware/*`
- **Domain concepts**: users/preferences, workouts/exercise sets, plans/plan days, timeline entries + annotations, coaching materials/RAG, AI usage/budgets, Strava/Garmin sync, push/email.
- **Pattern in use**: layered modular monolith with shared typed contracts; partial migration toward clearer use-case and route-builder abstractions.

### Main data/control flow

1. React pages/hooks call API wrappers in `client/src/lib/api/*` (mostly through TanStack Query hooks).
2. Express routes in `server/routes.ts` mount feature routers and guards.
3. Route handlers call services/use cases and/or storage adapters.
4. Storage modules in `server/storage/*` perform Drizzle queries against PostgreSQL.
5. Background tasks run via pg-boss (`server/queue.ts`) and cron (`server/cron.ts`).

## Highest-Priority Findings

### Finding 1
- **Priority**: P0
- **Category**: Deduplication / domain consistency
- **Files involved**:
  - `server/storage/workouts.ts`
  - `server/usecases/workouts/mutateWorkoutSet.usecase.ts`
  - `server/routes/workouts/workoutsCrud.routes.ts`
  - `server/routes/plans.ts`
  - `client/src/hooks/useWorkoutDetail.ts`
  - `client/src/hooks/usePlanDayExercises.ts`
  - `client/src/lib/api/workouts.ts`
  - `client/src/lib/api/plans.ts`
- **Problem**: Exercise-set mutation behavior is duplicated between workout-log owners and plan-day owners.
- **Evidence**:
  - Server has separate methods for workout-log and plan-day set mutations in `server/storage/workouts.ts`.
  - A workout-specific use case exists (`mutateWorkoutSet.usecase.ts`) but plan-day path remains separate.
  - Client has two parallel owner-specific hooks and API modules.
- **Why it matters**: This domain is central to logging, editing, AI adjustments, and optimistic UI behavior; duplication increases drift and bug probability.
- **Recommendation**: Introduce an owner-discriminated exercise-set application service/use case and shared client mutation adapter while keeping existing API routes as thin compatibility layers.
- **Impact**: High
- **Effort**: Medium
- **Risk**: Medium

### Finding 2
- **Priority**: P1
- **Category**: Separation of concerns / maintainability
- **Files involved**:
  - `server/index.ts`
  - `server/bootstrap/health.ts`
  - `server/bootstrap/appConfig.ts`
  - `server/bootstrap/lifecycle.ts`
  - `server/bootstrap/observability.ts`
- **Problem**: `server/index.ts` remains a large orchestration hub (startup, middleware, health, observability, lifecycle), while bootstrap modules exist in parallel.
- **Evidence**:
  - `server/index.ts` contains app init, middleware stack, health probing, startup/shutdown flow.
  - `server/bootstrap/*` indicates intended decomposition but is not the primary assembly path.
- **Why it matters**: High-blast-radius file, harder onboarding, and risk of logic drift between intended and actual composition.
- **Recommendation**: Pick one source of truth: either wire bootstrap modules incrementally with parity tests or remove unused bootstrap shims.
- **Impact**: High
- **Effort**: Medium
- **Risk**: Medium

### Finding 3
- **Priority**: P1
- **Category**: Modularity / route consistency
- **Files involved**:
  - `server/routes/_helpers/protectedRouteBuilder.ts`
  - `server/routes/ai.ts`, `server/routes/plans.ts`, `server/routes/preferences.ts`, `server/routes/timelineAnnotations.ts`
  - `server/routes/workouts/workoutsAi.routes.ts`, `server/routes/workouts/workoutsCrud.routes.ts`
- **Problem**: Route guard composition (auth, rate limit, AI consent/budget, validation, async wrappers) is partially standardized.
- **Evidence**: Protected route builder exists but route modules still mix direct middleware composition and helper-based composition.
- **Why it matters**: Inconsistent middleware ordering can create security/cost/error-contract drift.
- **Recommendation**: Finish route-builder adoption for all mutating/protected routes with table-driven tests for guard ordering.
- **Impact**: Medium-High
- **Effort**: Medium
- **Risk**: Medium

### Finding 4
- **Priority**: P1
- **Category**: Scalability / operations
- **Files involved**:
  - `server/routeUtils.ts`
  - `server/cron.ts`
  - `server/maintenance.ts`
  - `server/services/ragService.ts`
  - `server/gemini/client.ts`
  - `server/clerkAuth.ts`
- **Problem**: Several runtime controls/caches are per-process or in-memory.
- **Evidence**:
  - Memory-backed rate limiting utility in `server/routeUtils.ts`.
  - Process-local cron scheduling in `server/cron.ts`.
  - Startup maintenance invoked at server startup (`server/index.ts` + `server/maintenance.ts`).
  - In-memory maps/caches in AI/auth-related modules.
- **Why it matters**: Multi-instance deployments can cause inconsistent throttling, duplicate scheduled work, and uneven cache behavior.
- **Recommendation**: Introduce shared/distributed rate-limit store, singleton scheduling/locking strategy, and explicit cache policy docs (best-effort vs correctness-critical).
- **Impact**: High (for scale-out)
- **Effort**: Medium-Large
- **Risk**: Medium

### Finding 5
- **Priority**: P2
- **Category**: Frontend modularity/testability
- **Files involved**:
  - `client/src/pages/Timeline.tsx`
  - `client/src/components/workout-detail/ExerciseTable.tsx`
  - `client/src/hooks/useTimelineData.ts`
  - `client/src/hooks/useTimelineState.ts`
- **Problem**: Large UI orchestrators still blend data orchestration, interaction state, and rendering concerns.
- **Evidence**: Existing extracted hooks/components are present, but page/table components remain heavy coordination layers.
- **Why it matters**: Slower feature iteration, harder local reasoning, and brittle tests.
- **Recommendation**: Continue extraction into focused presenter + orchestration hooks with explicit state machine boundaries for timeline/workout-detail interactions.
- **Impact**: Medium
- **Effort**: Medium
- **Risk**: Low-Medium

## Deduplication Opportunities

1. **Exercise-set owner duplication** (highest ROI) across workout/plan-day server & client flows (files listed in Finding 1).
2. **Route middleware stack duplication** across route modules instead of consistent builder usage (files in Finding 3).
3. **Exercise field metadata duplication**:
   - `client/src/components/ExerciseInput.tsx`
   - `client/src/components/workout/ExerciseRow.tsx`
   - `client/src/components/exercise-row/fieldMeta.ts`
   Consolidate field config and resolution logic.
4. **API timeout/behavior constants drift risk** across:
   - `client/src/lib/api/workouts.ts`
   - `client/src/lib/api/plans.ts`
   Move shared constants to `client/src/lib/api/constants.ts`.

## Refactoring Opportunities

- **`server/index.ts`**: split startup assembly into composable modules with parity tests (P1).
- **`server/garmin.ts` and `server/strava.ts`**: separate route adapter, provider client, sync orchestrator, and mapper layers (P2).
- **`client/src/pages/Timeline.tsx`**: isolate rendering-only sections from mutation orchestration (P1).
- **`client/src/components/workout-detail/ExerciseTable.tsx`**: split editing state, row rendering, and mutation coordination (P1).
- **`server/storage/workouts.ts`**: progressively split by capability with true implementations (not just aliases in `server/storage/workouts/*`) (P2).

## Scalability Concerns

1. **Confirmed concern**: memory-backed rate limits (`server/routeUtils.ts`) are per-instance.
   - Failure mode: users can bypass effective global caps via instance hopping.
   - Improvement: shared store-backed limiter (Redis/Postgres-based token bucket), plus unified keys.
   - Priority: P1 | Effort: Medium

2. **Confirmed concern**: process-local cron (`server/cron.ts`) and startup maintenance (`server/maintenance.ts`).
   - Failure mode: duplicate jobs/work on scale-out.
   - Improvement: distributed leader election or advisory-lock guarded job execution.
   - Priority: P1 | Effort: Medium

3. **Theoretical/likely risk**: heavy timeline and analytics paths may degrade without pagination/windowing discipline.
   - Evidence: timeline/analytics logic spans `server/storage/timeline.ts`, `server/storage/analytics.ts`, `server/routes/analytics.ts` and large client rendering surfaces.
   - Improvement: enforce bounded query windows + response caps + client virtualization where needed.
   - Priority: P2 | Effort: Medium

## Modularity and Boundary Issues

- **Current structure issue**: cross-layer leakage where routes sometimes orchestrate business rules directly.
  - **Target**: thin routes -> use cases/services -> storage.
  - **Migration**: move one feature at a time (workouts first), preserve route contracts.

- **Current structure issue**: integration modules at server root (`server/garmin.ts`, `server/strava.ts`) combine transport/domain/infrastructure.
  - **Target**: `server/integrations/{provider}/{routes,client,service,mapper}.ts`.
  - **Migration**: keep `register*Routes` API stable while internals move.

- **Current structure issue**: duplicate route composition entry points around workouts (`server/routes/workouts.ts` and `server/routes/workouts/index.ts`).
  - **Target**: single explicit composition point.
  - **Migration**: update imports/tests, then remove compatibility wrapper.

## Testing Recommendations

- Add contract-level tests before exercise-set flow consolidation:
  - route behavior parity for workout-log vs plan-day mutations.
  - optimistic update rollback behavior in client hooks.
- Add startup composition parity tests before `server/index.ts` decomposition.
- Add middleware-order tests around route builder adoption.
- Add integration tests for Strava/Garmin retry/circuit behavior after modular split.

## Suggested Migration Roadmap

### Quick wins (1–2 PRs)
- Consolidate duplicated API constants and exercise field metadata.
- Standardize workout route composition entry point.
- Update architecture docs to match actual module boundaries.

### Medium-sized refactors (3–5 PRs)
- Unify exercise-set mutation flow with owner-discriminated use case.
- Finish protected route builder adoption for all protected mutations.
- Split timeline/workout-detail orchestration into smaller testable units.

### Larger architectural improvements (follow-on)
- Decompose server bootstrap/startup assembly.
- Modularize Strava/Garmin integrations.
- Introduce shared-store operational primitives for rate limit/scheduling.

## PR-by-PR Refactoring Plan

1. **PR: “Unify exercise-set mutation contract across workout and plan-day owners”**
   - Goal: remove owner-path duplication without changing public API.
   - Files likely affected: `server/usecases/workouts/*`, `server/storage/workouts.ts`, route modules, client hooks/API wrappers.
   - Steps: introduce owner-discriminated mutation contract; adapt existing routes to delegate.
   - Tests: add server parity tests + client mutation behavior tests.
   - Validation command: `pnpm -s test -- server/usecases/workouts/mutateWorkoutSet.usecase.test.ts`
   - Risk: Medium; rollback by reverting route delegation only.
   - Dependencies: none.

2. **PR: “Complete protected route builder migration”**
   - Goal: enforce consistent guard ordering and validation behavior.
   - Files: `server/routes/_helpers/protectedRouteBuilder.ts`, all protected route files.
   - Steps: migrate route declarations incrementally; add middleware-order tests.
   - Tests: route test suites in `server/routes/__tests__/*`.
   - Validation command: `pnpm -s test -- server/routes/__tests__`
   - Risk: Medium; rollback by reverting specific migrated routes.
   - Dependencies: PR1 optional.

3. **PR: “Decompose server startup composition and remove bootstrap drift”**
   - Goal: reduce `server/index.ts` complexity with verified parity.
   - Files: `server/index.ts`, `server/bootstrap/*`, lifecycle/health tests.
   - Steps: choose target modules, migrate one concern at a time, assert parity.
   - Tests: add startup/health/lifecycle integration tests.
   - Validation command: `pnpm -s test -- server/routes/tests/smoke.test.ts`
   - Risk: Medium-High; rollback by re-pointing to monolithic startup path.
   - Dependencies: PR2 recommended.

4. **PR: “Modularize Strava integration boundaries”**
   - Goal: isolate route adapter from external API/sync logic.
   - Files: `server/strava.ts` plus new `server/integrations/strava/*`.
   - Steps: extract client/mapper/service; keep register API stable.
   - Tests: existing `server/strava.test.ts` + added service unit tests.
   - Validation command: `pnpm -s test -- server/strava.test.ts`
   - Risk: Medium; rollback via compatibility wrapper.
   - Dependencies: PR3 optional.

5. **PR: “Modularize Garmin integration boundaries”**
   - Goal: same as PR4 for Garmin.
   - Files: `server/garmin.ts` plus `server/integrations/garmin/*`.
   - Tests: `server/garmin.test.ts` + circuit/rate behavior tests.
   - Validation command: `pnpm -s test -- server/garmin.test.ts`
   - Risk: Medium; rollback via wrapper.
   - Dependencies: PR4 optional.

6. **PR: “Operational scale readiness: shared rate limiting + singleton scheduling”**
   - Goal: remove per-instance behavior for critical controls.
   - Files: `server/routeUtils.ts`, `server/cron.ts`, queue/scheduling modules.
   - Steps: add shared limiter backend; add distributed lock for scheduled tasks.
   - Tests: integration tests for limiter consistency and lock behavior.
   - Validation command: `pnpm -s test -- server/routes/__tests__/analytics.test.ts`
   - Risk: Medium-High; rollback by feature flags to memory mode.
   - Dependencies: PR3 recommended.

## Commands Run

- `pwd && rg --files -g 'AGENTS.md'` — **failed** (exit 1 because no `AGENTS.md` found).
- `git status --short --branch` — **passed**.
- `rg --files` — **passed**.
- `cat package.json` — **passed**.
- `sed -n '1,220p' README.md` — **passed**.
- `sed -n '1,260p' docs/architecture.md` — **passed**.
- `sed -n '1,260p' server/index.ts` — **passed**.
- `sed -n '1,260p' server/routes.ts` — **passed**.
- `sed -n '1,260p' server/storage/index.ts` — **passed**.
- `sed -n '1,260p' docs/codebase-architecture-review.md` — **passed**.
- `pnpm -s check` — **passed**.
- `pnpm -s lint` — **passed with warnings** (3 import/export sort warnings in `client/src/lib/api/index.ts`, `client/src/lib/api/workouts.ts`, `server/storage/timeline.ts`).

## Limitations

- This review is based on static inspection and non-mutating commands only.
- I did not run full test suites (`pnpm test`, Cypress, integration smoke) to avoid high runtime cost and environment-coupled failures; therefore, behavioral findings focus on code structure and documented command output.
- Some findings (especially scalability risks) are “confirmed architectural constraints” rather than measured production performance regressions.
