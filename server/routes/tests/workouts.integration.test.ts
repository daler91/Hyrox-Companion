import { describe, it, expect } from "vitest";
import request from "supertest";
import { setupIntegrationTest } from "./helpers";

describe("Workouts Integration Tests", () => {
  const context = setupIntegrationTest();

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

    if (response.status !== 201) throw new Error(JSON.stringify(response.body)); expect(response.status).toBe(201);
    expect(response.body).toHaveProperty("id");
    expect(response.body.title).toBe("Morning Run");
  });

  it("should retrieve workouts", async () => {
    // First create a workout
    await request(context.app)
      .post("/api/v1/workouts")
      .send({
        title: "Test Workout",
        date: new Date().toISOString().split("T")[0],
        type: "hyrox",
      });

    const response = await request(context.app).get("/api/v1/workouts");

    if (response.status !== 200) throw new Error(JSON.stringify(response.body)); expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThan(0);
    expect(response.body[0].title).toBe("Test Workout");
  });
});
