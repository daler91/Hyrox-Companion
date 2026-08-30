import express from "express";
import { type Mock, vi } from "vitest";

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
 * Creates a mocked express error handler to accurately verify that
 * asyncHandler bubbles errors correctly via next(err) without breaking tests.
 */
export function setupTestErrorHandler(app: express.Express) {
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // Intentionally left with only status sending logic to mock error handler behavior
    const status = err.status || 500;
    res.status(status).json({ error: "Internal Server Error", code: err.code || "INTERNAL_SERVER_ERROR", ...(status < 500 && err.details ? { details: err.details } : {}) });
  });
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
