import { createServer, type Server } from "node:http";

import {
  exerciseSets,
  planDays,
  trainingPlans,
  users,
  workoutLogs} from "@shared/schema";
import cookieParser from "cookie-parser";
import express from "express";
import { afterAll, beforeAll, beforeEach, vi } from "vitest";

import { db } from "../../db";
import { queue } from "../../queue";
import { registerRoutes } from "../../routes";

/**
 * The error shape route handlers throw in tests: an Error decorated with the
 * optional status/code/details fields the API error contract carries.
 */
type TestHttpError = Error & {
  status?: number;
  statusCode?: number;
  code?: string;
  details?: unknown;
};

interface IntegrationTestContext {
  app: express.Express;
  server: Server;
}

// Common test user ID matching DEV_USER_ID if ALLOW_DEV_AUTH_BYPASS is true
export const testUserId = "dev-user";

// Create a test app instance
export async function createTestApp() {
  queue.send = vi.fn().mockResolvedValue(null);
  queue.work = vi.fn().mockResolvedValue(null);
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  // Mirror production middleware order: csrf-csrf reads the signed cookie via
  // req.cookies, so cookie-parser must be mounted before registerRoutes.
  app.use(cookieParser());

  // Mock dev auth bypass headers or variables are set in process.env
  // ALLOW_DEV_AUTH_BYPASS="true" is in test env

  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);

  // Add error handling middleware to capture exact 500 errors in tests
  const errorHandler: express.ErrorRequestHandler = (err: TestHttpError, _req, res, _next) => {
    console.error("Test App Error Caught:", err);
    res.status(err.status || err.statusCode || 500).json({ error: err.message, code: err.code || "INTERNAL_SERVER_ERROR", details: err.details });
  };
  app.use(errorHandler);

  return { app, httpServer };
}

// Clear database tables between tests
export async function clearDatabase() {
  await db.delete(exerciseSets);
  await db.delete(workoutLogs);
  await db.delete(planDays);
  await db.delete(trainingPlans);
  await db.delete(users);
}

/**
 * Standard integration test setup hook.
 * Wires up Vitest lifecycle methods (beforeAll, afterAll, beforeEach) to
 * initialize the express app, clear the database, and insert a mock user.
 * Returns an object with the express app reference.
 */
export function setupIntegrationTest() {
  // Populated by the beforeAll hook below before any test body runs, so the
  // fields are typed as always-present rather than forcing a non-null
  // assertion at every `context.app` use site.
  const context = {} as IntegrationTestContext;

  beforeAll(async () => {
    const setup = await createTestApp();
    context.app = setup.app;
    context.server = setup.httpServer;
  });

  afterAll(async () => {
    await clearDatabase();
    if (context.server) {
      context.server.close();
    }
  });

  beforeEach(async () => {
    await clearDatabase();

    // Ensure test user exists in the db to avoid foreign key errors
    await db.insert(users).values({
      id: testUserId,
      email: "test@example.com",
      weightUnit: "kg",
      distanceUnit: "km",
    }).onConflictDoNothing();
  });

  return context;
}
