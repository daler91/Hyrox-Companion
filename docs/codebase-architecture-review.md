# Codebase Architecture Review

*Last Updated: May 3, 2026*

> **Status note (May 17, 2026):** This document is a historical architecture
> review snapshot. Several items below have been resolved or superseded by
> follow-up work: Timeline and ExerciseTable were split into focused modules,
> `workoutService`, shared schema types, the exercise parser, and coach-service
> tests were decomposed, and rate limits/short-lived runtime cache state now use
> PostgreSQL-backed shared tables with advisory-locked cron jobs. Use live source
> inspection before treating any May 3 roadmap item as still open.
>
> **Status note (May 24, 2026):** Further verification against the current
> source confirmed that the `server/index.ts` bootstrap decomposition (#4),
> the owner-agnostic exercise-set use case (#5), and the client exercise-set
> hook consolidation (#6) have also shipped. The Incomplete Use-Case Extraction
> finding (#1) has been partially addressed: reparse logic was extracted into
> `server/services/workoutService/reparse.ts` and `server/usecases/plans/updatePlanDay.usecase.ts`,
> so route handlers no longer carry the orchestration inline. Items #2
> (analytics row capping), #3 (in-memory timeline sorting), #7 (integrations
> module split), and #8 (coachService pipeline) remain open and accurate.

## Executive Summary
The Hyrox Companion codebase is a well-structured, modern TypeScript application utilizing a React SPA frontend and an Express backend. It follows a clean architecture pattern with a clear separation between transport (Routes), orchestration (Services/Use-Cases), and data access (Storage). Key strengths include a unified schema via Drizzle ORM, robust idempotency enforcement, and a sophisticated RAG-based AI coaching pipeline. Primary areas for improvement involve completing the migration of business logic from routes to use-cases and addressing potential scalability bottlenecks in the analytics and timeline modules.

## Current Architecture
- **Application Type**: AI-powered fitness tracking SPA (Vite/React) with an Express backend.
- **Domain Focus**: Workout logging, training plan management, and AI-driven coaching for Hyrox athletes.
- **Data Model**: PostgreSQL-backed schema with Drizzle ORM. Utilizes `pgvector` for RAG (Retrieval-Augmented Generation).
- **Core Modules**:
    - `client/src/`: Partitioned by feature components (`timeline`, `workout`, `analytics`, `coach`), hooks (TanStack Query), and a typed API client.
    - `server/`: Domain-partitioned routes (`workouts/`, `plans.ts`, `ai.ts`), a maturing service/use-case layer (`workoutUseCases.ts`, `planService.ts`), and a storage facade (`IStorage.ts`).
    - `shared/schema/`: Single source of truth for database tables, Zod validation schemas, and TypeScript types.
- **Data Flow**: Frontend hooks invoke the typed API client $\rightarrow$ Express routes validate input $\rightarrow$ Service/Use-case layer orchestrates business logic and external AI calls $\rightarrow$ Storage layer executes Drizzle queries.

## Highest-Priority Findings

The findings below were captured on May 3, 2026. After the May 2026 review-fix
rounds, the current source of truth is the live codebase plus the living docs.
The items that remain most likely to need follow-up are route/use-case
extraction, analytics row capping, timeline SQL windowing, owner-aware exercise
set mutation parity, and integration-module organization.

### 1. Incomplete Use-Case Extraction
- **Priority**: P2 *(downgraded from P1 on 2026-05-24 — orchestration extracted to services; remaining work is a thin use-case wrapper)*
- **Category**: Modularity and Boundaries
- **Files involved**: `server/routes/workouts/workoutsAi.routes.ts`, `server/routes/plans.ts`, `server/services/workoutService/reparse.ts`, `server/usecases/plans/updatePlanDay.usecase.ts`
- **Status (2026-05-24)**: Partially resolved. The reparse/image-parse logic was extracted into `server/services/workoutService/reparse.ts` (a dedicated module unifying workout-log and plan-day owners), and `server/usecases/plans/updatePlanDay.usecase.ts` exists and is used in `server/routes/plans.ts`. Route handlers still call these service functions directly instead of routing through a dedicated use-case wrapper.
- **Problem (original)**: Business logic (parsing targets, updating reference text, error shaping) was implemented inline within route handlers.
- **Evidence (original)**: `protectedPost("/api/v1/workouts/:id/reparse", ...)` in `workoutsAi.routes.ts` handled complex state transitions and DB updates directly.
- **Why it matters**: Weakens separation of concerns, makes transactional logic harder to test in isolation, and leads to duplication when similar logic is needed elsewhere (e.g., plan day re-parsing).
- **Recommendation**: Introduce a `parseWorkoutUseCases.ts` so `workoutsAi.routes.ts` handlers shrink to validate-and-delegate. Plan-day reparse can continue using `updatePlanDay.usecase.ts`.
- **Impact**: Medium
- **Effort**: Small
- **Risk**: Low

### 2. Analytics Row Capping
- **Priority**: P2
- **Category**: Scalability
- **Files involved**: `server/storage/shared.ts`, `server/storage/analytics.ts`
- **Problem**: `queryExerciseSetsWithDates` enforces a hard 5000-row limit on workout logs.
- **Evidence**: `const MAX_WORKOUT_LOGS_PER_QUERY = 5000;` in `server/storage/shared.ts`.
- **Why it matters**: Long-term users with thousands of workouts will see truncated analytics data once they pass the cap.
- **Recommendation**: Implement true pagination for analytics data or a summary-table approach for historical trends.
- **Impact**: Medium
- **Effort**: Large
- **Risk**: Medium

### 3. In-Memory Timeline Sorting
- **Priority**: P2
- **Category**: Scalability
- **Files involved**: `server/storage/timeline.ts`, `server/storage/timelineWindow.ts`
- **Problem**: Timeline entries are merged from multiple SQL streams (workouts and plan days) and sorted/windowed in-memory.
- **Evidence**: `return this.sortAndWindowEntries(entries, limit, offset);` in `server/storage/timeline.ts`.
- **Why it matters**: As user data grows, fetching multiple large streams only to discard most entries in Node.js becomes inefficient.
- **Recommendation**: Use a SQL `UNION` or a materialised view for the timeline to handle sorting and pagination at the database level.
- **Impact**: Medium
- **Effort**: Medium
- **Risk**: Medium

## Deduplication Opportunities
| Files involved | Symbols | What is duplicated | Recommended Consolidation |
|---|---|---|---|
| `server/routes/ai.ts`, `server/routes/workouts/workoutsAi.routes.ts` | `parse-exercises`, `reparse` | Logic for targeting text fields for Gemini parsing. | Unify into a single `parseWorkoutUseCases.ts`. |
| `client/src/hooks/useExerciseSetsForOwner.ts` | Multiple | Set-level mutation logic is slightly varied across different owners. | The current hook is good, but further DRY-ing of the `invalidateQueries` logic is possible. |

## Refactoring Opportunities

### 1. `server/index.ts` bootstrap decomposition

- **Status (May 24, 2026)**: Superseded by the bootstrap decomposition under
  `server/bootstrap/` (`appConfig.ts`, `health.ts`, `lifecycle.ts`,
  `observability.ts`). All four modules are imported and wired into
  `server/index.ts`, which is now ~442 lines.
- File path: `server/index.ts`
- Code area: App creation, Sentry, request middleware, health probes, startup maintenance, queues, cron, static/Vite serving, error handling, shutdown.
- Problem at snapshot time: The file was the largest operational hotspot and had unused neighboring bootstrap modules.
- Why it matters: Startup and shutdown bugs affect every request and deploy.
- Recommended refactor: Wire or remove `server/bootstrap/*` in stages: observability first, app config/middleware second, health third, lifecycle fourth. Use existing tests plus a smoke route check.
- Tradeoffs: More files and imports, but smaller operational units and fewer duplicate startup paths.
- Priority: P1

### 2. Owner-agnostic exercise-set use case

- **Status (May 24, 2026)**: Superseded by
  `server/usecases/workouts/mutateExerciseSet.usecase.ts`, which exports an
  `ExerciseSetOwnerRef` discriminated union (`kind: "workoutLog" | "planDay"`)
  and is imported into `server/routes/plans.ts`. Plan-day owner paths now go
  through the unified use case.
- File path: `server/usecases/workouts/mutateWorkoutSet.usecase.ts`, `server/storage/workouts.ts`, `server/routes/plans.ts`, `server/routes/workouts/workoutsCrud.routes.ts`
- Code area: Structured exercise set CRUD for workout logs and plan days.
- Problem at snapshot time: The original use case only covered workout-log owner paths, while plan-day owner paths called storage directly.
- Why it matters: Structured table behavior must stay consistent across planned and completed workouts.
- Recommended refactor: Replace the workout-only use case with an owner-aware `mutateExerciseSet.usecase.ts` and migrate route handlers behind it.
- Tradeoffs: Slightly more indirection and discriminated-type handling.
- Priority: P1

### 3. Client exercise-set hook consolidation

- **Status (May 24, 2026)**: Superseded by
  `client/src/hooks/useExerciseSetsForOwner.ts`, an owner-aware abstraction
  that the per-owner hooks (`useWorkoutDetail`, `usePlanDayExercises`) now
  delegate to. The per-owner hooks remain as thin wrappers tying the
  abstraction to their respective query keys and UI shape.
- File path: `client/src/hooks/useWorkoutDetail.ts`, `client/src/hooks/usePlanDayExercises.ts`, `client/src/hooks/useDebouncedSetPatches.ts`, `client/src/lib/api/workouts.ts`, `client/src/lib/api/plans.ts`
- Code area: Fetching, optimistic mutation, debounced patches, save-state management, and cache updates for exercise sets.
- Problem at snapshot time: Plan-day and workout detail hooks mirrored each other.
- Why it matters: Autosave and structured row editing have a history of subtle regressions; duplication doubles the patch surface.
- Recommended refactor: Extract a lower-level owner-aware hook that handles query keys, mutation state, debounced patch flushing, and optimistic cache updates.
- Tradeoffs: Hook API design needs care to avoid over-generalizing UI-specific behavior.
- Priority: P1

### 4. `client/src/pages/Timeline.tsx` surface orchestration split

- **Status (May 17, 2026)**: Superseded by the Timeline shell split and
  `client/src/pages/timeline/` component/hook modules. Re-open only if a fresh
  lint or code review finds new Timeline-specific complexity.
- File path: `client/src/pages/Timeline.tsx`
- Code area: Timeline page interactions, dialogs/sheets, click routing, coach panel, plan selection, virtualization.
- Problem at snapshot time: One page component owned many independent surfaces.
- Why it matters: Timeline is central and already has focused regression tests; the current file size makes feature work and review slower.
- Recommended refactor: Extract `useTimelineSurfaces`, `TimelineDialogs`, and click-routing helpers. Keep rendering shape stable and migrate one surface group per PR.
- Tradeoffs: More component boundaries, but clearer ownership and easier tests.
- Priority: P1

### 5. `ExerciseTable.tsx` row/render/dnd decomposition

- **Status (May 17, 2026)**: Superseded by the ExerciseTable decomposition into
  `client/src/components/workout-detail/exercise-table/` modules.
- File path: `client/src/components/workout-detail/ExerciseTable.tsx`
- Code area: Structured table display/editing, planned diffs, dnd-kit behavior, row menus, add/edit flows.
- Problem at snapshot time: DnD state, table rendering, domain metric calculations, and row editing lived together.
- Why it matters: This component drives both completed and planned exercise tables, which are key to the AI coach and manual logging workflows.
- Recommended refactor: Extract `useExerciseTableDnd`, `ExerciseTableRow`, `PlannedDiffSummary`, and pure metric helpers. Use existing `ExerciseTable.test.tsx` coverage as the safety net.
- Tradeoffs: Component boundaries need to preserve keyboard and drag/drop behavior.
- Priority: P1

### 6. `server/services/workoutService.ts` orchestration split

- **Status (May 17, 2026)**: Superseded by the workout service split under
  `server/services/workoutService/`, with the top-level file retained as a
  compatibility barrel.
- File path: `server/services/workoutService.ts`
- Code area: Workout creation, update, import/enrichment, exercise parsing, set mapping, coaching scheduling, transactions.
- Problem at snapshot time: The file was a large domain service and mixed several workflow types.
- Why it matters: Workout creation/update is high-traffic and interacts with AI coaching, plans, storage, and custom exercises.
- Recommended refactor: Extract cohesive workflow modules such as `workoutCreationService`, `workoutUpdateService`, `workoutExerciseMapping`, and `workoutCoachingScheduler`. Keep `workoutUseCases.ts` as route-facing API.
- Tradeoffs: Requires careful import direction and tests around transaction behavior.
- Priority: P2

### 7. `server/services/coachService.ts` pipeline extraction

- File path: `server/services/coachService.ts`
- Code area: Auto Coach trigger orchestration, context building, style selection, RAG, safety checks, structured suggestions, DB transaction, review notes.
- Problem: `triggerAutoCoach` and neighboring helpers coordinate many concerns in one service.
- Why it matters: AI coach is sensitive to user data, budget, external AI behavior, and structured exercise-table semantics.
- Recommended refactor: Extract pipeline steps: run preparation, context/RAG assembly, suggestion planning, plan apply transaction, and review-note generation.
- Tradeoffs: Too many tiny modules would be worse; extract only boundaries that can be unit-tested.
- Priority: P2

### 8. Integration module split

- File path: `server/garmin.ts`, `server/strava.ts`
- Code area: OAuth route handling, provider clients, sync/import mapping, disconnect behavior, circuit/rate handling.
- Problem: Provider integrations are not organized like the rest of the API and service layers.
- Why it matters: Integrations need isolated tests for external failure modes and provider-specific behavior.
- Recommended refactor: Move to `server/integrations/garmin/*` and `server/integrations/strava/*` with routes, provider client, sync service, mapper, and state helpers.
- Tradeoffs: Medium-sized move with import churn.
- Priority: P2

### 9. Docs and contract-source refresh

- **Status (May 17, 2026)**: Partially addressed by the targeted documentation
  sync that updated client, integration, testing, and architecture docs. Continue
  treating docs as a contract surface after meaningful route or workflow changes.
- File path: `README.md`, `docs/client.md`, `docs/server.md`, `docs/testing.md`, `docs/api-reference.md`, `shared/openapi.ts`
- Code area: Toolchain docs, route docs, testing docs, OpenAPI source.
- Problem: Docs still contain older Vite/TypeScript/test-count references and old route descriptions (e.g., test counts in `docs/testing.md` may lag actuals).
- Why it matters: Stale docs are a multiplier on future maintenance cost.
- Recommended refactor: Treat docs as a contract surface and update them after route/use-case composition decisions.
- Tradeoffs: Low technical risk but should not be mixed with production refactors.
- Priority: P2

### 10. Onboarding test stability before UI refactors

- **Status (May 17, 2026)**: Historical note. Durable onboarding completion and
  safe-storage handling were implemented after this snapshot; re-run current
  focused onboarding tests before treating these exact failures as open.
- File path: `client/src/components/OnboardingWizard.test.tsx`, `client/src/components/OnboardingWizard.tsx`
- Code area: Onboarding flow tests.
- Problem: At the time of the May 3 snapshot, the full Vitest run failed two tests in `OnboardingWizard.test.tsx`.
- Why it matters: Large UI refactors should not proceed with known failing tests in adjacent client flows.
- Recommended refactor: Stabilize or repair the failing tests before broader client decomposition.
- Tradeoffs: This is test-health work, not architecture, but it protects later changes.
- Priority: P1

## Scalability Concerns
- **Rate Limiting**: Now uses PostgreSQL-backed `rate_limit_buckets` outside tests, so per-user limits are shared across app replicas. Continue monitoring write volume if traffic grows enough to justify Redis.
- **N+1 Queries**: Generally well-managed, but `attachExerciseSets` in `TimelineStorage` still performs two separate batch fetches. Could be optimized with a single join if the timeline was unified.

## Modularity and Boundary Issues
- **External Integrations**: Strava and Garmin logic are well-isolated in their respective mappers, but error handling for these integrations is slightly inconsistent compared to the main API.

## Testing Recommendations

1. Re-run focused tests before assuming historical failures still exist.
   - The OnboardingWizard failures listed in the May 3 snapshot were historical
     baseline failures. Durable onboarding completion and related tests changed
     after this review.
   - Why: refactor planning should start from the current test baseline, not this
     dated command output.

2. Add owner-parity tests for structured exercise-set mutations.
   - Cover workout-log and plan-day owners with the same behavior table.
   - Files to target: `server/usecases/workouts/mutateWorkoutSet.usecase.test.ts`, `server/storage/__tests__/workouts.test.ts`, `client/src/hooks/__tests__/...`.

3. Expand route-builder tests before migrating more routes.
   - Current test file: `server/routes/__tests__/protectedRouteBuilder.test.ts`.
   - Add cases for AI consent, AI budget, custom middleware ordering, validation failure, and async errors.

4. Maintain Timeline surface coverage after the shell split.
   - Existing tests such as `client/src/pages/__tests__/Timeline.clickLoop.test.tsx`, `Timeline.missed-routing.test.tsx`, `Timeline.surfaceSync.test.tsx`, and focused timeline component tests are the current anchors.
   - Add new cases around future planned, today planned, completed, skipped, missed, URL workout ID, and sheet close behavior when those flows change.

5. Maintain ExerciseTable extraction tests around pure behavior.
   - Cover field resolution, planned-vs-actual diff rendering, row reorder calls, add/delete behavior, and keyboard/a11y affordances as the extracted modules evolve.

6. Add OpenAPI/route contract checks for documented high-traffic endpoints.
   - Start with workout create/update, plan-day set mutations, timeline list, and AI suggestion apply.

7. Keep operational tests for scheduler/limiter abstractions current.
   - Shared rate limiting and short-lived runtime state now use PostgreSQL-backed tables outside tests.
   - Cron jobs are guarded by PostgreSQL advisory locks; tests should continue proving lock-key uniqueness, skip behavior, and release-on-throw.

8. Keep integration and Cypress tests targeted.
   - Leverage the existing testing pyramid (Vitest unit, integration, and Cypress E2E specs) as outlined in `docs/testing.md`.
   - Full Cypress was not needed for this analysis-only pass, but individual specs (like `cypress/e2e/timeline.cy.ts`) should be part of UI refactor PR validation.

9. Maintain Accessibility (a11y) test coverage.
   - Continue the practice of pairing UI components with `*.a11y.test.tsx` files using `jest-axe` to prevent regressions during extractions.

## Suggested Migration Roadmap
1. **Quick Wins (Week 1)**: Normalize `custom-exercises` validation, await email job enqueues, and fix the Strava skipped-counter reported in `CODEBASE_AUDIT.md`.
2. **Medium Refactors (Week 2-3)**: Complete the extraction of workout AI orchestration to `workoutUseCases.ts`. Refactor `plans.ts` to thin out route handlers.
3. **Architectural Improvements (Week 4+)**: Monitor PostgreSQL-backed runtime state under production traffic and migrate the timeline to a SQL-based unified query. Add Redis only if write volume, latency, or hosting topology justifies another service.

## PR-by-PR Refactoring Plan
1. **PR 1: Code Health - Core Wins**
   - Goal: Fix Strava counter, await email enqueues, and normalize custom-exercise validation.
   - Files: `server/strava.ts`, `server/emailScheduler.ts`, `server/routes/workouts/workoutsCrud.routes.ts`.
2. **PR 2: Refactor: Workout AI Use-Cases**
   - Goal: Extract reparse and image-parse logic from routes to services.
   - Files: `server/routes/workouts/workoutsAi.routes.ts`, `server/services/workoutUseCases.ts`.
3. **PR 3: Refactor: Plan Management Services**
   - Goal: Thin out `server/routes/plans.ts` by moving business logic to `planService.ts`.
   - Files: `server/routes/plans.ts`, `server/services/planService.ts`.
4. **PR 4: Runtime State Follow-Up**
   - Status: Superseded by PostgreSQL-backed rate limits/runtime cache and advisory-locked cron jobs.
   - Next goal: monitor the shared runtime-state tables and add Redis only if real traffic shows Postgres is the wrong store.
   - Files: `server/rateLimitStore.ts`, `server/sharedRuntimeState.ts`, `server/advisoryLock.ts`, `server/env.ts`.

## Commands Run

These command notes are historical from the May 3 review pass and should not be
read as current verification results.
- `ls -F`: Passed.
- `cat package.json README.md`: Passed.
- `ls -R shared/schema server/routes server/services client/src/pages client/src/components`: Passed.
- `cat shared/schema/index.ts shared/schema/types.ts server/storage/IStorage.ts`: Passed.
- `cat server/storage/workouts.ts`: Passed.
- `pnpm check`: Failed (missing node_modules).
- `pnpm test:smoke`: Failed (missing node_modules).
- `grep` / `ls` / `cat` for various code patterns: All passed.

*Note: During the latest review pass on May 3, 2026, no new terminal commands were executed due to cloud environment restrictions.*

## Limitations

These limitations describe the May 3 review environment. They are retained for
auditability, not as statements about the current local workspace.

- `rg --files` could not run in this environment because `rg.exe` returned `Access is denied`; I used `git ls-files`, `git grep`, `Get-Content`, and `Select-String` instead.
- One extension-count command partially failed on a path containing characters PowerShell treated as illegal; this did not block inspection because `git ls-files` and targeted file reads still worked.
- I did not run `pnpm run build` because the build writes production artifacts and this task allowed only the architecture review document to be created or updated.
- I did not run Cypress because there were no production UI changes to validate and Cypress/browser runs are heavier than needed for this analysis-only report.
- I did not run database-backed integration tests separately because they require environment setup beyond static/code inspection and the normal Vitest run already exposed current test failures.
- The full Vitest suite could not run inside the sandbox due `spawn EPERM`; when rerun outside the sandbox, it completed but failed the two OnboardingWizard tests listed above.
- This review is based on local source inspection and configured read-only analysis commands. I did not inspect production telemetry, database query plans, real data volumes, or deployment topology, so scaling findings that depend on multi-instance deployment are called out as risks rather than current production incidents.
- **May 3, 2026 Update**: The latest pass was limited to static file inspection (leveraging `docs/testing.md` and module configurations). Shell execution and live command running were unavailable in the current cloud sandbox turn.
