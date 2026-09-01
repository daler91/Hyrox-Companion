import express from "express";
import request from "supertest";
import { beforeEach,describe, expect, it, vi } from "vitest";

import { sendJob } from "../../queue";
import { storage } from "../../storage";
import coachingRouter from "../coaching";
import { createTestApp, resetRouteTestState } from "./testUtils";

vi.mock("../../clerkAuth", async () => (await import("./testUtils")).mockClerkAuthModule());

vi.mock("../../types", async () => (await import("./testUtils")).mockTypesModule());

vi.mock("../../middleware/aibudget", async () => (await import("./testUtils")).mockAiBudgetModule());

vi.mock("../../storage", async () =>
  (await import("./testUtils")).mockStorageModule({
    coaching: ["listCoachingMaterials", "createCoachingMaterial", "updateCoachingMaterial", "deleteCoachingMaterial", "deleteChunksByMaterialId"],
    users: ["getUser"],
  }),
);

vi.mock("../../queue", () => ({
  queue: {
    send: vi.fn().mockResolvedValue(undefined),
  },
  sendJob: vi.fn().mockResolvedValue(undefined),
  sendJobNoRetry: vi.fn().mockResolvedValue(undefined),
}));

type MaterialRecord = Awaited<ReturnType<typeof storage.coaching.createCoachingMaterial>>;
type MaterialList = Awaited<ReturnType<typeof storage.coaching.listCoachingMaterials>>;
type MaterialUpdate = Awaited<ReturnType<typeof storage.coaching.updateCoachingMaterial>>;

describe("Coaching materials routes", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetRouteTestState();
    vi.mocked(storage.users.getUser).mockResolvedValue({ id: "test_user_id", aiCoachEnabled: true });
    app = createTestApp(coachingRouter);
  });

  describe("GET /api/v1/coaching-materials", () => {
    it("should list coaching materials", async () => {
      const materials = [{ id: "m1", title: "Guide", content: "content", type: "document", userId: "test_user_id" }];
      vi.mocked(storage.coaching.listCoachingMaterials).mockResolvedValue(materials);

      const response = await request(app).get("/api/v1/coaching-materials");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(materials);
      expect(storage.coaching.listCoachingMaterials).toHaveBeenCalledWith("test_user_id");
    });
  });

  describe("POST /api/v1/coaching-materials", () => {
    const validBody = { title: "Guide", content: "Training content", type: "document" };

    it("should create material and trigger background embedding", async () => {
      const createdMaterial = { id: "m1", ...validBody, userId: "test_user_id", createdAt: new Date(), updatedAt: new Date() };
      vi.mocked(storage.coaching.createCoachingMaterial).mockResolvedValue(createdMaterial);

      const response = await request(app)
        .post("/api/v1/coaching-materials")
        .send(validBody);

      expect(response.status).toBe(201);
      expect(storage.coaching.createCoachingMaterial).toHaveBeenCalled();
      expect(sendJob).toHaveBeenCalledWith("embed-coaching-material", { materialId: createdMaterial.id, userId: "test_user_id" });
    });

    it("requires AI consent before creating material for embedding", async () => {
      vi.mocked(storage.users.getUser).mockResolvedValueOnce({ id: "test_user_id", aiCoachEnabled: false });

      const response = await request(app)
        .post("/api/v1/coaching-materials")
        .send(validBody);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe("AI_COACH_DISABLED");
      expect(storage.coaching.createCoachingMaterial).not.toHaveBeenCalled();
      expect(sendJob).not.toHaveBeenCalled();
    });

    it("should return 400 for invalid data", async () => {
      const response = await request(app)
        .post("/api/v1/coaching-materials")
        .send({ title: "" });

      expect(response.status).toBe(400);
      expect(sendJob).not.toHaveBeenCalled();
    });
  });

  describe("PATCH /api/v1/coaching-materials/:id", () => {
    it("should re-embed when content is updated", async () => {
      const updatedMaterial = { id: "m1", title: "Guide", content: "New content", type: "document", userId: "test_user_id" };
      vi.mocked(storage.coaching.updateCoachingMaterial).mockResolvedValue(updatedMaterial as unknown as MaterialUpdate);

      const response = await request(app)
        .patch("/api/v1/coaching-materials/m1")
        .send({ content: "New content" });

      expect(response.status).toBe(200);
      expect(sendJob).toHaveBeenCalledWith("embed-coaching-material", { materialId: updatedMaterial.id, userId: "test_user_id" });
    });

    it("should re-embed when title is updated", async () => {
      const updatedMaterial = { id: "m1", title: "New Title", content: "content", type: "document", userId: "test_user_id" };
      vi.mocked(storage.coaching.updateCoachingMaterial).mockResolvedValue(updatedMaterial as unknown as MaterialUpdate);

      const response = await request(app)
        .patch("/api/v1/coaching-materials/m1")
        .send({ title: "New Title" });

      expect(response.status).toBe(200);
      expect(sendJob).toHaveBeenCalledWith("embed-coaching-material", { materialId: updatedMaterial.id, userId: "test_user_id" });
    });

    it("should NOT re-embed when only type is updated", async () => {
      const updatedMaterial = { id: "m1", title: "Guide", content: "content", type: "principles", userId: "test_user_id" };
      vi.mocked(storage.coaching.updateCoachingMaterial).mockResolvedValue(updatedMaterial as unknown as MaterialUpdate);

      const response = await request(app)
        .patch("/api/v1/coaching-materials/m1")
        .send({ type: "principles" });

      expect(response.status).toBe(200);
      expect(sendJob).not.toHaveBeenCalled();
    });

    it("should return 404 when material not found", async () => {
      vi.mocked(storage.coaching.updateCoachingMaterial).mockResolvedValue(undefined);

      const response = await request(app)
        .patch("/api/v1/coaching-materials/nonexistent")
        .send({ title: "Updated" });

      expect(response.status).toBe(404);
      expect(sendJob).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /api/v1/coaching-materials/:id", () => {
    it("deletes the material AND purges its vector-DB chunks (split-DB mode has no FK cascade)", async () => {
      vi.mocked(storage.coaching.deleteCoachingMaterial).mockResolvedValue(true);
      vi.mocked(storage.coaching.deleteChunksByMaterialId).mockResolvedValue(undefined);

      const response = await request(app).delete("/api/v1/coaching-materials/m1");

      expect(response.status).toBe(200);
      expect(storage.coaching.deleteCoachingMaterial).toHaveBeenCalledWith("m1", "test_user_id");
      // User-scoped purge, and only AFTER the ownership-checked delete confirmed.
      expect(storage.coaching.deleteChunksByMaterialId).toHaveBeenCalledWith("m1", "test_user_id");
    });

    it("still succeeds when the vector-DB chunk purge fails (nightly sweep is the backstop)", async () => {
      vi.mocked(storage.coaching.deleteCoachingMaterial).mockResolvedValue(true);
      vi.mocked(storage.coaching.deleteChunksByMaterialId).mockRejectedValue(new Error("vector db unreachable"));

      const response = await request(app).delete("/api/v1/coaching-materials/m1");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
    });

    it("should return 404 when material not found — and never touches the chunk store", async () => {
      vi.mocked(storage.coaching.deleteCoachingMaterial).mockResolvedValue(false);

      const response = await request(app).delete("/api/v1/coaching-materials/nonexistent");

      expect(response.status).toBe(404);
      expect(storage.coaching.deleteChunksByMaterialId).not.toHaveBeenCalled();
    });
  });
});
