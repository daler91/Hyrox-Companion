## 2026-04-02 - Redact sensitive headers from Pino HTTP logs
**Vulnerability:** pino-http automatically logged all incoming request headers, which included sensitive `authorization` (Bearer tokens) and `cookie` (session IDs) headers in plaintext, exposing them to log viewers or monitoring systems.
**Learning:** Default HTTP logging middleware often captures all headers. You must explicitly configure log redaction for authentication tokens and session identifiers.
**Prevention:** Always configure `pino` (or equivalent logger) with a `redact` array for known sensitive paths (e.g., `["req.headers.authorization", "req.headers.cookie"]`) when setting up HTTP request logging.
