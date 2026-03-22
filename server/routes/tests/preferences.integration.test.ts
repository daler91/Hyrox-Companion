import { describe, it, expect } from "vitest";
import request from "supertest";
import { setupIntegrationTest } from "./helpers";

describe("Preferences and Timeline Integration Tests", () => {
  const context = setupIntegrationTest();

  it("should get user preferences", async () => {
    const response = await request(context.app).get("/api/v1/preferences");
    if (response.status !== 200) throw new Error(JSON.stringify(response.body)); expect(response.status).toBe(200);
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

    if (response.status !== 200) throw new Error(JSON.stringify(response.body)); expect(response.status).toBe(200);
    expect(response.body.weightUnit).toBe("lbs");
    expect(response.body.distanceUnit).toBe("miles");
  });

  it("should fetch timeline correctly", async () => {
    // Basic timeline fetching (could include no data to start)
    const response = await request(context.app).get("/api/v1/timeline?days=7");
    if (response.status !== 200) throw new Error(JSON.stringify(response.body)); expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });
});
