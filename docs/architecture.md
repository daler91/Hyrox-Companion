[Back to README](../README.md)

# Architecture Guide

This document describes the high-level architecture of the Hyrox Companion (fitai.coach) project -- a full-stack TypeScript monorepo combining a React frontend, an Express API server, PostgreSQL with pgvector, Google Gemini AI, Clerk authentication, and Strava integration.

---

## 1. Overview

The repository is organized into three top-level source directories that share a common TypeScript toolchain:

```
Hyrox-Companion/
  client/          React SPA (Vite, wouter, TanStack Query, Clerk React SDK)
  server/          Express API (Clerk Express SDK, Drizzle ORM, pg-boss, Gemini)
  shared/          Code shared between client and server (schema, OpenAPI, types)
```

```mermaid
graph TD
    subgraph Monorepo
        CLIENT["client/\nReact + Vite SPA"]
        SERVER["server/\nExpress API"]
        SHARED["shared/\nDrizzle schema, Zod types,\nOpenAPI registry"]
    end

    CLIENT -- "imports types & schemas" --> SHARED
    SERVER -- "imports types & schemas" --> SHARED
    CLIENT -- "HTTP fetch with credentials" --> SERVER

    SERVER -- "Drizzle ORM" --> PG["PostgreSQL"]
    SERVER -- "pgvector queries" --> PGVEC["PostgreSQL + pgvector"]
    SERVER -- "Gemini API" --> GEMINI["Google Gemini"]
    SERVER -- "JWT verification" --> CLERK["Clerk"]
    SERVER -- "OAuth + webhooks" --> STRAVA["Strava API"]
    SERVER -- "pg-boss" --> PGBOSS["pg-boss queue\n(PostgreSQL-backed)"]
```

**Key conventions:**
- All API routes live under `/api/v1/`.
- The client is served by Vite dev server in development and as static files in production (same origin as the API).
- `shared/` is imported directly by both `client/` and `server/` via TypeScript path aliases -- there is no separate build step.

---

## 2. Request Lifecycle

Every authenticated request follows this path from the browser to the database and back.

```mermaid
sequenceDiagram
    participant User
    participant React as React Component
    participant TQ as TanStack Query
    participant Fetch as fetch (credentials: include)
    participant Compress as compression()
    participant CORS as cors()
    participant Helmet as helmet() + CSP
    participant Auth as Clerk Auth Middleware
    participant Body as express.json()
    participant Log as pino-http Logger
    participant Route as Route Handler
    participant Service as Service Layer
    participant Storage as Storage Layer (Drizzle)
    participant DB as PostgreSQL

    User->>React: Interaction (click, submit)
    React->>TQ: useQuery / useMutation
    TQ->>Fetch: GET/POST /api/v1/...
    Fetch->>Compress: HTTP request
    Compress->>CORS: decompress / pass through
    CORS->>Helmet: validate origin
    Helmet->>Auth: set security headers & CSP nonce
    Auth->>Body: verify Clerk JWT, attach userId
    Body->>Log: parse JSON body (100kb limit)
    Log->>Route: attach requestId, userId, log request
    Route->>Service: call business logic
    Service->>Storage: query / mutate via Drizzle
    Storage->>DB: SQL over connection pool
    DB-->>Storage: rows
    Storage-->>Service: typed result
    Service-->>Route: domain object
    Route-->>Log: JSON response
    Log-->>Fetch: HTTP response
    Fetch-->>TQ: parsed JSON
    TQ-->>React: cache update, re-render
    React-->>User: updated UI
```

**Middleware stack order** (as registered in `server/index.ts`):

1. `compression()` -- gzip/brotli response compression
2. `cors()` -- origin allowlist with `credentials: true`
3. `helmet()` -- security headers (HSTS, X-Frame-Options, etc.)
4. CSP nonce middleware -- per-request nonce for `<script>` tags (production only)
5. Custom CSP override -- fine-grained Content-Security-Policy with Clerk and Strava domains
6. Permissions-Policy header
7. `express.json()` -- body parsing with 100kb default limit (2mb for `/api/v1/coaching-materials`)
8. `express.urlencoded()` -- form body parsing (100kb limit)
9. `pino-http` -- structured request logging with Clerk userId extraction
10. `doubleCsrfProtection` -- CSRF verification on mutating requests (double-submit cookie via `csrf-csrf`)
11. `idempotencyMiddleware` -- server-side idempotency enforcement via `X-Idempotency-Key` header (after auth)
12. Route handlers (registered via `registerRoutes`)

---

## 3. Auto-Coach Pipeline

When a user completes a workout, the auto-coach pipeline adjusts upcoming plan days using AI. The pipeline is queue-driven via pg-boss to avoid blocking the request.

```mermaid
sequenceDiagram
    participant Client as React Client
    participant API as POST /api/v1/workouts
    participant Queue as pg-boss Queue
    participant Coach as triggerAutoCoach
    participant Parallel as Parallel Fetch
    participant AI as buildTrainingContext
    participant Plan as storage.getActivePlan
    participant TL as storage.getTimeline
    participant RAG as retrieveCoachingText
    participant Gemini as generateWorkoutSuggestions (Gemini)
    participant Storage as Storage Layer
    participant Poll as useAuth (polling)

    Client->>API: POST /api/v1/workouts (complete workout)
    API->>Storage: set isAutoCoaching = true
    API->>Queue: enqueue auto-coach job (pg-boss)
    API-->>Client: 200 OK (workout saved)

    Queue->>Coach: dequeue and execute triggerAutoCoach(userId)

    Coach->>Parallel: Promise.all(...)
    Parallel->>AI: buildTrainingContext(userId)
    Parallel->>Plan: getActivePlan(userId)
    Parallel->>TL: getTimeline(userId)
    AI-->>Parallel: TrainingContext
    Plan-->>Parallel: active plan record
    TL-->>Parallel: full timeline

    Coach->>Coach: extract upcoming 7 planned days from timeline

    Coach->>RAG: retrieveCoachingText(userId, query)
    RAG-->>Coach: coaching text + source (rag | legacy | null)

    Coach->>Gemini: generateWorkoutSuggestions(context, upcoming, goal, coachingText)
    Gemini-->>Coach: WorkoutSuggestion[]

    loop For each suggestion
        Coach->>Storage: updatePlanDay(workoutId, field, aiSource)
    end

    Coach->>Storage: set isAutoCoaching = false

    Note over Client,Poll: Client polls via useAuth every 2s
    Poll->>Client: detects isAutoCoaching changed to false
    Client->>Client: invalidates timeline query
    Client->>Client: re-renders with AI-adjusted plan days
```

**Key details:**
- `isAutoCoaching` is a boolean flag on the `users` table that the client polls to detect when coaching is complete.
- The pipeline uses a `try/finally` block to guarantee `isAutoCoaching` is reset to `false` even on failure.
- Suggestions can either `replace` or `append` content to `mainWorkout` or `accessory` fields on plan days.
- The `aiSource` field on each plan day records whether the AI used RAG chunks (`"rag"`), legacy materials (`"legacy"`), or neither (`null`).

---

## 4. RAG Retrieval Decision Tree

The RAG retrieval system (`server/services/ragRetrieval.ts`) determines whether to use vector search, legacy full-text materials, or neither when building coaching context.

```mermaid
flowchart TD
    START([retrieveCoachingContext called]) --> HAS_CHUNKS{hasChunksForUser?}

    HAS_CHUNKS -- No --> FALLBACK_LEGACY

    HAS_CHUNKS -- Yes --> DIM_CHECK{Stored embedding dimension\nmatches EMBEDDING_DIMENSIONS?}

    DIM_CHECK -- "Mismatch\n(storedDim != expected)" --> FALLBACK_LEGACY
    DIM_CHECK -- "Match or null\n(first embed)" --> VECTOR_SEARCH[retrieveRelevantChunks\nvector search top results]

    VECTOR_SEARCH --> HAS_RESULTS{chunks.length > 0?}

    HAS_RESULTS -- Yes --> RETURN_RAG([Return RAG result\nsource: rag\nchunkCount: N])

    HAS_RESULTS -- No --> FALLBACK_LEGACY

    FALLBACK_LEGACY[listCoachingMaterials\nfull-text lookup] --> HAS_MATERIALS{coachingMaterials.length > 0?}

    HAS_MATERIALS -- Yes --> RETURN_LEGACY([Return legacy result\nsource: legacy\nmaterialCount: N])

    HAS_MATERIALS -- No --> RETURN_NONE([Return empty result\nsource: none])

    style RETURN_RAG fill:#2d6a4f,color:#fff
    style RETURN_LEGACY fill:#b08968,color:#fff
    style RETURN_NONE fill:#6c757d,color:#fff
```

**Fallback reasons tracked in `ragInfo.fallbackReason`:**
- `dimension_mismatch` -- stored embeddings were generated with a different model dimension; user must re-embed via settings.
- `no_embeddings` -- chunks exist but have no embedding vectors yet.
- `no_matching_chunks` -- vector search returned zero results for the query.
- `retrieval_error` -- an exception occurred during vector search.

In production, `sanitizeRagInfo` strips `chunks` and `fallbackReason` from API responses to avoid leaking internal diagnostics.

---

## 5. Schema Pipeline

Type safety flows from the database schema all the way to the Swagger UI documentation through a chain of code generation steps.

```mermaid
flowchart LR
    DRIZZLE["Drizzle pgTable\ndefinitions\n(shared/schema/tables.ts)"] --> DRIZZLE_ZOD["createInsertSchema()\n(drizzle-zod)"]

    DRIZZLE_ZOD --> ZOD_REFINE["Zod schemas with\n.omit() / .extend()\n(shared/schema/types.ts)"]

    ZOD_REFINE --> OPENAPI_REG["OpenAPIRegistry\n.register() / .registerPath()\n(shared/openapi.ts)"]

    OPENAPI_REG --> GENERATOR["OpenApiGeneratorV3\n.generateDocument()\n(@asteasolutions/zod-to-openapi)"]

    GENERATOR --> SWAGGER["Swagger UI\n/api/docs\n(dev only)"]

    ZOD_REFINE --> TS_TYPES["TypeScript types\nz.infer&lt;typeof schema&gt;"]

    TS_TYPES --> CLIENT_USE["Client: request/response\nvalidation & type hints"]
    TS_TYPES --> SERVER_USE["Server: route handler\ninput validation"]

    style DRIZZLE fill:#1a535c,color:#fff
    style SWAGGER fill:#f4a261,color:#000
```

**Step-by-step:**

1. **Drizzle table definitions** (`shared/schema/tables.ts`) -- `pgTable()` calls define columns, types, indexes, and constraints. A custom `vector()` type maps PostgreSQL `vector(N)` to TypeScript `number[]`.
2. **drizzle-zod generation** -- `createInsertSchema()` auto-generates a Zod schema from each Drizzle table, handling column types, nullability, and defaults.
3. **Zod refinement** (`shared/schema/types.ts`) -- `.omit({ id: true })` removes server-generated fields; `.extend()` adds stricter validation (e.g., `z.number().min(1).max(14)`).
4. **OpenAPI registration** (`shared/openapi.ts`) -- Schemas are registered with `@asteasolutions/zod-to-openapi`'s `OpenAPIRegistry`, including path definitions with examples and security schemes.
5. **Document generation** -- `OpenApiGeneratorV3` produces an OpenAPI 3.0 JSON spec from the registry.
6. **Swagger UI** -- In development, `swagger-ui-express` serves interactive docs at `/api/docs` with a relaxed CSP.

---

## 6. Service Dependencies

The server is organized into route modules, service modules, and a storage layer. This diagram shows the dependency graph.

```mermaid
graph TD
    subgraph Route Modules
        R_AUTH["authRoutes"]
        R_PREFS["preferencesRoutes"]
        R_EMAIL["emailRoutes"]
        R_AI["aiRoutes"]
        R_ANALYTICS["analyticsRoutes"]
        R_WORKOUTS["workoutRoutes"]
        R_PLANS["planRoutes"]
        R_COACHING["coachingRoutes"]
        R_STRAVA["stravaRoutes"]
    end

    subgraph Services
        S_COACH["coachService\n(triggerAutoCoach)"]
        S_AI["aiService\n(buildTrainingContext)"]
        S_RAG["ragRetrieval\n(retrieveCoachingContext)"]
        S_RAG_SVC["ragService\n(retrieveRelevantChunks)"]
        S_AI_CTX["aiContextService"]
    end

    subgraph External
        GEMINI["Google Gemini API"]
        CLERK["Clerk Auth"]
        STRAVA_API["Strava API"]
    end

    STORAGE["storage\n(Drizzle ORM)"]
    PG["PostgreSQL"]
    PGVEC["PostgreSQL + pgvector"]
    QUEUE["pg-boss Queue"]

    R_WORKOUTS --> S_COACH
    R_WORKOUTS --> STORAGE
    R_AI --> S_AI_CTX
    R_AI --> GEMINI
    R_COACHING --> S_RAG
    R_COACHING --> STORAGE
    R_PLANS --> STORAGE
    R_ANALYTICS --> STORAGE
    R_PREFS --> STORAGE
    R_AUTH --> CLERK
    R_STRAVA --> STRAVA_API
    R_STRAVA --> STORAGE
    R_EMAIL --> STORAGE

    S_COACH --> S_AI
    S_COACH --> S_RAG
    S_COACH --> GEMINI
    S_COACH --> STORAGE

    S_AI_CTX --> S_AI
    S_AI_CTX --> S_RAG

    S_AI --> STORAGE
    S_RAG --> S_RAG_SVC
    S_RAG --> STORAGE
    S_RAG_SVC --> PGVEC

    STORAGE --> PG
    R_WORKOUTS --> QUEUE
    QUEUE --> S_COACH

    style GEMINI fill:#4285f4,color:#fff
    style CLERK fill:#6c47ff,color:#fff
    style STRAVA_API fill:#fc4c02,color:#fff
    style PG fill:#336791,color:#fff
    style PGVEC fill:#336791,color:#fff
```

**Notable patterns:**
- **Route handlers** are thin orchestrators -- they validate input, delegate to use-case functions (e.g., `workoutUseCases.ts`), and return responses. The use-case layer separates transport concerns from business logic orchestration.
- **coachService** is the most connected service, depending on `aiService`, `ragRetrieval`, Gemini, and the storage layer.
- **ragRetrieval** delegates vector search to `ragService`, which queries the `pgvector` extension directly via a separate connection pool (`vectorPool`).
- **pg-boss** uses the same PostgreSQL database for its job queue, keeping infrastructure simple.
- **Storage** is a single abstraction layer over Drizzle ORM; all database access goes through it (including idempotency key caching via `IdempotencyStorage`).

---

## 7. Cross-References

Detailed documentation for each subsystem:

| Document | Description |
|---|---|
| [Client Architecture](./client.md) | React components, routing (wouter), lazy loading, theme, sidebar layout |
| [Server Architecture](./server.md) | Express setup, middleware stack, route registration, error handling |
| [Database](./database.md) | Drizzle schema, migrations, tables, indexes, pgvector setup |
| [AI and RAG](./ai-and-rag.md) | Gemini integration, embedding pipeline, vector search, prompt construction |
| [State Management](./state-management.md) | TanStack Query, cache invalidation, optimistic updates, polling |
| [API Reference](./api-reference.md) | Endpoint catalog, request/response shapes, status codes |
| [Authentication](./authentication.md) | Clerk setup, JWT verification, dev auth bypass, webhook sync |
| [Integrations](./integrations.md) | Strava OAuth, activity sync, pg-boss queue, Resend email, Sentry |
| [Testing](./testing.md) | Test strategy, Cypress E2E, Vitest unit tests, CI pipeline |
