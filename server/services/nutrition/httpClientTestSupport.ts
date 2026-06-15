/**
 * Shared HTTP-response builders for the external nutrition client tests. A minimal
 * stand-in for the `fetch` Response shape these clients read: `ok`, `status`,
 * `json()`, and a `headers.get()` that returns null (no Retry-After). Kept here so
 * the builders aren't re-declared in every provider spec.
 */

export function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body, headers: { get: () => null } };
}

export function errResponse(status: number) {
  return { ok: false, status, json: async () => ({}), headers: { get: () => null } };
}
