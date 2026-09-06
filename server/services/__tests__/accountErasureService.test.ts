import type { Logger } from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { purgeUserJobs } from "../../queue";
import { storage } from "../../storage";
import {
  eraseAccount,
  runStrandedErasureSweep,
  STRANDED_ERASURE_THRESHOLD_MS,
} from "../accountErasureService";

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
}));
vi.mock("../../queue", () => ({ purgeUserJobs: vi.fn().mockResolvedValue(0) }));
vi.mock("../../strava", () => ({ deauthorizeStravaBestEffort: vi.fn() }));
vi.mock("../nutrition/foodEmbeddings", () => ({ deleteFoodEmbeddingsByFoodIds: vi.fn() }));

vi.mock("../../storage", () => ({
  storage: {
    coaching: { deleteChunksByUserId: vi.fn() },
    nutrition: { listPrivateCustomFoodIds: vi.fn() },
    users: {
      markErasureRequested: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
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

  it("leaves the marker standing when a step after the Clerk delete fails", async () => {
    users.deleteUserAndPrivateCustomFoods.mockRejectedValue(new Error("db down"));

    await expect(eraseAccount("user-1")).rejects.toThrow("db down");

    // Clerk is gone, the row is not, and nothing clears the marker — which is
    // exactly the state the sweep looks for.
    expect(clerkDeleteUser).toHaveBeenCalledWith("user-1");
    expect(users.markErasureRequested).toHaveBeenCalledWith("user-1");
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
