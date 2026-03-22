import { describe, it, expect } from "vitest";
import request from "supertest";
import { setupIntegrationTest } from "./helpers";

describe("API Integration Tests", () => {
  const context = setupIntegrationTest();

  describe("Plans Integration Tests", () => {
    it("should list training plans", async () => {
      const response = await request(context.app).get("/api/v1/plans");
      expect(response.body?.error || response.error?.message).toBeUndefined();
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it("should create a new training plan", async () => {
      const response = await request(context.app)
        .post("/api/v1/plans")
        .send({
          name: "Test Training Plan",
          description: "A solid plan for testing",
          durationWeeks: 4,
          difficulty: "beginner"
        });

      expect(response.body?.error || response.error?.message).toBeUndefined();
      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("id");
      expect(response.body.name).toBe("Test Training Plan");
    });
  });

  describe("Preferences and Timeline Integration Tests", () => {
    it("should get user preferences", async () => {
      const response = await request(context.app).get("/api/v1/preferences");
      expect(response.body?.error || response.error?.message).toBeUndefined();
      expect(response.status).toBe(200);
      expect(response.body.weightUnit).toBe("kg");
      expect(response.body.distanceUnit).toBe("km");
    });

    it("should update user preferences", async () => {
      const response = await request(context.app)
        .patch("/api/v1/preferences")
        .send({
          weightUnit: "lbs",
          distanceUnit: "miles"
        });

      expect(response.body?.error || response.error?.message).toBeUndefined();
      expect(response.status).toBe(200);
      expect(response.body.weightUnit).toBe("lbs");
      expect(response.body.distanceUnit).toBe("miles");
    });

    it("should fetch timeline correctly", async () => {
      const response = await request(context.app).get("/api/v1/timeline?days=7");
      expect(response.body?.error || response.error?.message).toBeUndefined();
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe("Workouts Integration Tests", () => {
    it("should create a new workout log", async () => {
      const response = await request(context.app)
        .post("/api/v1/workouts")
        .send({
          title: "Morning Run",
          description: "5k run around the park",
          date: new Date().toISOString().split("T")[0],
          type: "running",
          duration: 30,
          completed: true,
        });

      expect(response.body?.error || response.error?.message).toBeUndefined();
      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("id");
      expect(response.body.title).toBe("Morning Run");
    });

    it("should retrieve workouts", async () => {
      await request(context.app)
        .post("/api/v1/workouts")
        .send({
          title: "Test Workout",
          date: new Date().toISOString().split("T")[0],
          type: "hyrox",
        });

      const response = await request(context.app).get("/api/v1/workouts");

      expect(response.body?.error || response.error?.message).toBeUndefined();
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0].title).toBe("Test Workout");
    });
  });
});
