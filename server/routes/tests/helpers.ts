import express from "express";
import { registerRoutes } from "../../routes";
import { createServer } from "node:http";
import { db } from "../../db";
import {
  users,
  trainingPlans,
  planDays,
  workoutLogs,
  exerciseSets
} from "@shared/schema";
import { beforeAll, afterAll, beforeEach, vi } from "vitest";
import { queue } from "../../queue";

// Common test user ID matching DEV_USER_ID if ALLOW_DEV_AUTH_BYPASS is true
export const testUserId = "dev-user";

// Create a test app instance
export async function createTestApp() {
  queue.send = vi.fn().mockResolvedValue(null);
  queue.work = vi.fn().mockResolvedValue(null);
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Mock dev auth bypass headers or variables are set in process.env
  // ALLOW_DEV_AUTH_BYPASS="true" is in test env

  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);

  // Add error handling middleware to capture exact 500 errors in tests
  app.use((err: any, _req: any, res: any, next: any) => {
    console.error("Test App Error Caught:", err);
    res.status(err.status || err.statusCode || 500).json({ error: err.message });
  });

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
  const context = {
    app: null as any,
    server: null as any,
  };

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
