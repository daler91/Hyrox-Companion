/**
 * Pins docs/openapi.json to the routes the server actually registers.
 *
 * The native app's API models are generated from the OpenAPI document
 * (docs/mobile-app-plan.md, Phase 2), so a route that is not in it is a route
 * the app cannot call safely. When this was written the document described 6
 * of ~180 operations. This test makes the gap visible and stops it growing:
 *
 * - every registered /api operation must be documented, listed in
 *   OPENAPI_UNDOCUMENTED (test/docs/openapiUndocumented.ts), or excluded
 *   below as not a client endpoint;
 * - OPENAPI_UNDOCUMENTED may only shrink: an entry that is now documented,
 *   or whose route is gone, fails until it is removed;
 * - the document may not describe an operation the server does not register.
 *
 * IF ONE OF THESE FAILS: register the new route in a module under
 * shared/openapiRoutes/ (preferred), or add it to OPENAPI_UNDOCUMENTED with a
 * follow-up; after documenting a listed route, delete its entry. Then run
 * `pnpm docs:openapi`.
 *
 * Routes are read from source text, not by importing the routers, for the
 * same reason as docsSync.test.ts: importing server modules validates the
 * environment and opens pools.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { generateOpenApiDocument } from "../../shared/openapi";
import { OPENAPI_UNDOCUMENTED } from "./openapiUndocumented";

const ROOT = path.resolve(__dirname, "../..");
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/**
 * Operations that are not part of the client API, so they are not in the
 * document at all, each with the reason.
 */
const NOT_CLIENT_ENDPOINTS: Record<string, string> = {
  "GET /api/v1/csrf-token": "web app only: issues the double-submit CSRF token bearer clients do not need",
  "GET /api/v1/strava/callback": "Strava redirects the browser here; no client calls it",
  "GET /api/v1/strava/webhook": "Strava's webhook subscription validation, not a client endpoint",
  "POST /api/v1/strava/webhook": "Strava's webhook event delivery, not a client endpoint",
  "GET /api/v1/emails/unsubscribe": "opened from an email's List-Unsubscribe link, not by the app",
  "POST /api/v1/emails/unsubscribe": "RFC 8058 one-click unsubscribe from mail clients, not by the app",
  "GET /api/v1/analytics/internal/structured-exercise-health":
    "operator endpoint behind INTERNAL_ANALYTICS_SECRET, not part of the client API",
  "GET /api/v1/cron/emails": "scheduler endpoint behind CRON_SECRET (x-cron-secret), not part of the client API",
  "GET /api/v1/health": "readiness probe for the deploy gate (server/bootstrap/health.ts), not a client endpoint",
  "GET /api/v1/health/live": "liveness probe for the platform, not a client endpoint",
  "GET /api/v1/timeline/ai-suggestions/debug/{workoutId}":
    "debugging aid for the coach's suggestion inputs; no client calls it (docs/api-reference.md)",
  "POST /api/v1/workouts/migration/backfill":
    "one-off maintenance pass that re-parses set-less workouts with the AI; no client calls it",
};

function serverSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "__tests__" || entry.name === "tests") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) out.push(full);
    }
  };
  walk(path.join(ROOT, "server"));
  return out;
}

/** `/api/v1/workouts/:id` → `/api/v1/workouts/{id}`, the OpenAPI spelling. */
function toOpenApiPath(expressPath: string): string {
  return expressPath.replaceAll(/:(\w+)/g, "{$1}");
}

/**
 * Every `METHOD /path` the server registers under /api: direct router calls
 * (`router.get("/api/…"`), the protectedRouteBuilder helpers
 * (`protectedPost(router, "/api/…"`), and either form given a path constant
 * declared as `const X = "/…"` in any server file.
 */
function registeredOperations(): Set<string> {
  const sources = serverSources().map((file) => fs.readFileSync(file, "utf8"));
  const constants = new Map<string, string>();
  for (const src of sources) {
    for (const m of src.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*["'](\/[^"']*)["']/g)) constants.set(m[1], m[2]);
  }
  const resolve = (literal: string | undefined, constant: string | undefined) =>
    literal ?? (constant ? constants.get(constant) : undefined);

  const ops = new Set<string>();
  for (const src of sources) {
    for (const m of src.matchAll(
      /\b\w+\.(get|post|put|patch|delete)\(\s*(?:["']([^"']+)["']|([A-Z][A-Z0-9_]+))\s*,/g,
    )) {
      const routePath = resolve(m[2], m[3]);
      if (routePath?.startsWith("/api/")) ops.add(`${m[1].toUpperCase()} ${toOpenApiPath(routePath)}`);
    }
    for (const m of src.matchAll(
      /\bprotected(Get|Post|Put|Patch|Delete)\(\s*\w+\s*,\s*(?:["']([^"']+)["']|([A-Z][A-Z0-9_]+))/g,
    )) {
      const routePath = resolve(m[2], m[3]);
      if (routePath?.startsWith("/api/")) ops.add(`${m[1].toUpperCase()} ${toOpenApiPath(routePath)}`);
    }
  }
  return ops;
}

function documentedOperations(): Set<string> {
  const doc = generateOpenApiDocument();
  const ops = new Set<string>();
  for (const [routePath, item] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS) {
      if ((item as Record<string, unknown>)[method]) ops.add(`${method.toUpperCase()} ${routePath}`);
    }
  }
  return ops;
}

const sorted = (values: Iterable<string>) => [...values].sort();

describe("OpenAPI coverage of registered routes", () => {
  const registered = registeredOperations();
  const documented = documentedOperations();
  const undocumented = new Set(OPENAPI_UNDOCUMENTED);

  it("finds the routes (guards against the scan silently matching nothing)", () => {
    expect(registered.size).toBeGreaterThan(150);
  });

  it("documents every client operation, or lists it as not yet documented", () => {
    const missing = sorted(
      [...registered].filter((op) => !documented.has(op) && !undocumented.has(op) && !(op in NOT_CLIENT_ENDPOINTS)),
    );
    expect(missing, `Register these in shared/openapiRoutes/ (see this file's header): ${missing.join(", ")}`).toEqual([]);
  });

  it("only shrinks the not-yet-documented list: no entry may be documented already or name a missing route", () => {
    const stale = sorted([...undocumented].filter((op) => documented.has(op) || !registered.has(op)));
    expect(stale, `Delete these from test/docs/openapiUndocumented.ts: ${stale.join(", ")}`).toEqual([]);
  });

  it("does not document an operation the server does not register", () => {
    const phantom = sorted([...documented].filter((op) => !registered.has(op)));
    expect(phantom).toEqual([]);
  });

  it("keeps the not-a-client-endpoint exclusions pointing at real routes, outside the document", () => {
    for (const op of Object.keys(NOT_CLIENT_ENDPOINTS)) {
      expect(registered.has(op), `${op} is excluded but no longer registered`).toBe(true);
      expect(documented.has(op), `${op} is excluded but documented`).toBe(false);
    }
  });

  it("lists each not-yet-documented operation once", () => {
    expect(OPENAPI_UNDOCUMENTED.length).toBe(undocumented.size);
  });
});
