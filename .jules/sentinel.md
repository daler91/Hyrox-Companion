## 2026-04-02 - Redact sensitive headers from Pino HTTP logs
**Vulnerability:** pino-http automatically logged all incoming request headers, which included sensitive `authorization` (Bearer tokens) and `cookie` (session IDs) headers in plaintext, exposing them to log viewers or monitoring systems.
**Learning:** Default HTTP logging middleware often captures all headers. You must explicitly configure log redaction for authentication tokens and session identifiers.
**Prevention:** Always configure `pino` (or equivalent logger) with a `redact` array for known sensitive paths (e.g., `["req.headers.authorization", "req.headers.cookie"]`) when setting up HTTP request logging.
## 2024-05-24 - [Express 'trust proxy' ordering vulnerability]
**Vulnerability:** Express 'trust proxy' configuration was being executed conditionally and too late in the middleware chain inside `server/clerkAuth.ts`, potentially allowing IP spoofing for rate limiters, logging, and CSRF protection that executes before the app setup finishes or before the configuration actually executes.
**Learning:** `app.set('trust proxy', ...)` must be configured synchronously right after `app = express()` so that any middleware attached afterward consistently accesses the correct real client IP and not an attacker-spoofed `X-Forwarded-For` header.
**Prevention:** Always place global application configurations like `trust proxy` at the very top of `server/index.ts` (or equivalent entry file) instead of burying them inside auth or routing helper functions.
