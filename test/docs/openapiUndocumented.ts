/**
 * Registered /api operations not yet described in docs/openapi.json.
 *
 * This list may only shrink (test/docs/openapiCoverage.test.ts): document a
 * route in a module under shared/openapiRoutes/ and delete its line here. A
 * new route goes straight into the document, never onto this list.
 *
 * Empty: every client route is documented. Keep it that way — register a new
 * route in shared/openapiRoutes/ rather than listing it here; the list exists
 * so a route that genuinely cannot be documented yet has somewhere to go.
 */
export const OPENAPI_UNDOCUMENTED: readonly string[] = [];
