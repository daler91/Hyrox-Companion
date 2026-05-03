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

## Canonical middleware order

Startup must preserve this order (high-level):

1. Security headers / trust-proxy / low-level request hardening
2. CORS
3. CSP nonce middleware
4. Body parsers (`express.json`, targeted parser overrides, `urlencoded`)
5. `cookie-parser`
6. HTTP request logger (`pino-http`)
7. Request context enrichment (request id/user context)
8. Auth middleware mounting (Clerk)
9. CSRF token issuance + CSRF protection mount
10. API route registration
11. Static/Vite fallback mounts (environment-dependent)
12. 404 handler
13. Central error handler

## Migration constraints

- Keep `server/index.ts` as the only startup entrypoint exported for runtime boot.
- New startup concerns must be extracted as helpers and called from `server/index.ts`, not from an alternative boot file.
- Middleware reordering is a breaking change unless justified in a follow-up ADR.
- Any migration to a modular bootstrap architecture requires:
  - a superseding ADR,
  - equivalence tests for middleware ordering,
  - a phased rollout that keeps one canonical runtime entrypoint at each phase.
