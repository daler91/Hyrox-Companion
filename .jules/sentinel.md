## 2026-05-11 - Standardize Input Validation via Middleware
**Vulnerability:** Inline `zodSchema.safeParse` in Express routes bypasses standardized schema validation structures.
**Learning:** By utilizing `validateBody(schema)` in the route middleware definitions, the project ensures all API routes return a consistent error signature on invalid input (`{ code: "VALIDATION_ERROR", message: string, details: ... }`), preventing internal validation details or edge cases from leaking unexpectedly. Using `Request<..., ..., z.infer<typeof schema>>` ensures `req.body` is appropriately typed within the handler.
**Prevention:** Always use `validateBody`, `validateQuery`, and `validateParams` middlewares from `server/routeUtils.ts` rather than inline `safeParse` for request validation.

## 2026-05-24 - Prevent SSRF in Web Push Subscription
**Vulnerability:** The web push subscription endpoint accepted any valid URL for the push `endpoint` field, including internal `http://` URLs.
**Learning:** When dealing with external callback URLs (like push notification subscriptions), failing to strictly enforce HTTPS allows an attacker to supply an internal IP or local domain (e.g., `http://169.254.169.254`). The server's web push library would then unknowingly make a POST request to this internal address, resulting in Server-Side Request Forgery (SSRF).
**Prevention:** Always validate that user-provided URLs intended for server-to-server outbound calls strictly start with `https://`.

## 2026-06-06 - Strengthen SSRF Protection on Web Push Endpoints
**Vulnerability:** The web push subscription endpoint required URLs to start with `https://`, but this check did not prevent internal/local network targeting if the URL used a private IP or loopback address (e.g., `https://127.0.0.1` or `https://192.168.1.1`).
**Learning:** Enforcing HTTPS alone is insufficient to prevent Server-Side Request Forgery (SSRF). An attacker could still attempt to interact with local HTTPS services or trigger internal network exploration. The `server/ssrfGuard.ts` provides a dedicated `checkSafeOutboundUrl` function to reliably detect and reject these loopback, private, and link-local addresses across both IPv4 and IPv6.
**Prevention:** When validating user-provided URLs intended for server-to-server requests, combine the protocol check with the `checkSafeOutboundUrl` guard in the Zod refinement: `.refine((url) => url.startsWith("https://") && checkSafeOutboundUrl(url).ok)`.
