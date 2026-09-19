# ADR: Canonical Server Startup Pattern

- **Status:** Accepted
- **Date:** 2026-05-03
- **Decision owners:** Backend maintainers

## Context

The server currently initializes in `server/index.ts` with route composition delegated to `server/routes.ts`. We need one canonical startup pattern so future refactors do not split initialization responsibilities unpredictably.

## Decision

Adopt **single startup module** as the canonical pattern.

- `server/index.ts` is the single orchestration entrypoint for process boot.
- Supporting modules remain focused and injectable (`routes`, `static`, auth mounting helpers, and middleware utilities).
- No second bootstrap path (e.g., parallel `bootstrap.ts` stack) is allowed.

> The `server/bootstrap/` directory (`appConfig.ts`, `health.ts`, `observability.ts`,
> `lifecycle.ts`) is **not** a second boot path. Each module exports a helper that
> `server/index.ts` calls in sequence; none of them boots the process. That is exactly
> the "extract as helpers" shape the migration constraints below require.

## Canonical middleware order

Startup must preserve this order. Reconciled against `server/index.ts` on 2026-09-19;
[Server § Middleware Stack](server.md#middleware-stack) carries the same list with the
per-entry rationale.

1. App settings — `trust proxy`, `x-powered-by` (`configureApp`, `server/bootstrap/appConfig.ts`)
2. `compression`, with `text/event-stream` exempted so SSE is not held in the gzip buffer
3. Health endpoint — registered **before CORS** so platform probes, which send no `Origin`, always reach it
4. CORS
5. CSP nonce middleware — **must** precede helmet, which reads the nonce for `script-src`
6. `helmet` (CSP, HSTS, referrer policy)
7. `Permissions-Policy`
8. Body parsers — the scoped `express.json` overrides (coaching materials, image-parse routes) ahead of the default, then `urlencoded`
9. `cookie-parser`
10. HTTP request logger (`pino-http`)
11. Request context enrichment (request id / user context)
12. Auth middleware mounting (Clerk) — inside `registerRoutes()`
13. CSRF token issuance, then the CSRF protection mount — inside `registerRoutes()`
14. API route registration — inside `registerRoutes()`
15. Swagger UI (development only)
16. Central error handler, then the Sentry Express error handler
17. Static/Vite fallback mounts (environment-dependent). Their catch-all is also the 404, which is why it mounts last — ahead of it, it would swallow every route above

Items 1–11 are wired directly in `server/index.ts`; 12–14 inside `registerRoutes()`
(`server/routes.ts`); 15–17 after it returns.

## Migration constraints

- Keep `server/index.ts` as the only startup entrypoint exported for runtime boot.
- New startup concerns must be extracted as helpers and called from `server/index.ts`, not from an alternative boot file.
- Middleware reordering is a breaking change unless justified in a follow-up ADR.
- Any migration to a modular bootstrap architecture requires:
  - a superseding ADR,
  - equivalence tests for middleware ordering,
  - a phased rollout that keeps one canonical runtime entrypoint at each phase.
