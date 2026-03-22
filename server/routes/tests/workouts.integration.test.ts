import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp, clearDatabase, closeDatabase } from "./helpers";
import { db } from "../../db";
import { users } from "@shared/schema";

let app: any;
let server: any;

const testUserId = "user_12345_dev"; // matches DEV_USER_ID if ALLOW_DEV_AUTH_BYPASS is true

describe("Workouts Integration Tests", () => {
  beforeAll(async () => {
    const setup = await createTestApp();
    app = setup.app;
    server = setup.httpServer;
  });

  afterAll(async () => {
    await closeDatabase();
    if (server) {
      server.close();
    }
  });

  beforeEach(async () => {
    await clearDatabase();

    // Ensure test user exists in the db to avoid foreign key errors
    await db.insert(users).values({
      id: testUserId,
      email: "test@example.com",
      username: "testuser",
    });
  });

  it("should create a new workout log", async () => {
    const response = await request(app)
      .post("/api/v1/workouts")
      .send({
        title: "Morning Run",
        description: "5k run around the park",
        date: new Date().toISOString().split("T")[0],
        type: "running",
        duration: 30,
        completed: true,
      });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty("id");
    expect(response.body.title).toBe("Morning Run");
  });

  it("should retrieve workouts", async () => {
    // First create a workout
    await request(app)
      .post("/api/v1/workouts")
      .send({
        title: "Test Workout",
        date: new Date().toISOString().split("T")[0],
        type: "hyrox",
      });

    const response = await request(app).get("/api/v1/workouts");

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThan(0);
    expect(response.body[0].title).toBe("Test Workout");
  });
});
