import type { Logger } from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { rememberUserErased } from "../../clerkAuth";
import { purgeUserJobs } from "../../queue";
import { storage } from "../../storage";
import {
  eraseAccount,
  runStrandedErasureSweep,
  STRANDED_ERASURE_THRESHOLD_MS,
} from "../accountErasureService";
import { purgeRagCacheForUser } from "../ragService";

// ---------------------------------------------------------------------------
// Account erasure deletes the Clerk identity partway through. Past that point
// the athlete cannot authenticate, so they can never ask again — a run that
// dies afterwards strands their data with nobody able to complete it. These
// tests guard the marker that makes such a run findable and the sweep that
// finishes it.
// ---------------------------------------------------------------------------

const { clerkDeleteUser } = vi.hoisted(() => ({ clerkDeleteUser: vi.fn() }));
vi.mock("@clerk/express", () => ({
  clerkClient: { users: { deleteUser: clerkDeleteUser } },
}));

vi.mock("../../clerkAuth", () => ({
  evictUserFromSeenCache: vi.fn().mockResolvedValue(undefined),
  rememberUserErased: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../queue", () => ({ purgeUserJobs: vi.fn().mockResolvedValue(0) }));
vi.mock("../../strava", () => ({ deauthorizeStravaBestEffort: vi.fn() }));
vi.mock("../nutrition/foodEmbeddings", () => ({ deleteFoodEmbeddingsByFoodIds: vi.fn() }));
vi.mock("../ragService", () => ({ purgeRagCacheForUser: vi.fn() }));

vi.mock("../../storage", () => ({
  storage: {
    coaching: { deleteChunksByUserId: vi.fn() },
    nutrition: { listPrivateCustomFoodIds: vi.fn() },
    users: {
      markErasureRequested: vi.fn(),
      clearErasureRequest: vi.fn(),
      listStrandedErasures: vi.fn(),
      deleteUserAndPrivateCustomFoods: vi.fn(),
      getStravaConnection: vi.fn(),
      getGarminConnection: vi.fn(),
      purgeRateLimitBucketsForUser: vi.fn(),
    },
  },
}));

const users = vi.mocked(storage.users);
const nutrition = vi.mocked(storage.nutrition);

function callOrder(mock: { mock: { invocationCallOrder: number[] } }): number {
  const order = mock.mock.invocationCallOrder[0];
  expect(order).toBeDefined();
  return order;
}

/** The stamp a first erasure attempt writes (markErasureRequested's return). */
const STAMPED_AT = new Date("2026-09-06T11:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  users.markErasureRequested.mockResolvedValue(STAMPED_AT);
  nutrition.listPrivateCustomFoodIds.mockResolvedValue([]);
  users.deleteUserAndPrivateCustomFoods.mockResolvedValue({ deleted: true, deletedFoodIds: [] });
  users.getStravaConnection.mockResolvedValue(undefined);
  users.getGarminConnection.mockResolvedValue(undefined);
  users.listStrandedErasures.mockResolvedValue([]);
  clerkDeleteUser.mockResolvedValue(undefined);
});

describe("eraseAccount", () => {
  it("stamps the erasure marker before the Clerk identity is deleted", async () => {
    await eraseAccount("user-1");

    // The stamp is what makes a run that dies later recoverable, so it has to
    // be committed before the step that makes retrying impossible.
    expect(users.markErasureRequested).toHaveBeenCalledWith("user-1");
    expect(callOrder(users.markErasureRequested)).toBeLessThan(callOrder(clerkDeleteUser));
  });

  // P5 (CODEBASE_ANALYSIS_2026-10-03): a Clerk session minted before the
  // identity was deleted still authenticates until it expires. The tombstone
  // has to exist before the row goes, or that request re-provisions it.
  it("tombstones the id in the auth layer before the user row is deleted", async () => {
    await eraseAccount("user-1");

    expect(rememberUserErased).toHaveBeenCalledWith("user-1");
    expect(callOrder(clerkDeleteUser)).toBeLessThan(callOrder(vi.mocked(rememberUserErased)));
    expect(callOrder(vi.mocked(rememberUserErased))).toBeLessThan(
      callOrder(users.deleteUserAndPrivateCustomFoods),
    );
  });

  // P13 (CODEBASE_ANALYSIS_2026-10-03): cached retrievals hold plaintext
  // excerpts of the athlete's coaching materials outside the FK cascade.
  it("purges the user's RAG retrieval cache after their chunks, before the Clerk delete", async () => {
    await eraseAccount("user-1");

    expect(purgeRagCacheForUser).toHaveBeenCalledWith("user-1");
    expect(callOrder(vi.mocked(storage.coaching.deleteChunksByUserId))).toBeLessThan(
      callOrder(vi.mocked(purgeRagCacheForUser)),
    );
    expect(callOrder(vi.mocked(purgeRagCacheForUser))).toBeLessThan(callOrder(clerkDeleteUser));
  });

  it("keeps the user row when the tombstone cannot be written", async () => {
    vi.mocked(rememberUserErased).mockRejectedValueOnce(new Error("db down"));

    await expect(eraseAccount("user-1")).rejects.toThrow("db down");

    // Still retriable: the row and its erasure marker stay for the sweep.
    expect(users.deleteUserAndPrivateCustomFoods).not.toHaveBeenCalled();
  });

  it("leaves the marker standing when a step after the Clerk delete fails", async () => {
    users.deleteUserAndPrivateCustomFoods.mockRejectedValue(new Error("db down"));

    await expect(eraseAccount("user-1")).rejects.toThrow("db down");

    // Clerk is gone, the row is not, and nothing clears the marker — which is
    // exactly the state the sweep looks for.
    expect(clerkDeleteUser).toHaveBeenCalledWith("user-1");
    expect(users.markErasureRequested).toHaveBeenCalledWith("user-1");
    expect(users.clearErasureRequest).not.toHaveBeenCalled();
  });

  // P17 (CODEBASE_ANALYSIS_2026-10-03): the athlete is told "Deletion failed"
  // and can still sign in, so the sweep must not finish the deletion later.
  it("withdraws the stamp it wrote when a step before the Clerk delete fails", async () => {
    vi.mocked(storage.coaching.deleteChunksByUserId).mockRejectedValueOnce(
      new Error("vector db down"),
    );

    await expect(eraseAccount("user-1")).rejects.toThrow("vector db down");

    expect(clerkDeleteUser).not.toHaveBeenCalled();
    expect(users.clearErasureRequest).toHaveBeenCalledWith("user-1", STAMPED_AT);
  });

  it.each([401, 422, 429])(
    "withdraws the stamp when Clerk declines the delete with a %i",
    async (status) => {
      clerkDeleteUser.mockRejectedValueOnce(Object.assign(new Error("clerk declined"), { status }));

      await expect(eraseAccount("user-1")).rejects.toThrow("clerk declined");

      expect(users.clearErasureRequest).toHaveBeenCalledWith("user-1", STAMPED_AT);
      expect(rememberUserErased).not.toHaveBeenCalled();
    },
  );

  it.each([
    { outcome: "a 5xx", error: Object.assign(new Error("clerk unavailable"), { status: 503 }) },
    { outcome: "no answer", error: new Error("socket hang up") },
  ])("keeps the stamp when the Clerk delete's outcome is unknown ($outcome)", async ({ error }) => {
    clerkDeleteUser.mockRejectedValueOnce(error);

    await expect(eraseAccount("user-1")).rejects.toThrow(error.message);

    // The identity may already be gone, so the sweep has to be able to finish.
    expect(users.clearErasureRequest).not.toHaveBeenCalled();
  });

  it("leaves a stamp an earlier run wrote, since that run may have got past the Clerk step", async () => {
    users.markErasureRequested.mockResolvedValueOnce(null);
    vi.mocked(purgeRagCacheForUser).mockRejectedValueOnce(new Error("db down"));

    await expect(eraseAccount("user-1")).rejects.toThrow("db down");

    expect(users.clearErasureRequest).not.toHaveBeenCalled();
  });

  it("still reports the original failure when the stamp cannot be withdrawn", async () => {
    vi.mocked(storage.coaching.deleteChunksByUserId).mockRejectedValueOnce(
      new Error("vector db down"),
    );
    users.clearErasureRequest.mockRejectedValueOnce(new Error("main db down"));
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

    await expect(eraseAccount("user-1", log)).rejects.toThrow("vector db down");

    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      expect.stringContaining("the sweep will finish it"),
    );
  });

  it("reports a failed job purge at error, since nothing will retry it", async () => {
    // Step 7 runs after the erasure marker was deleted with the user row, so
    // the sweep cannot pick this up — the rows hold the athlete's id and job
    // inputs, and a warn would let that sit unnoticed behind a 200.
    vi.mocked(purgeUserJobs).mockRejectedValue(new Error("queue unreachable"));
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

    await expect(eraseAccount("user-1", log)).resolves.toEqual({ deleted: true });

    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      expect.stringContaining("personal data may remain"),
    );
  });

  it("reports a missing user row rather than throwing", async () => {
    users.deleteUserAndPrivateCustomFoods.mockResolvedValue({ deleted: false, deletedFoodIds: [] });

    await expect(eraseAccount("ghost")).resolves.toEqual({ deleted: false });
  });
});

describe("runStrandedErasureSweep", () => {
  const NOW = new Date("2026-09-06T12:00:00Z");

  function stranded(id: string, minutesAgo: number) {
    return { id, erasureRequestedAt: new Date(NOW.getTime() - minutesAgo * 60_000) };
  }

  it("only considers erasures older than the in-flight threshold", async () => {
    await runStrandedErasureSweep(NOW);

    // A request still working through the steps must not be swept out from
    // under itself.
    const [cutoff] = users.listStrandedErasures.mock.calls[0];
    expect(cutoff).toEqual(new Date(NOW.getTime() - STRANDED_ERASURE_THRESHOLD_MS));
  });

  it("finishes an erasure whose Clerk identity is already gone", async () => {
    users.listStrandedErasures.mockResolvedValue([stranded("user-1", 30)]);
    // The earlier run got as far as deleting the identity.
    clerkDeleteUser.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));

    await expect(runStrandedErasureSweep(NOW)).resolves.toEqual({ swept: 1, failed: 0 });
    expect(users.deleteUserAndPrivateCustomFoods).toHaveBeenCalledWith("user-1");
  });

  it("never withdraws a stranded erasure's marker when its retry fails early", async () => {
    users.listStrandedErasures.mockResolvedValue([stranded("user-1", 30)]);
    // The account already carries its stamp, so this run wrote none.
    users.markErasureRequested.mockResolvedValue(null);
    vi.mocked(storage.coaching.deleteChunksByUserId).mockRejectedValueOnce(
      new Error("vector db down"),
    );

    await expect(runStrandedErasureSweep(NOW)).resolves.toEqual({ swept: 0, failed: 1 });
    expect(users.clearErasureRequest).not.toHaveBeenCalled();
  });

  it("keeps erasing the rest when one account fails again, and counts it", async () => {
    users.listStrandedErasures.mockResolvedValue([stranded("user-1", 30), stranded("user-2", 20)]);
    users.deleteUserAndPrivateCustomFoods
      .mockRejectedValueOnce(new Error("still down"))
      .mockResolvedValue({ deleted: true, deletedFoodIds: [] });

    // One account that keeps failing must not hold every other erasure hostage.
    await expect(runStrandedErasureSweep(NOW)).resolves.toEqual({ swept: 1, failed: 1 });
    expect(users.deleteUserAndPrivateCustomFoods).toHaveBeenCalledWith("user-2");
  });
});
