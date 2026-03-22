import { describe, it, expect } from "vitest";
import request from "supertest";
import { setupIntegrationTest } from "./helpers";

describe("Plans Integration Tests", () => {
  const context = setupIntegrationTest();

  it("should list training plans", async () => {
    const response = await request(context.app).get("/api/v1/plans");
    if (response.status !== 200) throw new Error(JSON.stringify(response.body)); expect(response.status).toBe(200);
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

    if (response.status !== 201) throw new Error(JSON.stringify(response.body)); expect(response.status).toBe(201);
    expect(response.body).toHaveProperty("id");
    expect(response.body.name).toBe("Test Training Plan");
  });
});
