import request from "supertest";
import { beforeAll,describe, expect, it } from "vitest";

import { setupIntegrationTest } from "./helpers";

describe("API Integration Tests", () => {
  const context = setupIntegrationTest();

  // The /api/v1 router is guarded by csrf-csrf, which requires a signed
  // cookie + matching x-csrf-token header on every mutating request. Share
  // a supertest agent so cookies persist, fetch the token once, and attach
  // it to mutating calls below.
  let agent: ReturnType<typeof request.agent>;
  let csrfToken: string;

  beforeAll(async () => {
    agent = request.agent(context.app);
    const res = await agent.get("/api/v1/csrf-token");
    csrfToken = (res.body as { csrfToken: string }).csrfToken;
  });

  describe("Plans Integration Tests", () => {
    it("should list training plans", async () => {
      const response = await agent.get("/api/v1/plans");
      expect(response.body?.error || response.error?.message).toBeUndefined();
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe("Preferences and Timeline Integration Tests", () => {
    it("should get user preferences", async () => {
      const response = await agent.get("/api/v1/preferences");
      expect(response.body?.error || response.error?.message).toBeUndefined();
      expect(response.status).toBe(200);
      expect(response.body.weightUnit).toBe("kg");
      expect(response.body.distanceUnit).toBe("km");
    });

    it("should update user preferences", async () => {
      const response = await agent
        .patch("/api/v1/preferences")
        .set("x-csrf-token", csrfToken)
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
      const response = await agent.get("/api/v1/timeline?days=7");
      expect(response.body?.error || response.error?.message).toBeUndefined();
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe("Workouts Integration Tests", () => {
    it("should create a new workout log", async () => {
      const response = await agent
        .post("/api/v1/workouts")
        .set("x-csrf-token", csrfToken)
        .send({
          date: new Date().toISOString().split("T")[0],
          focus: "strength",
          mainWorkout: "5x5 Squats",
          duration: 30,
          completed: true,
        });

      expect(response.body?.error || response.error?.message).toBeUndefined();
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("id");
      expect(response.body.focus).toBe("strength");
    });

    it("should retrieve workouts", async () => {
      await agent
        .post("/api/v1/workouts")
        .set("x-csrf-token", csrfToken)
        .send({
          date: new Date().toISOString().split("T")[0],
          focus: "conditioning",
          mainWorkout: "Hyrox Simulator",
        });

      const response = await agent.get("/api/v1/workouts");

      expect(response.body?.error || response.error?.message).toBeUndefined();
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0].focus).toBe("conditioning");
    });
  });
});
