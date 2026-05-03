# Codebase Architecture Review

*Last Updated: May 3, 2026*

## Executive Summary

Hyrox-Companion is a mature TypeScript full-stack application: a React/Vite PWA in `client/`, an Express REST API in `server/`, and shared Drizzle/Zod contracts in `shared/`. The current architecture is workable and does not need a rewrite. The highest-value path is to finish the modularization already started in the codebase, reduce duplicated workout/exercise-table flows, and harden the operational model for multiple app instances.

The strongest current practices are shared schemas, route-level validation, clear domain vocabulary, Sentry/logging hooks, pg-boss background work, and a broad Vitest/Cypress test footprint. TypeScript passes with `pnpm exec tsc --noEmit --incremental false`; ESLint exits successfully with one existing import-sort warning in `server/storage/timeline.ts`.

The main architectural risks are concentrated in these areas:

- `server/index.ts` still owns too much startup, middleware, health, observability, maintenance, static serving, and shutdown behavior while `server/bootstrap/*` helper modules exist but are not wired in.
- Exercise-set behavior is duplicated for workout logs and plan days across server storage/routes/use cases and client hooks/API modules.
- Route middleware conventions are only partially consolidated; `protectedRouteBuilder` is used in some routes while many others still hand-compose auth, rate limiting, AI consent/budget checks, validation, and async handling.
- The timeline and workout-detail UI surfaces are still large orchestration modules (`client/src/pages/Timeline.tsx` and `client/src/components/workout-detail/ExerciseTable.tsx`) despite useful supporting hooks/components.
- Horizontal scaling is not fully ready: rate limiting is in-memory, cron jobs are process-local, startup maintenance runs per process, and several caches are per-instance.
- Documentation and contract references lag the package manifest and route behavior in a few places.

This roadmap favors small, reviewable PRs with tests before moving high-risk behavior. The best first moves are stabilizing current test failures, deleting or wiring unused bootstrap shims, centralizing exercise field metadata, finishing route-builder migration, and extracting an owner-agnostic exercise-set service/hook.

## Current Architecture

### Application Type

Hyrox-Companion is a training planner, workout logger, analytics, and AI coaching app for HYROX-style athletes. It is a single-package TypeScript repo with a browser client, an API server, shared schemas, background jobs, external integrations, and AI/RAG services.

### Languages, Frameworks, Package Manager, Runtime

- Runtime: Node.js 20+ per `package.json`; local command output showed Node `v22.20.0`.
- Package manager: pnpm; local command output showed pnpm `9.12.0`.
- Language: TypeScript with strict checking in `tsconfig.json`.
- Client: React 18, Vite 6, Wouter, TanStack Query, Radix UI, Tailwind CSS 4, Workbox/PWA.
- Server: Express 4, Drizzle ORM, PostgreSQL, pgvector, Clerk auth, Sentry, pino, pg-boss, node-cron.
- AI/integrations: Google Gemini, RAG coaching materials, Strava, Garmin Connect, Resend email, web push.
- Tests: Vitest, Testing Library, jest-axe, Supertest, Cypress, smoke/integration configs.

### Main Entry Points

- Client mount and PWA/Sentry setup: `client/src/main.tsx`.
- Client app shell, providers, and routing: `client/src/App.tsx`.
- Server startup and app lifecycle: `server/index.ts`.
- API route composition: `server/routes.ts`.
- Workout route composition: `server/routes/workouts.ts`.
- Shared schema tables: `shared/schema/tables.ts`.
- Shared schema/type exports: `shared/schema/types.ts`.
- OpenAPI generation source: `shared/openapi.ts`.

### Major Modules

- `client/src/pages/`: page-level screens such as `Timeline.tsx`, `Dashboard.tsx`, `Settings.tsx`, `Analytics.tsx`, and training plan flows.
- `client/src/components/`: reusable UI, workout detail, timeline cards, onboarding, analytics, coach, and form components.
- `client/src/hooks/`: data and interaction hooks including `useTimelineData`, `useTimelineState`, `useWorkoutDetail`, `usePlanDayExercises`, `useWorkoutActions`, `useWorkoutEditor`, and shared mutation/debounce helpers.
- `client/src/lib/api/`: client API wrappers such as `workouts.ts`, `plans.ts`, `analytics.ts`, `client.ts`, and query helpers.
- `server/routes/`: Express route modules for auth, preferences, email, AI, analytics, workouts, plans, coaching, push, and timeline annotations.
- `server/routes/workouts/`: workout capability route modules for CRUD, AI/reparse, timeline, export, and shared route schemas.
- `server/services/`: application services for workouts, coaching, AI, RAG, analytics, exports, plan generation, emails, and training styles.
- `server/usecases/`: emerging use-case layer for workouts, plans, and AI.
- `server/storage/`: Drizzle-backed persistence facade and domain storage classes.
- `server/middleware/`: CSRF and AI budget middleware.
- `server/bootstrap/`: currently unused bootstrap helper modules.
- `server/garmin.ts` and `server/strava.ts`: root-level integration route/client/sync modules.
- `shared/schema/`: Drizzle tables, Zod schemas, inferred types, exercises, MAF helpers, and shared domain contracts.

### Main Data and Control Flow

1. Browser route components in `client/src/App.tsx` and `client/src/pages/*` render authenticated app surfaces.
2. Components and hooks call `client/src/lib/api/*` wrappers through TanStack Query and local mutation hooks.
3. Express routes in `server/routes.ts` mount auth, CSRF, integration routes, and feature routers.
4. Route handlers apply middleware from `server/routeGuards.ts`, `server/routeUtils.ts`, `server/middleware/aibudget.ts`, and validation helpers.
5. Handlers call services, use cases, or `server/storage/index.ts` directly.
6. Services coordinate business workflows, transactions, AI calls, queue jobs, RAG lookup, notifications, and storage writes.
7. Storage modules execute Drizzle queries against `db` and return shared typed entities.
8. Background work is triggered through pg-boss (`server/queue.ts`) and process-local cron (`server/cron.ts`).

### Primary Domain Concepts

- Users and preferences.
- Workout logs and exercise sets.
- Training plans and plan days.
- Timeline entries combining completed workouts and planned days.
- Custom exercises and structured exercise-table rows.
- AI parsing, chat, suggestions, Coach's Take, RAG materials, and usage budgets.
- Analytics, personal records, training overview, MAF metrics.
- External activity sync through Strava and Garmin.
- Emails, push subscriptions, idempotency keys, timeline annotations.

### Current Architectural Pattern

The codebase is a pragmatic layered monolith:

- UI and data hooks in the client.
- API routes as HTTP adapters.
- Services/use cases for workflows where already extracted.
- Storage classes as persistence adapters.
- Shared schema/types for contract alignment.

The pattern is not yet enforced consistently. Some routes are thin adapters; others still contain transaction orchestration. Some use cases exist but owner-specific flows bypass them. Some route helpers exist but only cover part of the route surface.

## Highest-Priority Findings

### 1. Server bootstrap split is incomplete

- Priority: P1
- Category: Modularity / separation of concerns
- Files involved: `server/index.ts`, `server/bootstrap/appConfig.ts`, `server/bootstrap/health.ts`, `server/bootstrap/lifecycle.ts`, `server/bootstrap/observability.ts`
- Problem: `server/index.ts` still handles Sentry setup, trust proxy, request parsing exceptions, CSP, compression, pino, request context, route/static mounting, startup maintenance, queue/cron startup, health probes, error handling, and shutdown/global process handlers. The `server/bootstrap/*` modules look like the intended decomposition but are not imported by `server/index.ts`.
- Evidence: The line-count scan found `server/index.ts` at 579 lines. `git grep` found `applyAppConfig`, `initObservability`, and `registerLifecycleHooks` only in their defining files. `server/index.ts` defines its own `HEALTH_PROBE_TIMEOUT_MS` while `server/bootstrap/health.ts` also contains health-probe logic.
- Why it matters: Startup behavior is high-blast-radius code. Having unused parallel bootstrap modules creates drift risk: future changes may update the wrong copy or wire in an incomplete helper that lacks the behavior currently in `server/index.ts`.
- Recommendation: In one focused PR, decide whether `server/bootstrap/*` is the target. If yes, update those modules to match current `server/index.ts` behavior and wire them in incrementally. If not, delete the unused helpers. Do not leave duplicate startup abstractions.
- Impact: High
- Effort: Medium
- Risk: Medium

### 2. Exercise-set ownership logic is duplicated across workout logs and plan days

- Priority: P1
- Category: Deduplication / domain modeling
- Files involved: `server/storage/workouts.ts`, `server/routes/workouts/workoutsCrud.routes.ts`, `server/routes/plans.ts`, `server/usecases/workouts/mutateWorkoutSet.usecase.ts`, `client/src/hooks/useWorkoutDetail.ts`, `client/src/hooks/usePlanDayExercises.ts`, `client/src/lib/api/workouts.ts`, `client/src/lib/api/plans.ts`, `shared/schema/types.ts`
- Problem: Workout-log exercise sets and plan-day exercise sets use the same conceptual row model, but the implementation is split by owner type across routes, storage methods, API wrappers, hooks, cache updates, optimistic updates, debounce behavior, and timeout handling.
- Evidence: Server storage has `addExerciseSetToWorkoutLog`, `updateExerciseSet`, `deleteExerciseSet`, plus `addExerciseSetToPlanDay`, `updateExerciseSetForPlanDay`, and `deleteExerciseSetForPlanDay` in `server/storage/workouts.ts`. `server/usecases/workouts/mutateWorkoutSet.usecase.ts` currently wraps only workout-log mutations. Client hooks explicitly document that `usePlanDayExercises` mirrors `useWorkoutDetail`; `git grep` found this in `client/src/hooks/usePlanDayExercises.ts` and `client/src/hooks/useWorkoutDetail.ts`. `client/src/lib/api/workouts.ts` and `client/src/lib/api/plans.ts` duplicate `IMAGE_REPARSE_TIMEOUT_MS = 60_000`.
- Why it matters: Table-backed workouts are a central domain path. Duplicated owner-specific mutation semantics make it easy for plan-day and workout-log behavior to drift, especially around optimistic updates, autosave flushes, permissions, reparse timeout behavior, and structured AI applies.
- Recommendation: Introduce a small owner-agnostic abstraction around `ExerciseSetOwner = { kind: "workoutLog"; id: string } | { kind: "planDay"; id: string }`. Use it first in server use cases, then client API wrappers, then a shared hook such as `useExerciseSetsForOwner`. Keep public endpoints stable until the behavior is fully covered by tests.
- Impact: High
- Effort: Medium
- Risk: Medium

### 3. Route middleware conventions are partially consolidated but inconsistent

- Priority: P1
- Category: Maintainability / security consistency
- Files involved: `server/routes/_helpers/protectedRouteBuilder.ts`, `server/routes/ai.ts`, `server/routes/plans.ts`, `server/routes/preferences.ts`, `server/routes/timelineAnnotations.ts`, `server/routes/workouts/workoutsAi.routes.ts`, `server/routes/workouts/workoutsCrud.routes.ts`, `server/garmin.ts`, `server/strava.ts`, `server/routeUtils.ts`, `server/middleware/aibudget.ts`
- Problem: The route builder exists and has tests, but many routes still hand-compose `protectedMutationGuards`, `rateLimiter(...)`, `aiConsentCheck`, `aiBudgetCheck`, `validateBody(...)`, `validateParams(...)`, and `asyncHandler(...)`. External integration modules register routes directly on `app`.
- Evidence: `git grep protectedMutationGuards` shows direct route stacks in AI, plans, preferences, timeline annotations, workout AI/CRUD, Garmin, Strava, and email routes. `protectedPost`, `protectedPatch`, and `protectedDelete` are used in only part of the route surface. `server/routes/ai.ts` contains several long one-line route registrations with different AI consent/budget combinations.
- Why it matters: Middleware ordering is part of the API security and cost-control contract. Hand-composed stacks increase the chance of missing a guard, applying AI budget checks to non-AI paths, or returning inconsistent validation errors.
- Recommendation: Extend the existing route builder instead of inventing a new routing framework. Add options for AI consent, AI budget, limiter, params/body validation, and custom middleware. Migrate route modules one at a time with route contract tests.
- Impact: High
- Effort: Medium
- Risk: Medium

### 4. Timeline and workout-detail UI modules still own too many responsibilities

- Priority: P1
- Category: Refactoring / testability
- Files involved: `client/src/pages/Timeline.tsx`, `client/src/hooks/useTimelineState.ts`, `client/src/hooks/useTimelineData.ts`, `client/src/hooks/useTimelineFilters.ts`, `client/src/components/workout-detail/ExerciseTable.tsx`, `client/src/hooks/useWorkoutEditor.ts`, `client/src/components/timeline/timeline-workout-card/TimelineWorkoutCard.tsx`
- Problem: The largest client surfaces mix UI rendering, domain decisions, modal/sheet coordination, routing side effects, optimistic state, drag/drop, row rendering, metric resolution, and planned-vs-actual comparisons.
- Evidence: The line-count scan found `client/src/components/workout-detail/ExerciseTable.tsx` at 851 lines and `client/src/pages/Timeline.tsx` at 798 lines. `Timeline.tsx` coordinates virtualized date groups, selection, coach panel, URL workout IDs, import/schedule/combine dialogs, annotation sheets, log/review sheets, and onboarding. `ExerciseTable.tsx` coordinates table layout, add-row flows, dnd-kit behavior, planned diffs, inline editing, expanded rows, and exercise metrics.
- Why it matters: These are high-traffic user flows. Large orchestration components make targeted fixes hard, make tests more expensive to write, and increase the chance of accidental routing or autosave regressions.
- Recommendation: Extract behavior behind existing tests, not as a rewrite. For Timeline, start with surface/dialog orchestration and click-routing helpers. For ExerciseTable, extract row rendering, drag/drop state, metric resolution, and planned-diff summaries.
- Impact: High
- Effort: Medium
- Risk: Medium

### 5. Horizontal scaling has confirmed process-local state

- Priority: P1
- Category: Scalability / operations
- Files involved: `server/routeUtils.ts`, `server/cron.ts`, `server/index.ts`, `server/maintenance.ts`, `server/routes/analytics.ts`, `server/services/ragService.ts`, `server/gemini/client.ts`, `server/clerkAuth.ts`
- Problem: Several mechanisms are explicitly per-process or in-memory: rate limiting, cron schedules, startup maintenance, RAG cache, analytics caches, embedding cache, and user-seen cache.
- Evidence: `server/routeUtils.ts` imports `MemoryStore` and comments that it is memory-backed, resets on restart, and is per-instance. `server/cron.ts` stores scheduled tasks in module-level variables and `server/index.ts` calls `startCron(storage)` during process startup. `server/maintenance.ts` runs startup maintenance from `server/index.ts`. `git grep "new Map"` found caches in `server/routes/analytics.ts`, `server/services/ragService.ts`, `server/gemini/client.ts`, and `server/clerkAuth.ts`.
- Why it matters: Per-instance state is acceptable on one server, but it produces inconsistent rate limits, duplicated cron jobs, duplicated startup work, lower cache hit rates, and harder cost control under multiple instances.
- Recommendation: Treat this as an operational readiness track. Move rate limiting to a shared store before horizontal scaling, put cron/maintenance behind a single scheduler or advisory lock, and document which caches are best-effort versus correctness-sensitive.
- Impact: High
- Effort: Medium/Large
- Risk: Medium

### 6. Integration modules mix routing, external clients, sync orchestration, and persistence mapping

- Priority: P2
- Category: Modularity / external integrations
- Files involved: `server/garmin.ts`, `server/strava.ts`, `server/routes.ts`
- Problem: Strava and Garmin live at the server root and each module combines route registration, OAuth/session logic, external API calls, circuit/rate logic, conversion/mapping, and storage writes.
- Evidence: `server/routes.ts` imports `registerGarminRoutes` from `server/garmin.ts` and `registerStravaRoutes` from `server/strava.ts`, while most other features live under `server/routes/*` plus services/storage. The line-count scan found `server/garmin.ts` at 559 lines; `server/strava.ts` also has route registration and sync logic in one file.
- Why it matters: External integrations are failure-prone and operationally sensitive. Mixing HTTP adapter, provider client, and import service makes it harder to test retry/circuit behavior and to add provider-specific error handling without affecting route behavior.
- Recommendation: Split each integration incrementally into `routes`, `client`, `syncService`, `mapper`, and `state` modules under `server/integrations/{strava,garmin}/`. Keep the existing route registration functions as compatibility entry points until tests cover the split.
- Impact: Medium
- Effort: Medium
- Risk: Medium

### 7. Documentation and generated-contract sources have drift

- Priority: P2
- Category: Maintainability / contributor safety
- Files involved: `README.md`, `docs/client.md`, `docs/testing.md`, `docs/server.md`, `docs/api-reference.md`, `package.json`, `shared/openapi.ts`, `server/routes/workouts.ts`, `server/routes/workouts/index.ts`
- Problem: Several docs still describe older toolchain versions or older route organization. `package.json` is on TypeScript 6.0.3 and Vite 6.4.2, while `README.md` and `docs/client.md` mention Vite 5 and TypeScript 5.9. `docs/server.md` and `docs/api-reference.md` still point at `server/routes/workouts.ts` without explaining the current capability modules.
- Evidence: `Select-String` found `README.md:79` and `docs/client.md:8-9` referencing Vite 5 / TypeScript 5.9; `package.json` lists `typescript` `6.0.3` and `vite` `^6.4.2`. `server/routes/workouts.ts` now composes capability modules, and `server/routes/workouts/index.ts` is a compatibility wrapper that imports `../workouts`.
- Why it matters: Stale docs create avoidable PR churn and can lead contributors to patch the wrong module or downgrade toolchain assumptions.
- Recommendation: Add a lightweight docs/contract sync PR after architecture changes are planned. Update toolchain versions, route organization, and OpenAPI/source-of-truth notes. Consider a route-contract smoke test for documented high-traffic endpoints.
- Impact: Medium
- Effort: Small
- Risk: Low

## Deduplication Opportunities

### 1. Exercise-set owner mutations

- Files involved: `server/storage/workouts.ts`, `server/routes/workouts/workoutsCrud.routes.ts`, `server/routes/plans.ts`, `server/usecases/workouts/mutateWorkoutSet.usecase.ts`, `client/src/hooks/useWorkoutDetail.ts`, `client/src/hooks/usePlanDayExercises.ts`, `client/src/lib/api/workouts.ts`, `client/src/lib/api/plans.ts`
- Symbols/functions/classes involved: `WorkoutStorage.addExerciseSetToWorkoutLog`, `WorkoutStorage.updateExerciseSet`, `WorkoutStorage.deleteExerciseSet`, `WorkoutStorage.addExerciseSetToPlanDay`, `WorkoutStorage.updateExerciseSetForPlanDay`, `WorkoutStorage.deleteExerciseSetForPlanDay`, `createMutateWorkoutSetUseCase`, `useWorkoutDetail`, `usePlanDayExercises`
- What is duplicated: Same exercise-set row mutation lifecycle split across workout-log owner and plan-day owner paths.
- Why it matters: This is the highest-risk domain duplication because structured exercise rows feed logging, planned workouts, Coach's Take, AI suggestion applies, and editor autosave behavior.
- Recommended shared abstraction: Owner-aware server use case and storage adapter with a discriminated owner type. Mirror that with a client `useExerciseSetOwner` hook and owner-aware API methods. Keep existing route URLs as adapters.
- Impact: High
- Effort: Medium
- Risk: Medium

### 2. Route guard, limiter, validation, async wrapper stacks

- Files involved: `server/routes/_helpers/protectedRouteBuilder.ts`, `server/routes/ai.ts`, `server/routes/plans.ts`, `server/routes/preferences.ts`, `server/routes/timelineAnnotations.ts`, `server/routes/workouts/workoutsAi.routes.ts`, `server/routes/workouts/workoutsCrud.routes.ts`, `server/garmin.ts`, `server/strava.ts`
- Symbols/functions/classes involved: `protectedPost`, `protectedPatch`, `protectedDelete`, `protectedMutationGuards`, `rateLimiter`, `validateBody`, `validateParams`, `aiConsentCheck`, `aiBudgetCheck`, `asyncHandler`
- What is duplicated: HTTP mutation route scaffolding and middleware ordering.
- Why it matters: Inconsistent route stacks create security, cost-control, and error-contract drift.
- Recommended shared abstraction: Expand `protectedRouteBuilder` into a small typed builder that composes guards and lets callers specify route-specific middleware in declared order.
- Impact: High
- Effort: Medium
- Risk: Medium

### 3. Exercise field metadata and field resolution

- Files involved: `client/src/components/ExerciseInput.tsx`, `client/src/components/exercise-row/fieldMeta.ts`, `client/src/components/workout/ExerciseRow.tsx`
- Symbols/functions/classes involved: local `fieldConfig`, local `fieldMeta`, local `fieldsCache`, local `getFields`
- What is duplicated: Field label/step metadata and cached field-resolution logic for `reps`, `weight`, `distance`, and `time`.
- Why it matters: A change to distance display, weight increments, or default visible fields can drift between planned workout rows, draft workout rows, and exercise input surfaces.
- Recommended shared abstraction: Move field metadata and `getFields` into one module such as `client/src/components/exercise-row/fieldMeta.ts` or `client/src/lib/exerciseFields.ts`, then consume it from all exercise row/input variants.
- Impact: Medium
- Effort: Small
- Risk: Low

### 4. Image reparse API timeout constants

- Files involved: `client/src/lib/api/workouts.ts`, `client/src/lib/api/plans.ts`
- Symbols/functions/classes involved: `IMAGE_REPARSE_TIMEOUT_MS`
- What is duplicated: The same `60_000` timeout constant for image parsing/reparse API calls.
- Why it matters: Timeout policy for image parsing is shared AI behavior; duplicated constants are easy to update in only one owner path.
- Recommended shared abstraction: Move to a small API constants module such as `client/src/lib/api/constants.ts`.
- Impact: Low
- Effort: Small
- Risk: Low

### 5. Workout route composition compatibility wrappers

- Files involved: `server/routes/workouts.ts`, `server/routes/workouts/index.ts`, `server/routes/__tests__/workouts.partition.test.ts`
- Symbols/functions/classes involved: default `workoutRoutes`, default `composedRouter`, `registerWorkoutAiRoutes`, `registerWorkoutCrudRoutes`, `registerWorkoutTimelineRoutes`, `registerWorkoutExportRoutes`
- What is duplicated: There are two importable workout router entry points. `server/routes.ts` imports `./routes/workouts`, which resolves to `server/routes/workouts.ts`; `server/routes/workouts/index.ts` imports `../workouts` as a compatibility composition point.
- Why it matters: File-vs-directory ambiguity is confusing for future refactors and docs. It also makes route ownership look split when the active route entry is still the root file.
- Recommended shared abstraction: Pick one composition point. Prefer moving the composition into `server/routes/workouts/index.ts` and updating imports/tests, then deleting the ambiguous root wrapper in a low-risk PR.
- Impact: Medium
- Effort: Small
- Risk: Low

### 6. Storage modularization shims

- Files involved: `server/storage/workouts.ts`, `server/storage/workouts/crud.ts`, `server/storage/workouts/customExercises.ts`, `server/storage/workouts/timeline.ts`
- Symbols/functions/classes involved: `WorkoutStorage`, `WorkoutCustomExerciseStorage`, `WorkoutTimelineStorage`
- What is duplicated: The subfolder modules are currently re-export aliases of the monolithic `WorkoutStorage`, not real separated implementations.
- Why it matters: The folder layout suggests modular storage boundaries that do not actually exist, which can mislead maintainers and keep the monolithic file growing.
- Recommended shared abstraction: Either remove the shim files or perform a real split into repository modules by capability. Do this after route/use-case coverage is in place.
- Impact: Medium
- Effort: Medium
- Risk: Medium

### 7. Analytics and timeline query limits

- Files involved: `server/storage/shared.ts`, `server/constants.ts`, `server/routes/workouts/workoutsTimeline.routes.ts`, `client/src/lib/api/analytics.ts`, `client/src/hooks/useTimelineData.ts`
- Symbols/functions/classes involved: `MAX_WORKOUT_LOGS_PER_QUERY`, `DEFAULT_TIMELINE_LIMIT`, `parsePagination`, `api.timeline.get`, `useTimelineData`
- What is duplicated or divergent: Related bounded-query policy lives in multiple places. Timeline has a 500-entry default cap, analytics has a 5000-log cap, and the client timeline wrapper does not expose pagination options.
- Why it matters: As long-lived users accumulate data, each feature may truncate, paginate, or cache differently.
- Recommended shared abstraction: Create explicit query-window contracts for timeline and analytics, return pagination/truncation metadata, and expose timeline pagination in `client/src/lib/api/analytics.ts`.
- Impact: Medium
- Effort: Medium
- Risk: Low

## Refactoring Opportunities

### 1. `server/index.ts` bootstrap decomposition

- File path: `server/index.ts`
- Code area: App creation, Sentry, request middleware, health probes, startup maintenance, queues, cron, static/Vite serving, error handling, shutdown.
- Problem: The file is the largest operational hotspot and has unused neighboring bootstrap modules.
- Why it matters: Startup and shutdown bugs affect every request and deploy.
- Recommended refactor: Wire or remove `server/bootstrap/*` in stages: observability first, app config/middleware second, health third, lifecycle fourth. Use existing tests plus a smoke route check.
- Tradeoffs: More files and imports, but smaller operational units and fewer duplicate startup paths.
- Priority: P1

### 2. Owner-agnostic exercise-set use case

- File path: `server/usecases/workouts/mutateWorkoutSet.usecase.ts`, `server/storage/workouts.ts`, `server/routes/plans.ts`, `server/routes/workouts/workoutsCrud.routes.ts`
- Code area: Structured exercise set CRUD for workout logs and plan days.
- Problem: The current use case only covers workout-log owner paths, while plan-day owner paths still call storage directly.
- Why it matters: Structured table behavior must stay consistent across planned and completed workouts.
- Recommended refactor: Replace the workout-only use case with an owner-aware `mutateExerciseSet.usecase.ts` and migrate route handlers behind it.
- Tradeoffs: Slightly more indirection and discriminated-type handling.
- Priority: P1

### 3. Client exercise-set hook consolidation

- File path: `client/src/hooks/useWorkoutDetail.ts`, `client/src/hooks/usePlanDayExercises.ts`, `client/src/hooks/useDebouncedSetPatches.ts`, `client/src/lib/api/workouts.ts`, `client/src/lib/api/plans.ts`
- Code area: Fetching, optimistic mutation, debounced patches, save-state management, and cache updates for exercise sets.
- Problem: Plan-day and workout detail hooks mirror each other.
- Why it matters: Autosave and structured row editing have a history of subtle regressions; duplication doubles the patch surface.
- Recommended refactor: Extract a lower-level owner-aware hook that handles query keys, mutation state, debounced patch flushing, and optimistic cache updates.
- Tradeoffs: Hook API design needs care to avoid over-generalizing UI-specific behavior.
- Priority: P1

### 4. `client/src/pages/Timeline.tsx` surface orchestration split

- File path: `client/src/pages/Timeline.tsx`
- Code area: Timeline page interactions, dialogs/sheets, click routing, coach panel, plan selection, virtualization.
- Problem: One page component owns many independent surfaces.
- Why it matters: Timeline is central and already has focused regression tests; the current file size makes feature work and review slower.
- Recommended refactor: Extract `useTimelineSurfaces`, `TimelineDialogs`, and click-routing helpers. Keep rendering shape stable and migrate one surface group per PR.
- Tradeoffs: More component boundaries, but clearer ownership and easier tests.
- Priority: P1

### 5. `ExerciseTable.tsx` row/render/dnd decomposition

- File path: `client/src/components/workout-detail/ExerciseTable.tsx`
- Code area: Structured table display/editing, planned diffs, dnd-kit behavior, row menus, add/edit flows.
- Problem: DnD state, table rendering, domain metric calculations, and row editing live together.
- Why it matters: This component drives both completed and planned exercise tables, which are key to the AI coach and manual logging workflows.
- Recommended refactor: Extract `useExerciseTableDnd`, `ExerciseTableRow`, `PlannedDiffSummary`, and pure metric helpers. Use existing `ExerciseTable.test.tsx` coverage as the safety net.
- Tradeoffs: Component boundaries need to preserve keyboard and drag/drop behavior.
- Priority: P1

### 6. `server/services/workoutService.ts` orchestration split

- File path: `server/services/workoutService.ts`
- Code area: Workout creation, update, import/enrichment, exercise parsing, set mapping, coaching scheduling, transactions.
- Problem: The file remains a large domain service at 742 lines and mixes several workflow types.
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

- File path: `README.md`, `docs/client.md`, `docs/server.md`, `docs/testing.md`, `docs/api-reference.md`, `shared/openapi.ts`
- Code area: Toolchain docs, route docs, testing docs, OpenAPI source.
- Problem: Docs still contain older Vite/TypeScript/test-count references and old route descriptions (e.g., test counts in `docs/testing.md` may lag actuals).
- Why it matters: Stale docs are a multiplier on future maintenance cost.
- Recommended refactor: Treat docs as a contract surface and update them after route/use-case composition decisions.
- Tradeoffs: Low technical risk but should not be mixed with production refactors.
- Priority: P2

### 10. Onboarding test stability before UI refactors

- File path: `client/src/components/OnboardingWizard.test.tsx`, `client/src/components/OnboardingWizard.tsx`
- Code area: Onboarding flow tests.
- Problem: The full Vitest run currently fails two tests in `OnboardingWizard.test.tsx`.
- Why it matters: Large UI refactors should not proceed with known failing tests in adjacent client flows.
- Recommended refactor: Stabilize or repair the failing tests before broader client decomposition.
- Tradeoffs: This is test-health work, not architecture, but it protects later changes.
- Priority: P1

## Scalability Concerns

### 1. In-memory rate limiting

- Evidence from the code: `server/routeUtils.ts` imports `MemoryStore`, uses `limiterCache`, and includes a comment that MemoryStore is memory-backed, resets on restart, and is per-instance.
- Likely failure mode as usage grows: Multiple app instances will each enforce their own limits. Users can exceed intended global limits by distributing requests across instances, and limits reset on restarts.
- Recommended improvement: Use a shared limiter store before horizontal scaling. Redis is the common path, but a database-backed limiter can work if traffic is modest and latency is acceptable.
- Confirmed problem or theoretical risk: Confirmed horizontal-scaling limitation; only a problem once there is more than one instance or frequent restarts.
- Priority: P1
- Effort: Medium

### 2. Process-local cron jobs

- Evidence from the code: `server/cron.ts` holds scheduled tasks in module-level variables and `server/index.ts` calls `startCron(storage)` during startup.
- Likely failure mode as usage grows: Every app process can schedule daily email checks, idempotency cleanup, AI usage cleanup, stale auto-coach checks, and queue-depth monitoring. This can duplicate notifications or increase unnecessary database/API load unless downstream paths are fully idempotent.
- Recommended improvement: Move scheduled work to a single platform scheduler, pg-boss scheduled jobs, or a Postgres advisory-lock leader election.
- Confirmed problem or theoretical risk: The code is confirmed process-local; duplicate side effects are a risk under multi-instance deployment.
- Priority: P1
- Effort: Medium

### 3. Startup maintenance and migrations run from app startup

- Evidence from the code: `server/index.ts` calls startup maintenance and imports `server/maintenance.ts`, which includes migration/schema/cleanup style behavior.
- Likely failure mode as usage grows: Multiple instances can run maintenance at once during deploys. Even if idempotent, this slows startup and creates noisy operational failures.
- Recommended improvement: Move schema migration and heavy maintenance to release-phase jobs. Keep only cheap, idempotent health checks in app startup.
- Confirmed problem or theoretical risk: Confirmed startup behavior; failure mode depends on deploy topology.
- Priority: P1
- Effort: Medium

### 4. Timeline pagination is server-bounded but not client-exposed

- Evidence from the code: `server/constants.ts` defines `DEFAULT_TIMELINE_LIMIT = 500`; `server/routes/workouts/workoutsTimeline.routes.ts` caps limit to that value; `client/src/lib/api/analytics.ts` exposes `timeline.get(planId?)` without limit/offset; `client/src/hooks/useTimelineData.ts` calls `api.timeline.get(selectedPlanId)`.
- Likely failure mode as usage grows: Long-lived users can silently receive only the first 500 timeline entries, and the UI has no visible path to fetch older windows.
- Recommended improvement: Add explicit pagination/windowing to the timeline API wrapper and UI. Return pagination metadata and make the current 500 limit a documented page size rather than an implicit cap.
- Confirmed problem or theoretical risk: Confirmed cap and missing client pagination; user-facing impact depends on user history size.
- Priority: P2
- Effort: Medium

### 5. Analytics truncation cap is internal

- Evidence from the code: `server/storage/shared.ts` defines `MAX_WORKOUT_LOGS_PER_QUERY = 5000` and logs when the limit is hit.
- Likely failure mode as usage grows: Analytics can silently exclude older data for high-volume users unless the caller constrains date ranges or receives truncation metadata.
- Recommended improvement: Require or default date windows for heavier analytics endpoints, return truncation metadata, and expose UI copy/actions when a query window is capped.
- Confirmed problem or theoretical risk: Confirmed internal cap; impact is theoretical until users exceed the threshold.
- Priority: P2
- Effort: Medium

### 6. Per-instance caches reduce consistency and observability

- Evidence from the code: `git grep "new Map"` found process-local caches in `server/routes/analytics.ts`, `server/services/ragService.ts`, `server/gemini/client.ts`, and `server/clerkAuth.ts`.
- Likely failure mode as usage grows: Cache hit rates vary by instance, memory use is bounded by entry count rather than total bytes in some paths, and invalidation is local.
- Recommended improvement: Document which caches are best-effort and add metrics for hit/miss/eviction. Only move to shared caching where the cost/latency profile justifies it.
- Confirmed problem or theoretical risk: Confirmed per-instance implementation; mostly performance risk, not correctness risk.
- Priority: P2
- Effort: Small/Medium

### 7. AI budget check fails open

- Evidence from the code: `server/middleware/aibudget.ts` catches budget-check errors, logs `AI budget check failed - allowing request`, and calls `next()`.
- Likely failure mode as usage grows: If budget storage is unavailable, AI traffic can continue without spend enforcement, increasing cost exposure during outages.
- Recommended improvement: Keep the user-friendly fail-open policy if intentional, but add alerting, a kill-switch runbook using `AI_FEATURES_ENABLED`, and tests for outage behavior. For expensive endpoints, consider a fail-closed option by environment.
- Confirmed problem or theoretical risk: Confirmed fail-open behavior; cost impact is a risk under budget-service failure.
- Priority: P2
- Effort: Small

### 8. Queue and AI concurrency are per-process unless globally bounded elsewhere

- Evidence from the code: `server/index.ts` starts queue work during app startup; AI services call Gemini and related workflows from request/job paths.
- Likely failure mode as usage grows: Multiple workers can increase external API concurrency beyond what a single-process mental model suggests.
- Recommended improvement: Define global concurrency limits through pg-boss worker settings or a shared limiter, especially for Gemini-heavy workflows.
- Confirmed problem or theoretical risk: The startup behavior is confirmed; global concurrency impact is a risk to validate against pg-boss configuration and deployment topology.
- Priority: P2
- Effort: Medium

## Modularity and Boundary Issues

### 1. Routes sometimes bypass use cases and call storage or `db.transaction` directly

- Current structure: Some routes delegate to use cases, while others call storage directly. `server/routes/workouts/workoutsCrud.routes.ts` contains a direct `db.transaction` for workout combine. `server/routes/plans.ts` calls plan-day exercise-set storage methods directly.
- Why it is a problem: HTTP adapters become coupled to persistence details and transaction boundaries, making business behavior harder to test outside Express.
- Recommended target structure: Routes validate/authenticate and call use cases. Use cases own workflow orchestration and transactions. Storage owns query details.
- Incremental migration path: Start with combine-workouts and plan-day exercise-set mutations, because they already have nearby workflow seams.

### 2. Workout storage has a monolithic class plus placeholder submodules

- Current structure: `server/storage/workouts.ts` contains workout, custom exercise, set, history, and plan-day-adjacent behavior. `server/storage/workouts/crud.ts`, `customExercises.ts`, and `timeline.ts` re-export `WorkoutStorage`.
- Why it is a problem: The folder suggests module boundaries that do not actually exist, and all changes still converge on the monolith.
- Recommended target structure: Split repositories by persistence capability only after service/use-case tests protect behavior.
- Incremental migration path: First move domain calculations out of storage into pure helpers/services. Then split storage methods by query ownership.

### 3. External integrations are outside the route/service structure

- Current structure: `server/garmin.ts` and `server/strava.ts` are imported directly by `server/routes.ts` and register routes themselves.
- Why it is a problem: It creates a separate architectural style for integrations and makes provider testing/mocking heavier.
- Recommended target structure: `server/integrations/{provider}/routes.ts`, `client.ts`, `syncService.ts`, `mapper.ts`, `state.ts`.
- Incremental migration path: Move pure mapping functions first, then provider clients, then route registration wrappers.

### 4. Feature UI boundaries are present but not fully enforced

- Current structure: Timeline and workout-detail modules use supporting hooks/components, but the top-level surfaces still coordinate many feature concerns.
- Why it is a problem: UI behavior changes require understanding broad component state, routing, query cache, and modal interactions at once.
- Recommended target structure: Feature-specific surface components with hooks for orchestration and pure helpers for classification/formatting.
- Incremental migration path: Extract behavior that already has tests, starting with timeline click routing and exercise-table field/metric helpers.

### 5. Shared schemas are central and growing

- Current structure: `shared/schema/tables.ts` and `shared/schema/types.ts` are large shared contract modules.
- Why it is a problem: Central schema files are useful, but continued growth makes domain ownership less obvious and increases import churn.
- Recommended target structure: Keep one public `@shared/schema` export surface, but split implementation files by domain behind that barrel.
- Incremental migration path: Only split when touching a domain for other reasons; avoid a broad schema move PR by itself unless import churn is isolated and tests are green.

### 6. API docs and source routing do not share a single contract loop

- Current structure: `shared/openapi.ts` exists, route contract tests exist for workouts, and docs include manually written endpoint references.
- Why it is a problem: Manual docs drift from route behavior and package versions.
- Recommended target structure: Treat OpenAPI and route-contract tests as the source for endpoint docs where practical.
- Incremental migration path: Add contract assertions for the highest-traffic endpoints, then refresh docs in a dedicated PR.

## Testing Recommendations

1. Stabilize the current Vitest failures before broad client refactors.
   - Current failures: `client/src/components/OnboardingWizard.test.tsx:93` times out in `shows error toast when preferences mutation fails`; `client/src/components/OnboardingWizard.test.tsx:130` cannot find `Continue` in `completes onboarding when an AI plan is generated`.
   - Why: Timeline and workout-detail refactors should not land on top of a red baseline.

2. Add owner-parity tests for structured exercise-set mutations.
   - Cover workout-log and plan-day owners with the same behavior table.
   - Files to target: `server/usecases/workouts/mutateWorkoutSet.usecase.test.ts`, `server/storage/__tests__/workouts.test.ts`, `client/src/hooks/__tests__/...`.

3. Expand route-builder tests before migrating more routes.
   - Current test file: `server/routes/__tests__/protectedRouteBuilder.test.ts`.
   - Add cases for AI consent, AI budget, custom middleware ordering, validation failure, and async errors.

4. Add Timeline surface tests before splitting `Timeline.tsx`.
   - Existing tests such as `client/src/pages/__tests__/Timeline.clickLoop.test.tsx` and `Timeline.missed-routing.test.tsx` are good anchors.
   - Add tests for future planned, today planned, completed, skipped, missed, URL workout ID, and sheet close behavior.

5. Add ExerciseTable extraction tests around pure behavior.
   - Cover field resolution, planned-vs-actual diff rendering, row reorder calls, add/delete behavior, and keyboard/a11y affordances.

6. Add OpenAPI/route contract checks for documented high-traffic endpoints.
   - Start with workout create/update, plan-day set mutations, timeline list, and AI suggestion apply.

7. Add operational tests for scheduler/limiter abstractions when introduced.
   - For shared rate limiting, test that key construction and limit policy remain compatible.
   - For cron locking, test that only one process would run a scheduled job when lock acquisition fails.

8. Keep integration and Cypress tests targeted.
   - Leverage the existing testing pyramid (Vitest unit, integration, and Cypress E2E specs) as outlined in `docs/testing.md`.
   - Full Cypress was not needed for this analysis-only pass, but individual specs (like `cypress/e2e/timeline.cy.ts`) should be part of UI refactor PR validation.

9. Maintain Accessibility (a11y) test coverage.
   - Continue the practice of pairing UI components with `*.a11y.test.tsx` files using `jest-axe` to prevent regressions during extractions.

## Suggested Migration Roadmap

### Quick Wins

1. Stabilize `client/src/components/OnboardingWizard.test.tsx` so the full Vitest suite is green again.
2. Update stale toolchain docs in `README.md` and `docs/client.md` to match TypeScript 6.0.3 and Vite 6.4.2.
3. Resolve the existing ESLint import-sort warning in `server/storage/timeline.ts`.
4. Centralize exercise field metadata used by `ExerciseInput`, `exercise-row/fieldMeta`, and `workout/ExerciseRow`.
5. Move duplicated API constants such as `IMAGE_REPARSE_TIMEOUT_MS` into `client/src/lib/api/constants.ts`.
6. Decide the canonical workout route composition path and remove file-vs-directory ambiguity.
7. Either wire or remove unused `server/bootstrap/*` helpers after comparing them to current `server/index.ts`.

### Medium-Sized Refactors

1. Expand `protectedRouteBuilder` and migrate one route module at a time.
2. Create owner-aware exercise-set use cases and route adapters for workout logs and plan days.
3. Extract a client owner-aware exercise-set hook from `useWorkoutDetail` and `usePlanDayExercises`.
4. Extract Timeline surface orchestration and dialog/sheet mounting from `Timeline.tsx`.
5. Extract ExerciseTable row, dnd, and planned-diff helpers.
6. Move workout combine behavior and plan-day set mutations out of routes into use cases.
7. Split external integration pure mappers/provider clients from route registration.

### Larger Architectural Improvements

1. Replace process-local rate limiting with a shared store before horizontal scaling.
2. Move cron and startup maintenance to singleton infrastructure or advisory locks.
3. Add explicit timeline pagination and analytics truncation metadata.
4. Decompose `server/services/workoutService.ts` into workflow-specific services behind stable use cases.
5. Decompose `server/services/coachService.ts` into a testable pipeline.
6. Split shared schema implementation files by domain while preserving the public export surface.

## PR-by-PR Refactoring Plan

### PR 1: Restore green validation baseline

- Goal: Fix or stabilize the current failing OnboardingWizard tests without changing architecture.
- Files likely affected: `client/src/components/OnboardingWizard.test.tsx`, possibly `client/src/components/OnboardingWizard.tsx` only if the tests reveal a real bug.
- Steps: Reproduce the two failures; determine whether the flow or test selectors are stale; repair the smallest surface; keep behavior unchanged unless a bug is confirmed.
- Tests to add/update: Existing OnboardingWizard tests only.
- Validation command: `pnpm exec tsc --noEmit --incremental false`; `pnpm exec eslint .`; `pnpm test -- --reporter=dot`.
- Risk: Low/Medium.
- Rollback considerations: Revert the test-only change or the minimal component fix.
- Dependencies on earlier PRs: None.

### PR 2: Refresh docs/tooling references

- Goal: Remove stale toolchain and route-organization references.
- Files likely affected: `README.md`, `docs/client.md`, `docs/server.md`, `docs/testing.md`, `docs/api-reference.md`.
- Steps: Update Vite/TypeScript/test-count references; describe workout route capability modules; avoid production code changes.
- Tests to add/update: None unless docs lint exists.
- Validation command: `pnpm exec tsc --noEmit --incremental false`; optional docs formatting check.
- Risk: Low.
- Rollback considerations: Revert documentation files only.
- Dependencies on earlier PRs: None.

### PR 3: Centralize exercise field metadata

- Goal: Remove duplicated field metadata and field-resolution cache logic.
- Files likely affected: `client/src/components/exercise-row/fieldMeta.ts`, `client/src/components/ExerciseInput.tsx`, `client/src/components/workout/ExerciseRow.tsx`, related tests.
- Steps: Move all label/step/default-field logic into one module; replace local `getFields`/`fieldsCache`; preserve public component props.
- Tests to add/update: Unit tests for field resolution; existing component tests for ExerciseInput/ExerciseRow.
- Validation command: `pnpm exec vitest run client/src/components client/src/lib --reporter=dot`; `pnpm exec tsc --noEmit --incremental false`.
- Risk: Low.
- Rollback considerations: Revert the metadata module and component imports.
- Dependencies on earlier PRs: PR 1 recommended.

### PR 4: Canonicalize workout route composition

- Goal: Remove ambiguity between `server/routes/workouts.ts` and `server/routes/workouts/index.ts`.
- Files likely affected: `server/routes.ts`, `server/routes/workouts.ts`, `server/routes/workouts/index.ts`, `server/routes/__tests__/workouts.partition.test.ts`, route docs.
- Steps: Choose one composition entry; update imports/tests; delete the compatibility wrapper or make it the canonical entry; keep route behavior byte-for-byte equivalent.
- Tests to add/update: Existing workout route partition and contract tests.
- Validation command: `pnpm exec vitest run server/routes/__tests__/workouts.partition.test.ts server/routes/__tests__/workouts.test.ts --reporter=dot`.
- Risk: Low.
- Rollback considerations: Restore previous import wrapper.
- Dependencies on earlier PRs: None.

### PR 5: Finish route-builder coverage

- Goal: Make `protectedRouteBuilder` capable of representing current mutation-route policies.
- Files likely affected: `server/routes/_helpers/protectedRouteBuilder.ts`, `server/routes/__tests__/protectedRouteBuilder.test.ts`, route helper types.
- Steps: Add options for params/body validation, limiter, AI consent, AI budget, and ordered custom middleware; test order and error behavior.
- Tests to add/update: Builder unit tests and a representative route contract test.
- Validation command: `pnpm exec vitest run server/routes/__tests__/protectedRouteBuilder.test.ts --reporter=dot`; `pnpm exec tsc --noEmit --incremental false`.
- Risk: Medium.
- Rollback considerations: Revert helper changes before route migrations.
- Dependencies on earlier PRs: PR 1 recommended.

### PR 6: Migrate one route module to the expanded route builder

- Goal: Prove the builder migration pattern on a contained module.
- Files likely affected: Start with `server/routes/timelineAnnotations.ts` or `server/routes/preferences.ts`; related route tests.
- Steps: Convert handlers to builder helpers; keep validation schemas and response shapes unchanged; compare test behavior.
- Tests to add/update: Existing route tests plus one middleware-order regression if needed.
- Validation command: `pnpm exec vitest run server/routes/__tests__/timelineAnnotations.test.ts server/routes/__tests__/preferences.test.ts --reporter=dot`.
- Risk: Low/Medium.
- Rollback considerations: Revert the route module to direct Express calls.
- Dependencies on earlier PRs: PR 5.

### PR 7: Introduce owner-aware exercise-set server use case

- Goal: Consolidate workout-log and plan-day exercise-set mutation semantics.
- Files likely affected: `server/usecases/workouts/mutateWorkoutSet.usecase.ts`, new owner-aware use case file, `server/storage/workouts.ts`, `server/routes/workouts/workoutsCrud.routes.ts`, `server/routes/plans.ts`, tests.
- Steps: Define owner type; adapt storage calls; migrate route handlers; preserve endpoint URLs and responses.
- Tests to add/update: Owner-parity use-case tests; storage tests for IDOR/ownership; route tests for workout and plan-day set mutations.
- Validation command: `pnpm exec vitest run server/usecases server/storage/__tests__/workouts.test.ts server/routes/__tests__/plans.test.ts server/routes/__tests__/workouts.test.ts --reporter=dot`.
- Risk: Medium.
- Rollback considerations: Keep old route handlers available until parity tests pass; revert adapter wiring if needed.
- Dependencies on earlier PRs: PR 1; PR 5 recommended.

### PR 8: Introduce owner-aware client exercise-set hook

- Goal: Consolidate `useWorkoutDetail` and `usePlanDayExercises` mutation mechanics.
- Files likely affected: `client/src/hooks/useWorkoutDetail.ts`, `client/src/hooks/usePlanDayExercises.ts`, new hook module, `client/src/lib/api/workouts.ts`, `client/src/lib/api/plans.ts`, hook/component tests.
- Steps: Extract shared query/mutation/cache/debounce mechanics; adapt both existing hooks to the shared hook; preserve exported APIs initially.
- Tests to add/update: Hook tests for workout-log owner and plan-day owner; regression tests for autosave flush and delete behavior.
- Validation command: `pnpm exec vitest run client/src/hooks client/src/components/workout-detail --reporter=dot`; `pnpm exec tsc --noEmit --incremental false`.
- Risk: Medium/High.
- Rollback considerations: Keep wrappers thin so the shared hook can be reverted without endpoint changes.
- Dependencies on earlier PRs: PR 7.

### PR 9: Extract ExerciseTable internals

- Goal: Reduce `ExerciseTable.tsx` size and isolate dnd/render/metric behavior.
- Files likely affected: `client/src/components/workout-detail/ExerciseTable.tsx`, new `ExerciseTableRow.tsx`, `useExerciseTableDnd.ts`, `plannedDiff.ts`, tests.
- Steps: Extract pure helpers first; extract row component; extract dnd hook; preserve DOM/test IDs.
- Tests to add/update: Existing ExerciseTable tests; planned diff helper unit tests; drag/drop behavior tests if currently covered manually.
- Validation command: `pnpm exec vitest run client/src/components/workout-detail --reporter=dot`.
- Risk: Medium.
- Rollback considerations: Revert extracted modules and restore original component.
- Dependencies on earlier PRs: PR 1; PR 3 recommended.

### PR 10: Extract Timeline surface orchestration

- Goal: Reduce `Timeline.tsx` complexity without changing user flows.
- Files likely affected: `client/src/pages/Timeline.tsx`, new timeline hooks/components under `client/src/components/timeline/` or `client/src/pages/timeline/`, existing timeline tests.
- Steps: Extract click-routing helper; extract dialog/sheet mount component; extract coach panel mount; preserve existing hooks and query keys.
- Tests to add/update: Timeline click loop, missed routing, planned/today/completed/skipped surface tests.
- Validation command: `pnpm exec vitest run client/src/pages/__tests__/Timeline.*.test.tsx --reporter=dot`.
- Risk: Medium.
- Rollback considerations: Revert one extracted surface at a time.
- Dependencies on earlier PRs: PR 1.

### PR 11: Wire or remove server bootstrap modules

- Goal: Eliminate duplicate unused bootstrap abstractions and reduce `server/index.ts` safely.
- Files likely affected: `server/index.ts`, `server/bootstrap/appConfig.ts`, `server/bootstrap/health.ts`, `server/bootstrap/lifecycle.ts`, `server/bootstrap/observability.ts`, server smoke tests.
- Steps: Compare helper behavior with current `server/index.ts`; update helpers; move one concern per commit; delete unused helpers if not used.
- Tests to add/update: Startup smoke tests for health endpoint, CSP/static setup, error handler, and lifecycle hooks where practical.
- Validation command: `pnpm exec tsc --noEmit --incremental false`; `pnpm exec vitest run server --reporter=dot`.
- Risk: Medium.
- Rollback considerations: Restore previous `server/index.ts` composition.
- Dependencies on earlier PRs: PR 1.

### PR 12: Add shared-store readiness for rate limits and schedulers

- Goal: Prepare for horizontal scaling without changing feature behavior.
- Files likely affected: `server/routeUtils.ts`, `server/cron.ts`, `server/index.ts`, new infra adapter modules, docs/env reference.
- Steps: Add abstraction interfaces; keep MemoryStore as local default; add shared-store implementation behind config; add cron lock or external scheduler option; document deployment mode.
- Tests to add/update: Rate-limit store tests; scheduler lock tests; route smoke tests.
- Validation command: `pnpm exec vitest run server/routeUtils.test.ts server/cron*.test.ts --reporter=dot`; `pnpm exec tsc --noEmit --incremental false`.
- Risk: Medium/High.
- Rollback considerations: Config flag falls back to existing memory/process-local behavior.
- Dependencies on earlier PRs: PR 11 recommended.

### PR 13: Add timeline pagination contract

- Goal: Make timeline limits explicit and usable from the client.
- Files likely affected: `server/routes/workouts/workoutsTimeline.routes.ts`, `server/storage/timeline.ts`, `client/src/lib/api/analytics.ts`, `client/src/hooks/useTimelineData.ts`, Timeline UI tests.
- Steps: Return pagination metadata; expose limit/offset or cursor in client API; add UI fetch-more/window behavior; preserve default first page.
- Tests to add/update: Server route pagination tests; client hook tests; Timeline UI test for older entries.
- Validation command: `pnpm exec vitest run server/routes/__tests__/workouts.test.ts client/src/hooks client/src/pages/__tests__/Timeline.*.test.tsx --reporter=dot`.
- Risk: Medium.
- Rollback considerations: Keep default `timeline.get(planId)` signature as a compatibility wrapper.
- Dependencies on earlier PRs: PR 10 recommended.

### PR 14: Split integration clients from routes

- Goal: Make Strava and Garmin provider behavior easier to test and evolve.
- Files likely affected: `server/strava.ts`, `server/garmin.ts`, new `server/integrations/strava/*`, new `server/integrations/garmin/*`, tests.
- Steps: Extract pure mappers; extract provider clients; extract sync services; keep `registerStravaRoutes` and `registerGarminRoutes` as compatibility exports until final cleanup.
- Tests to add/update: Existing `server/strava.test.ts`, `server/garmin.test.ts`; new mapper/client unit tests.
- Validation command: `pnpm exec vitest run server/strava.test.ts server/garmin.test.ts --reporter=dot`.
- Risk: Medium.
- Rollback considerations: Compatibility exports allow route registration to point back to old modules.
- Dependencies on earlier PRs: PR 1.

### PR 15: Decompose Coach service pipeline

- Goal: Make AI coach orchestration more testable and easier to reason about.
- Files likely affected: `server/services/coachService.ts`, `server/services/ai/*`, `server/prompts/*`, `server/gemini/suggestionService.ts`, coach service tests.
- Steps: Extract preparation/context, RAG/style, suggestion planning, apply transaction, and review-note helpers; preserve public `triggerAutoCoach` API.
- Tests to add/update: Unit tests around each extracted pipeline step and existing coach service tests.
- Validation command: `pnpm exec vitest run server/services/coachService.test.ts server/services/aiService.test.ts server/gemini/suggestionService.test.ts --reporter=dot`.
- Risk: Medium/High.
- Rollback considerations: Keep old orchestration function behavior covered and revert extraction modules if parity breaks.
- Dependencies on earlier PRs: PR 7 recommended for exercise-set semantics.

## Commands Run

- Pass - `Select-String -Path C:\Users\russe\.codex\memories\MEMORY.md -Pattern "Hyrox-Companion|critical client refactor|AI coach|toast|Dependabot|architecture" -Context 2`
- Pass - `git status --short --branch`
- Pass - `Get-ChildItem -Force`
- Fail - `rg --files` failed with `Access is denied`
- Pass - `git ls-files`
- Pass - `Get-Content package.json`
- Pass - `Get-Content tsconfig.json`
- Pass - `Get-Content vite.config.ts`
- Pass - `Get-Content vitest.config.ts`
- Pass - `Get-Content drizzle.config.ts`
- Pass - `Get-Content eslint.config.js`
- Pass - `Get-Content README.md -TotalCount 220`
- Pass - `git ls-files | Where-Object { $_ -match '\.(ts|tsx)$' } | ForEach-Object { $p=$_; $count=(Get-Content -LiteralPath $p | Measure-Object -Line).Lines; [pscustomobject]@{Lines=$count; Path=$p} } | Sort-Object Lines -Descending | Select-Object -First 40 | Format-Table -AutoSize`
- Partial/fail - `git ls-files | ForEach-Object { [io.path]::GetExtension($_).ToLowerInvariant() } | Where-Object { $_ } | Group-Object | Sort-Object Count -Descending | Select-Object Count,Name | Format-Table -AutoSize` emitted `Illegal characters in path` but still produced partial extension counts
- Pass - `Get-ChildItem -Directory client/src,server,shared | Select-Object FullName,Name | Format-Table -AutoSize`
- Pass - `Get-Content server/index.ts`
- Pass - `Get-Content server/routes.ts`
- Pass - `Get-Content client/src/App.tsx`
- Pass - `Get-Content docs\architecture.md`
- Pass - `Get-Content docs\server.md`
- Pass - `Get-Content docs\client.md`
- Pass - `Get-Content docs\testing.md`
- Pass - `Get-Content docs\database.md`
- Pass - `Get-Content docs\ai-and-rag.md`
- Pass - `Get-Content server\bootstrap\appConfig.ts`
- Pass - `Get-Content server\bootstrap\health.ts`
- Pass - `Get-Content server\bootstrap\lifecycle.ts`
- Pass - `Get-Content server\bootstrap\observability.ts`
- Pass - `Get-Content server\routeUtils.ts`
- Pass - `Get-Content server\routes\_helpers\protectedRouteBuilder.ts`
- Pass - `git grep -n "bootstrap" -- .`
- Pass - `git grep -n "applyAppConfig\|initObservability\|registerLifecycleHooks\|HEALTH_PROBE_TIMEOUT_MS" -- server`
- Pass - `git grep -n "protectedPost\|protectedPatch\|protectedDelete" -- server\routes server\routes\_helpers`
- Pass - `git grep -n "protectedMutationGuards" -- server`
- Pass - `Get-Content server\routes\plans.ts`
- Pass - `Get-Content server\routes\ai.ts`
- Pass - `Get-Content server\routes\workouts\workoutsCrud.routes.ts`
- Pass - `Get-Content server\routes\workouts\workoutsAi.routes.ts`
- Pass - `Get-Content server\garmin.ts -TotalCount 260`
- Pass - `Get-Content server\strava.ts -TotalCount 260`
- Pass - `Get-Content server\garmin.ts -Tail 260`
- Pass - `Get-Content server\strava.ts -Tail 240`
- Pass - `Get-Content server\storage\index.ts`
- Pass - `Get-Content server\storage\IStorage.ts`
- Pass - `Get-Content server\storage\shared.ts`
- Pass - `Get-Content server\services\workoutUseCases.ts`
- Pass - `Get-Content server\storage\workouts.ts`
- Pass - `Get-Content server\storage\timeline.ts`
- Pass - `Get-Content server\storage\plans.ts`
- Pass - `Get-Content server\services\workoutService.ts`
- Pass - `Get-Content server\services\coachService.ts`
- Pass - `Get-Content server\services\analyticsService.ts`
- Pass - `Get-Content client\src\lib\api\client.ts`
- Pass - `Get-Content client\src\lib\api\workouts.ts`
- Pass - `Get-Content client\src\lib\api\plans.ts`
- Pass - `Get-Content client\src\lib\api\analytics.ts`
- Pass - `Get-Content client\src\hooks\useWorkoutEditor.ts`
- Pass - `Get-Content client\src\components\workout-detail\ExerciseTable.tsx -TotalCount 260`
- Pass - `Get-Content client\src\components\workout-detail\ExerciseTable.tsx -Tail 360`
- Pass - `Get-Content client\src\pages\Timeline.tsx -TotalCount 260`
- Pass - `Get-Content client\src\pages\Timeline.tsx -Tail 300`
- Pass - `Get-Content client\src\hooks\useTimelineState.ts`
- Pass - `Get-Content client\src\hooks\useTimelineData.ts`
- Pass - `Get-Content client\src\hooks\useWorkoutDetail.ts`
- Pass - `Get-Content client\src\hooks\usePlanDayExercises.ts`
- Pass - `Get-Content client\src\hooks\useApiMutation.ts`
- Pass - `Get-Content client\src\hooks\useWorkoutActions.ts`
- Pass - `Get-Content client\src\hooks\workout-actions\useWorkoutActionMutations.ts`
- Pass - `Get-Content client\src\lib\queryClient.ts`
- Pass - `Get-Content client\src\lib\api\index.ts`
- Pass - `Get-Content shared\schema\tables.ts -TotalCount 280`
- Pass - `Get-Content shared\schema\tables.ts -Tail 320`
- Pass - `Get-Content shared\schema\types.ts -TotalCount 280`
- Pass - `Get-Content shared\schema\types.ts -Tail 300`
- Pass - `Get-Content shared\schema\exercises.ts`
- Pass - `Get-Content shared\openapi.ts -TotalCount 260`
- Pass - `Get-Content server\routes\analytics.ts`
- Pass - `Get-Content server\storage\analytics.ts`
- Pass - `Get-Content server\storage\timelineWindow.ts`
- Pass - `Get-Content server\queue.ts`
- Pass - `Get-Content server\cron.ts`
- Pass - `Get-Content server\services\ragService.ts -TotalCount 320`
- Pass - `Get-Content server\env.ts`
- Pass - `Get-Content server\db.ts`
- Pass - `Get-Content server\vectorDb.ts`
- Pass - `Get-Content server\maintenance.ts -TotalCount 260`
- Pass - `Get-Content .github\workflows\build.yml`
- Pass - `Get-Content .github\workflows\test.yml`
- Pass - `Get-Content server\routes\workouts\workoutsTimeline.routes.ts`
- Pass - `Get-Content server\routes\workouts\index.ts`
- Pass - `Get-Content client\src\lib\api\timelineAnnotations.ts`
- Pass - `Get-Content server\routes\timelineAnnotations.ts`
- Pass - `Get-Content server\storage\timelineAnnotations.ts`
- Pass - `Get-Content server\routes\workouts\shared.ts`
- Pass - `Get-Content server\constants.ts`
- Pass - `Get-Content client\src\hooks\useTimelineFilters.ts`
- Pass - `Get-Content client\src\components\timeline\TimelineDateGroup.tsx`
- Pass - `Get-Content client\src\components\timeline\timeline-workout-card\TimelineWorkoutCard.tsx -TotalCount 260`
- Pass - `Get-Content client\src\components\timeline\timeline-workout-card\utils.tsx`
- Pass - `node --version`
- Pass - `pnpm --version`
- Pass - `pnpm exec tsc --version`
- Pass - `pnpm list --depth 0`
- Pass - `Get-Content docs\codebase-architecture-review.md -TotalCount 120`
- Pass - `git grep -n "IMAGE_REPARSE_TIMEOUT_MS" -- client server shared`
- Pass - `git grep -n "DEFAULT_TIMELINE_LIMIT\|MAX_TIMELINE_LIMIT\|MAX_WORKOUT_LOGS_PER_QUERY" -- client server shared`
- Pass - `git grep -n "MemoryStore" -- server`
- Pass - `git grep -n "startCron\|stopCron\|cron.schedule" -- server`
- Pass - `git grep -n "new Map" -- server client/src`
- Pass - `git grep -n "db.transaction" -- server/routes server/services server/storage`
- Pass - `git grep -n "safeParse" -- server/routes server/garmin.ts server/strava.ts`
- Pass - `git grep -n "protectedMutationGuards" -- server/routes server/garmin.ts server/strava.ts`
- Pass - `git grep -n "addExerciseSetToWorkoutLog\|addExerciseSetToPlanDay\|updateExerciseSet\|deleteExerciseSet" -- server client shared`
- Pass - `git grep -n "applyAppConfig\|initObservability\|registerLifecycleHooks\|healthProbeRouter" -- server`
- Pass - `git grep -n "usePlanDayExercises\|useWorkoutDetail" -- client/src`
- Pass - `git grep -n "timeline.get\|getTimeline" -- client/src server`
- Pass - `pnpm exec tsc --noEmit --incremental false`
- Pass with warning - `pnpm exec eslint .` exited 0 with one import-sort warning in `server/storage/timeline.ts`
- Fail - `pnpm test -- --reporter=dot` failed in sandbox before loading config with `Error: spawn EPERM`
- Fail after escalation - `pnpm test -- --reporter=dot` ran the suite outside the sandbox but failed 2 tests in `client/src/components/OnboardingWizard.test.tsx`; 119 test files passed, 1 failed, 1 skipped; 1017 tests passed, 2 failed, 6 skipped
- Pass - `Get-Content client\src\main.tsx`
- Pass - `Get-Content server\routes.ts`
- Pass - `Get-Content server\routes\workouts\index.ts`
- Pass - `Get-Content server\middleware\aibudget.ts`
- Pass - `Get-Content client\src\lib\authUtils.ts`
- Pass - `Get-Content server\routes\workouts.ts -TotalCount 260`
- Pass - `Get-Content server\routes\workouts.ts -Tail 260`
- Pass - `git ls-files server/routes/workouts*`
- Pass - `git grep -n "workoutsCrud\|workoutsAi\|registerWorkout" -- server/routes/workouts.ts server/routes/workouts`
- Pass - `git grep -n "routes/workouts" -- .`
- Fail - `git grep -n "from \"\.\/routes\/workouts\"\|from './routes/workouts'\|from \"\.\/workouts\"\|from '../workouts'" -- server client shared` failed due quoting/path parsing
- Pass - `git grep -n "from .*routes/workouts" -- server client shared`
- Pass - `git grep -n "\.\./workouts" -- server client shared`
- Pass - `Select-String -Path README.md,docs\*.md -Pattern "Vite 5|TypeScript 5|Vite|TypeScript"`
- Pass - `Select-String -Path package.json -Pattern "typescript|vite"`
- Pass - `git grep -n "message.*workout\|workout.*message\|api.workouts.create\|createWorkout" -- shared/openapi.ts client/src/lib/api server/routes/workouts server/services`
- Pass - `Get-Content client\src\components\ExerciseInput.tsx -TotalCount 140`
- Pass - `Get-Content client\src\components\exercise-row\fieldMeta.ts`
- Pass - `Get-Content client\src\components\workout\ExerciseRow.tsx -TotalCount 120`
- No matches - `git grep -n "TODO\|FIXME" -- client server shared docs | Select-Object -First 80` exited 1 because no matches were found

*Note: During the latest review pass on May 3, 2026, no new terminal commands were executed due to cloud environment restrictions.*

## Limitations

- `rg --files` could not run in this environment because `rg.exe` returned `Access is denied`; I used `git ls-files`, `git grep`, `Get-Content`, and `Select-String` instead.
- One extension-count command partially failed on a path containing characters PowerShell treated as illegal; this did not block inspection because `git ls-files` and targeted file reads still worked.
- I did not run `pnpm run build` because the build writes production artifacts and this task allowed only the architecture review document to be created or updated.
- I did not run Cypress because there were no production UI changes to validate and Cypress/browser runs are heavier than needed for this analysis-only report.
- I did not run database-backed integration tests separately because they require environment setup beyond static/code inspection and the normal Vitest run already exposed current test failures.
- The full Vitest suite could not run inside the sandbox due `spawn EPERM`; when rerun outside the sandbox, it completed but failed the two OnboardingWizard tests listed above.
- This review is based on local source inspection and configured read-only analysis commands. I did not inspect production telemetry, database query plans, real data volumes, or deployment topology, so scaling findings that depend on multi-instance deployment are called out as risks rather than current production incidents.
- **May 3, 2026 Update**: The latest pass was limited to static file inspection (leveraging `docs/testing.md` and module configurations). Shell execution and live command running were unavailable in the current cloud sandbox turn.
