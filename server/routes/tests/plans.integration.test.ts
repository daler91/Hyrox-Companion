import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp, clearDatabase, closeDatabase } from "./helpers";
import { db } from "../../db";
import { users } from "@shared/schema";

let app: any;
let server: any;

const testUserId = "user_12345_dev";

describe("Plans Integration Tests", () => {
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

    // Ensure test user exists in the db
    await db.insert(users).values({
      id: testUserId,
      email: "test@example.com",
      username: "testuser",
    });
  });

  it("should list training plans", async () => {
    const response = await request(app).get("/api/v1/plans");
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it("should create a new training plan", async () => {
    const response = await request(app)
      .post("/api/v1/plans")
      .send({
        name: "Test Training Plan",
        description: "A solid plan for testing",
        durationWeeks: 4,
        difficulty: "beginner"
      });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty("id");
    expect(response.body.name).toBe("Test Training Plan");
  });
});
