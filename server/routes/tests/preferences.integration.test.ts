import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp, clearDatabase, closeDatabase } from "./helpers";
import { db } from "../../db";
import { users } from "@shared/schema";

let app: any;
let server: any;

const testUserId = "user_12345_dev";

describe("Preferences and Timeline Integration Tests", () => {
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
      weightUnit: "kg",
      distanceUnit: "km",
    });
  });

  it("should get user preferences", async () => {
    const response = await request(app).get("/api/v1/preferences");
    expect(response.status).toBe(200);
    expect(response.body.weightUnit).toBe("kg");
    expect(response.body.distanceUnit).toBe("km");
  });

  it("should update user preferences", async () => {
    const response = await request(app)
      .patch("/api/v1/preferences")
      .send({
        weightUnit: "lbs",
        distanceUnit: "miles"
      });

    expect(response.status).toBe(200);
    expect(response.body.weightUnit).toBe("lbs");
    expect(response.body.distanceUnit).toBe("miles");
  });

  it("should fetch timeline correctly", async () => {
    // Basic timeline fetching (could include no data to start)
    const response = await request(app).get("/api/v1/timeline?days=7");
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });
});
