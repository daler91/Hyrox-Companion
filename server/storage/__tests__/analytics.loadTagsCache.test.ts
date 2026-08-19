import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock, selectMock } = vi.hoisted(() => {
  const fromMock = vi.fn();
  const selectMock = vi.fn().mockReturnValue({ from: fromMock });
  return { fromMock, selectMock };
});

vi.mock("../../db", () => ({
  db: { select: selectMock },
}));

import { AnalyticsStorage } from "../analytics";

// ⚡ Bolt: getExerciseLoadTags caches its result (see analytics.ts for why —
// exercise_load_tags is static reference data with no runtime write path).
// These tests guard the caching contract: one query for many callers, and no
// permanently-poisoned cache after a transient DB failure.
describe("AnalyticsStorage.getExerciseLoadTags caching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectMock.mockReturnValue({ from: fromMock });
  });

  it("only queries the DB once across repeated and concurrent calls", async () => {
    const rows = [{ exerciseName: "burpee" }];
    fromMock.mockResolvedValue(rows);
    const storage = new AnalyticsStorage();

    const [a, b] = await Promise.all([storage.getExerciseLoadTags(), storage.getExerciseLoadTags()]);
    const c = await storage.getExerciseLoadTags();

    expect(a).toBe(rows);
    expect(b).toBe(rows);
    expect(c).toBe(rows);
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("does not pin a failed fetch — a later call retries the DB", async () => {
    fromMock.mockRejectedValueOnce(new Error("connection reset"));
    const rows = [{ exerciseName: "burpee" }];
    fromMock.mockResolvedValueOnce(rows);
    const storage = new AnalyticsStorage();

    await expect(storage.getExerciseLoadTags()).rejects.toThrow("connection reset");
    await expect(storage.getExerciseLoadTags()).resolves.toBe(rows);
    expect(selectMock).toHaveBeenCalledTimes(2);
  });

  it("does not share the cache across separate instances", async () => {
    fromMock.mockResolvedValue([{ exerciseName: "burpee" }]);
    const first = new AnalyticsStorage();
    const second = new AnalyticsStorage();

    await first.getExerciseLoadTags();
    await second.getExerciseLoadTags();

    expect(selectMock).toHaveBeenCalledTimes(2);
  });
});
