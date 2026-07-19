import type express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { evictUserFromSeenCache } from "../../clerkAuth";
import { purgeUserJobs } from "../../queue";
import { clearRateLimitBuckets } from "../../routeUtils";
import { deleteFoodEmbeddingsByFoodIds } from "../../services/nutrition/foodEmbeddings";
import { storage } from "../../storage";
import accountRouter from "../account";
import { createTestApp } from "./testUtils";

// ---------------------------------------------------------------------------
// DELETE /api/v1/account — erasure ordering tests. The GDPR contract under
// guard: private-custom-food ids are captured BEFORE the user-delete cascade
// destroys ownership (set-null), the vector-DB purges are fail-loud BEFORE
// anything irreversible (Clerk delete), and best-effort tail steps can never
// fail the request after the user row is gone.
// ---------------------------------------------------------------------------

vi.mock("../../clerkAuth", () => ({
  isAuthenticated: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.auth = { userId: "test_user_id" };
    next();
  },
  evictUserFromSeenCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../types", () => ({
  getUserId: () => "test_user_id",
}));

// env is NOT mocked: vitest.setup.ts sets CLERK_SECRET_KEY="dummy", so the
// real env module keeps step 2 (Clerk delete) active while routeUtils and the
// protected-route builder see a fully validated environment.

const { clerkDeleteUser } = vi.hoisted(() => ({ clerkDeleteUser: vi.fn() }));
vi.mock("@clerk/express", () => ({
  clerkClient: { users: { deleteUser: clerkDeleteUser } },
}));

vi.mock("../../queue", () => ({
  purgeUserJobs: vi.fn(),
}));

vi.mock("../../strava", () => ({
  deauthorizeStravaBestEffort: vi.fn(),
}));

vi.mock("../../services/nutrition/foodEmbeddings", () => ({
  deleteFoodEmbeddingsByFoodIds: vi.fn(),
}));

vi.mock("../../storage", () => ({
  storage: {
    coaching: { deleteChunksByUserId: vi.fn() },
    nutrition: { listPrivateCustomFoodIds: vi.fn() },
    users: {
      deleteUserAndPrivateCustomFoods: vi.fn(),
      getStravaConnection: vi.fn(),
      getGarminConnection: vi.fn(),
      purgeRateLimitBucketsForUser: vi.fn(),
    },
  },
}));

const PRIVATE_FOOD_IDS = ["food-a", "food-b"];

function firstCallOrder(mock: { mock: { invocationCallOrder: number[] } }): number {
  const order = mock.mock.invocationCallOrder[0];
  expect(order).toBeDefined();
  return order;
}

describe("DELETE /api/v1/account", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimitBuckets();
    app = createTestApp(accountRouter);

    vi.mocked(storage.nutrition.listPrivateCustomFoodIds).mockResolvedValue(PRIVATE_FOOD_IDS);
    vi.mocked(storage.coaching.deleteChunksByUserId).mockResolvedValue(undefined);
    vi.mocked(deleteFoodEmbeddingsByFoodIds).mockResolvedValue(undefined);
    clerkDeleteUser.mockResolvedValue(undefined);
    vi.mocked(storage.users.getStravaConnection).mockResolvedValue(undefined);
    vi.mocked(storage.users.getGarminConnection).mockResolvedValue(undefined);
    vi.mocked(storage.users.deleteUserAndPrivateCustomFoods).mockResolvedValue({
      deleted: true,
      deletedFoodIds: PRIVATE_FOOD_IDS,
    });
    vi.mocked(storage.users.purgeRateLimitBucketsForUser).mockResolvedValue(undefined);
    vi.mocked(purgeUserJobs).mockResolvedValue(undefined);
    vi.mocked(evictUserFromSeenCache).mockResolvedValue(undefined);
  });

  it("erases in the documented order: capture ids → vector purges → Clerk → transactional delete → tail", async () => {
    const response = await request(app).delete("/api/v1/account");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });

    // Ids captured from the main DB while ownership still exists…
    expect(storage.nutrition.listPrivateCustomFoodIds).toHaveBeenCalledWith("test_user_id");
    // …and both vector-DB purges receive them / the user id.
    expect(storage.coaching.deleteChunksByUserId).toHaveBeenCalledWith("test_user_id");
    expect(deleteFoodEmbeddingsByFoodIds).toHaveBeenNthCalledWith(1, PRIVATE_FOOD_IDS);
    expect(deleteFoodEmbeddingsByFoodIds).toHaveBeenNthCalledWith(2, PRIVATE_FOOD_IDS);
    expect(storage.users.deleteUserAndPrivateCustomFoods).toHaveBeenCalledWith("test_user_id");

    // Ordering: capture → vector purge → Clerk → user+foods delete → eviction.
    const captureOrder = firstCallOrder(vi.mocked(storage.nutrition.listPrivateCustomFoodIds));
    const chunksOrder = firstCallOrder(vi.mocked(storage.coaching.deleteChunksByUserId));
    const embeddingsOrder = firstCallOrder(vi.mocked(deleteFoodEmbeddingsByFoodIds));
    const clerkOrder = firstCallOrder(clerkDeleteUser);
    const deleteOrder = firstCallOrder(vi.mocked(storage.users.deleteUserAndPrivateCustomFoods));
    const evictOrder = firstCallOrder(vi.mocked(evictUserFromSeenCache));
    expect(captureOrder).toBeLessThan(chunksOrder);
    expect(chunksOrder).toBeLessThan(clerkOrder);
    expect(embeddingsOrder).toBeLessThan(clerkOrder);
    expect(clerkOrder).toBeLessThan(deleteOrder);
    expect(deleteOrder).toBeLessThan(evictOrder);
  });

  it("fails loud BEFORE Clerk when the vector-DB embeddings purge fails (request stays retriable)", async () => {
    vi.mocked(deleteFoodEmbeddingsByFoodIds).mockRejectedValueOnce(new Error("vector db down"));

    const response = await request(app).delete("/api/v1/account");

    expect(response.status).toBe(500);
    expect(clerkDeleteUser).not.toHaveBeenCalled();
    expect(storage.users.deleteUserAndPrivateCustomFoods).not.toHaveBeenCalled();
  });

  it("fails loud BEFORE Clerk when the RAG chunk purge fails", async () => {
    vi.mocked(storage.coaching.deleteChunksByUserId).mockRejectedValueOnce(new Error("vector db down"));

    const response = await request(app).delete("/api/v1/account");

    expect(response.status).toBe(500);
    expect(clerkDeleteUser).not.toHaveBeenCalled();
    expect(storage.users.deleteUserAndPrivateCustomFoods).not.toHaveBeenCalled();
  });

  it("still succeeds when best-effort tail steps fail after the user row is gone", async () => {
    // First purge (step 1) succeeds; the post-transaction catch-up purge fails.
    vi.mocked(deleteFoodEmbeddingsByFoodIds)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("vector hiccup"));
    vi.mocked(purgeUserJobs).mockRejectedValueOnce(new Error("pgboss hiccup"));
    vi.mocked(storage.users.purgeRateLimitBucketsForUser).mockRejectedValueOnce(new Error("db hiccup"));

    const response = await request(app).delete("/api/v1/account");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(evictUserFromSeenCache).toHaveBeenCalled();
  });

  it("returns 404 when the user row does not exist", async () => {
    vi.mocked(storage.users.deleteUserAndPrivateCustomFoods).mockResolvedValue({
      deleted: false,
      deletedFoodIds: [],
    });

    const response = await request(app).delete("/api/v1/account");

    expect(response.status).toBe(404);
  });

  it("treats a Clerk 404 as already-deleted and continues (idempotent retry)", async () => {
    clerkDeleteUser.mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 }));

    const response = await request(app).delete("/api/v1/account");

    expect(response.status).toBe(200);
    expect(storage.users.deleteUserAndPrivateCustomFoods).toHaveBeenCalled();
  });
});
