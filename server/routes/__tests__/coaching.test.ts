import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import coachingRouter from "../coaching";
import { storage } from "../../storage";
import { queue } from "../../queue";

// Mock auth
vi.mock("../../clerkAuth", () => ({
  isAuthenticated: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.auth = { userId: "test_user_id" };
    next();
  },
}));

vi.mock("../../types", () => ({
  getUserId: () => "test_user_id",
}));

vi.mock("../../storage", () => ({
  storage: {
    listCoachingMaterials: vi.fn(),
    createCoachingMaterial: vi.fn(),
    updateCoachingMaterial: vi.fn(),
    deleteCoachingMaterial: vi.fn(),
  },
}));

vi.mock("../../queue", () => ({
  queue: {
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("Coaching materials routes", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    const routeUtils = await import("../../routeUtils");
    routeUtils.clearRateLimitBuckets();
    app = express();
    app.use(express.json());
    app.use(coachingRouter);
  });

  describe("GET /api/v1/coaching-materials", () => {
    it("should list coaching materials", async () => {
      const materials = [{ id: "m1", title: "Guide", content: "content", type: "document", userId: "test_user_id" }];
      vi.mocked(storage.listCoachingMaterials).mockResolvedValue(materials as any);

      const response = await request(app).get("/api/v1/coaching-materials");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(materials);
      expect(storage.listCoachingMaterials).toHaveBeenCalledWith("test_user_id");
    });
  });

  describe("POST /api/v1/coaching-materials", () => {
    const validBody = { title: "Guide", content: "Training content", type: "document" };

    it("should create material and trigger background embedding", async () => {
      const createdMaterial = { id: "m1", ...validBody, userId: "test_user_id", createdAt: new Date(), updatedAt: new Date() };
      vi.mocked(storage.createCoachingMaterial).mockResolvedValue(createdMaterial as any);

      const response = await request(app)
        .post("/api/v1/coaching-materials")
        .send(validBody);

      expect(response.status).toBe(201);
      expect(storage.createCoachingMaterial).toHaveBeenCalled();
      expect(queue.send).toHaveBeenCalledWith("embed-coaching-material", { material: createdMaterial });
    });

    it("should return 400 for invalid data", async () => {
      const response = await request(app)
        .post("/api/v1/coaching-materials")
        .send({ title: "" });

      expect(response.status).toBe(400);
      expect(queue.send).not.toHaveBeenCalled();
    });
  });

  describe("PATCH /api/v1/coaching-materials/:id", () => {
    it("should re-embed when content is updated", async () => {
      const updatedMaterial = { id: "m1", title: "Guide", content: "New content", type: "document", userId: "test_user_id" };
      vi.mocked(storage.updateCoachingMaterial).mockResolvedValue(updatedMaterial as any);

      const response = await request(app)
        .patch("/api/v1/coaching-materials/m1")
        .send({ content: "New content" });

      expect(response.status).toBe(200);
      expect(queue.send).toHaveBeenCalledWith("embed-coaching-material", { material: updatedMaterial });
    });

    it("should re-embed when title is updated", async () => {
      const updatedMaterial = { id: "m1", title: "New Title", content: "content", type: "document", userId: "test_user_id" };
      vi.mocked(storage.updateCoachingMaterial).mockResolvedValue(updatedMaterial as any);

      const response = await request(app)
        .patch("/api/v1/coaching-materials/m1")
        .send({ title: "New Title" });

      expect(response.status).toBe(200);
      expect(queue.send).toHaveBeenCalledWith("embed-coaching-material", { material: updatedMaterial });
    });

    it("should NOT re-embed when only type is updated", async () => {
      const updatedMaterial = { id: "m1", title: "Guide", content: "content", type: "principles", userId: "test_user_id" };
      vi.mocked(storage.updateCoachingMaterial).mockResolvedValue(updatedMaterial as any);

      const response = await request(app)
        .patch("/api/v1/coaching-materials/m1")
        .send({ type: "principles" });

      expect(response.status).toBe(200);
      expect(queue.send).not.toHaveBeenCalled();
    });

    it("should return 404 when material not found", async () => {
      vi.mocked(storage.updateCoachingMaterial).mockResolvedValue(undefined);

      const response = await request(app)
        .patch("/api/v1/coaching-materials/nonexistent")
        .send({ title: "Updated" });

      expect(response.status).toBe(404);
      expect(queue.send).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /api/v1/coaching-materials/:id", () => {
    it("should delete material (chunks cascade-deleted via FK)", async () => {
      vi.mocked(storage.deleteCoachingMaterial).mockResolvedValue(true);

      const response = await request(app).delete("/api/v1/coaching-materials/m1");

      expect(response.status).toBe(200);
      expect(storage.deleteCoachingMaterial).toHaveBeenCalledWith("m1", "test_user_id");
    });

    it("should return 404 when material not found", async () => {
      vi.mocked(storage.deleteCoachingMaterial).mockResolvedValue(false);

      const response = await request(app).delete("/api/v1/coaching-materials/nonexistent");

      expect(response.status).toBe(404);
    });
  });
});
