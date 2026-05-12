## 2026-05-11 - Standardize Input Validation via Middleware
**Vulnerability:** Inline `zodSchema.safeParse` in Express routes bypasses standardized schema validation structures.
**Learning:** By utilizing `validateBody(schema)` in the route middleware definitions, the project ensures all API routes return a consistent error signature on invalid input (`{ code: "VALIDATION_ERROR", message: string, details: ... }`), preventing internal validation details or edge cases from leaking unexpectedly. Using `Request<..., ..., z.infer<typeof schema>>` ensures `req.body` is appropriately typed within the handler.
**Prevention:** Always use `validateBody`, `validateQuery`, and `validateParams` middlewares from `server/routeUtils.ts` rather than inline `safeParse` for request validation.
