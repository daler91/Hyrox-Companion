import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateCSV, generateJSON } from "../../services/exportService";
import { registerWorkoutExportRoutes } from "../workouts/workoutsExport.routes";

vi.mock("../../clerkAuth", () => ({
  isAuthenticated: (req: any, _res: any, next: () => void) => {
    req.auth = { userId: "test_user_id" };
    next();
  },
}));

vi.mock("../../types", () => ({
  getUserId: () => "test_user_id",
}));

vi.mock("../../routeUtils", () => ({
  rateLimiter: () => (_req: any, _res: any, next: () => void) => next(),
  asyncHandler: (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next),
}));

vi.mock("../../services/exportService", () => ({
  generateCSV: vi.fn(),
  generateJSON: vi.fn(),
}));

vi.mock("../../storage", () => ({
  storage: {},
}));

describe("Workout Export Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    const router = express.Router();
    registerWorkoutExportRoutes(router);
    app.use(router);
  });

  it("should export CSV by default", async () => {
    vi.mocked(generateCSV).mockResolvedValue("mock,csv,data");

    const response = await request(app).get("/api/v1/export");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toContain("attachment; filename=hyrox-training-data.csv");
    expect(response.text).toBe("mock,csv,data");
    expect(generateCSV).toHaveBeenCalledWith("test_user_id", expect.anything());
    expect(generateJSON).not.toHaveBeenCalled();
  });

  it("should export CSV when format=csv is explicitly requested", async () => {
    vi.mocked(generateCSV).mockResolvedValue("explicit,csv,data");

    const response = await request(app).get("/api/v1/export?format=csv");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toContain("attachment; filename=hyrox-training-data.csv");
    expect(response.text).toBe("explicit,csv,data");
    expect(generateCSV).toHaveBeenCalledTimes(1);
    expect(generateJSON).not.toHaveBeenCalled();
  });

  it("should export JSON when format=json is requested", async () => {
    vi.mocked(generateJSON).mockResolvedValue({ some: "data" } as any);

    const response = await request(app).get("/api/v1/export?format=json");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["content-disposition"]).toContain("attachment; filename=hyrox-training-data.json");
    expect(response.body).toEqual({ some: "data" });
    expect(generateJSON).toHaveBeenCalledWith("test_user_id", expect.anything());
    expect(generateCSV).not.toHaveBeenCalled();
  });

  it("handles errors from export services gracefully", async () => {
    vi.mocked(generateCSV).mockRejectedValue(new Error("Export failed"));

    const response = await request(app).get("/api/v1/export");

    expect(response.status).toBe(500); // Because of asyncHandler default error behavior.
    expect(generateCSV).toHaveBeenCalledTimes(1);
  });
});
