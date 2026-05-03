# Codebase Architecture Review

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

### 1. Incomplete Use-Case Extraction
- **Priority**: P1
- **Category**: Modularity and Boundaries
- **Files involved**: `server/routes/workouts/workoutsAi.routes.ts`, `server/routes/plans.ts`
- **Problem**: Business logic (parsing targets, updating reference text, error shaping) is implemented inline within route handlers.
- **Evidence**: `protectedPost("/api/v1/workouts/:id/reparse", ...)` in `workoutsAi.routes.ts` handles complex state transitions and DB updates directly.
- **Why it matters**: Weakens separation of concerns, makes transactional logic harder to test in isolation, and leads to duplication when similar logic is needed elsewhere (e.g., plan day re-parsing).
- **Recommendation**: Move orchestration into `workoutUseCases.ts` and `planService.ts`.
- **Impact**: High
- **Effort**: Medium
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
- **`server/routes/plans.ts`**: Move CSV parsing and sample plan creation to dedicated service files.
- **`client/src/lib/api/workouts.ts`**: Consolidate repetitive `typedRequest` wrappers into a more generic resource-based builder.
- **`server/middleware/idempotency.ts`**: Ensure the 24h TTL is consistent with client-side retry windows (currently 7d mentioned in comments but code prunes at 24h).

## Scalability Concerns
- **Rate Limiting**: Currently uses `MemoryStore`. While fine for single-instance, it won't scale to multiple server instances. Recommend swapping to Redis-backed store.
- **N+1 Queries**: Generally well-managed, but `attachExerciseSets` in `TimelineStorage` still performs two separate batch fetches. Could be optimized with a single join if the timeline was unified.

## Modularity and Boundary Issues
- **External Integrations**: Strava and Garmin logic are well-isolated in their respective mappers, but error handling for these integrations is slightly inconsistent compared to the main API.

## Testing Recommendations
- **Integration Tests**: Add more comprehensive integration tests for `workoutUseCases.ts` specifically targeting the interaction between DB transactions and Gemini service failures.
- **Contract Testing**: Implement contract tests for the shared Zod schemas to ensure frontend and backend are always in sync without relying solely on the `openapi.json` check.

## Suggested Migration Roadmap
1. **Quick Wins (Week 1)**: Normalize `custom-exercises` validation, await email job enqueues, and fix the Strava skipped-counter reported in `CODEBASE_AUDIT.md`.
2. **Medium Refactors (Week 2-3)**: Complete the extraction of workout AI orchestration to `workoutUseCases.ts`. Refactor `plans.ts` to thin out route handlers.
3. **Architectural Improvements (Week 4+)**: Implement persistent rate limiting and migrate the timeline to a SQL-based unified query.

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
4. **PR 4: Performance: Persistent Rate Limiting**
   - Goal: Transition `routeUtils.ts` to support Redis/External store for rate limiting.
   - Files: `server/routeUtils.ts`, `server/env.ts`.

## Commands Run
- `ls -F`: Passed.
- `cat package.json README.md`: Passed.
- `ls -R shared/schema server/routes server/services client/src/pages client/src/components`: Passed.
- `cat shared/schema/index.ts shared/schema/types.ts server/storage/IStorage.ts`: Passed.
- `cat server/storage/workouts.ts`: Passed.
- `pnpm check`: Failed (missing node_modules).
- `pnpm test:smoke`: Failed (missing node_modules).
- `grep` / `ls` / `cat` for various code patterns: All passed.

## Limitations
- **Dynamic Analysis**: Could not run type-checking or tests due to the absence of `node_modules` in the sandbox environment.
- **Clerk/Gemini**: Could not verify runtime behavior of external integrations without active API keys/tokens.
