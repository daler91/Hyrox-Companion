import express from "express";
import { registerRoutes } from "../../routes";
import { createServer } from "node:http";
import { pool, db } from "../../db";
import {
  users,
  trainingPlans,
  planDays,
  workoutLogs,
  exerciseSets
} from "@shared/schema";

// Create a test app instance
export async function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Mock dev auth bypass headers or variables are set in process.env
  // ALLOW_DEV_AUTH_BYPASS="true" is in test env

  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);

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

// Close DB connection after tests
export async function closeDatabase() {
  await pool.end();
}
