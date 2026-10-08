import express from "express";
import { type Mock, vi } from "vitest";

import { globalErrorHandler } from "../../middleware/errorHandler";

export const TEST_USER_ID = "test_user_id";

/**
 * Module factories for the vi.mock() preamble every route test repeats.
 * vi.mock() calls are hoisted and must stay in each test file, but their
 * factories can delegate here: `vi.mock("../../clerkAuth", async () =>
 * (await import("./testUtils")).mockClerkAuthModule())`.
 */
export function mockClerkAuthModule() {
  return {
    isAuthenticated: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
      req.auth = { userId: TEST_USER_ID };
      next();
    },
  };
}

export function mockTypesModule() {
  return { getUserId: () => TEST_USER_ID };
}

export function mockAiBudgetModule() {
  return { aiBudgetCheck: (_req: unknown, _res: unknown, next: () => void) => next() };
}

/**
 * Builds the `{ storage }` module shape with a vi.fn() for every listed
 * method, so tests declare just the namespaces/methods they exercise.
 */
export function mockStorageModule(shape: Record<string, readonly string[]>) {
  const storage: Record<string, Record<string, Mock>> = {};
  for (const [namespace, methods] of Object.entries(shape)) {
    storage[namespace] = Object.fromEntries(methods.map((method) => [method, vi.fn()]));
  }
  return { storage };
}

/**
 * Mounts the production error handler, so route tests see exactly the error
 * replies athletes get. A test-only stand-in used to send "Internal Server
 * Error" for every status, which meant a regression that masked the 4xx
 * messages the client shows (validation copy, the food-in-use delete message,
 * Strava reauth copy) passed every route test. A10 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function setupTestErrorHandler(app: express.Express) {
  app.use(globalErrorHandler);
}

/**
 * Common setup for test Express apps to reduce boilerplate and SonarCloud code duplication
 */
export function createTestApp(router: express.Router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  setupTestErrorHandler(app);
  return app;
}

export async function resetRouteTestState() {
  const routeUtils = await import("../../routeUtils");
  routeUtils.clearRateLimitBuckets();
}
