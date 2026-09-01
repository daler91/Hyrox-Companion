import { describe, expect, it, vi } from "vitest";

import { retryOnceOnUniqueViolation } from "./nutrition";

/**
 * Pins the concurrency contract behind createTarget/upsertMealTarget: their
 * delete-then-insert only keeps "one version per key" for serialized writers,
 * so uq_nutrition_targets_user_effective / uq_meal_targets_user_meal_effective
 * (migration 0091) fail the loser of a concurrent save with 23505, and this
 * helper retries that loser exactly once — the retry's delete sees the winner's
 * committed row, so last writer wins. Anything else must propagate untouched.
 */

function uniqueViolation(constraint: string): Error {
  return Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint,
  });
}

describe("retryOnceOnUniqueViolation", () => {
  it("returns the first attempt's result when there is no conflict", async () => {
    const write = vi.fn().mockResolvedValue("row");

    await expect(retryOnceOnUniqueViolation("uq_nutrition_targets_user_effective", write)).resolves.toBe("row");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once when the named index rejects the write (concurrent-save loser)", async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(uniqueViolation("uq_nutrition_targets_user_effective"))
      .mockResolvedValueOnce("winner-replaced");

    await expect(retryOnceOnUniqueViolation("uq_nutrition_targets_user_effective", write)).resolves.toBe(
      "winner-replaced",
    );
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("finds the violation through a drizzle-style cause chain", async () => {
    const wrapped = new Error("Failed query: insert into nutrition_targets ...");
    (wrapped as Error & { cause?: unknown }).cause = uniqueViolation("uq_meal_targets_user_meal_effective");
    const write = vi.fn().mockRejectedValueOnce(wrapped).mockResolvedValueOnce("ok");

    await expect(retryOnceOnUniqueViolation("uq_meal_targets_user_meal_effective", write)).resolves.toBe("ok");
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("does not retry an unrelated error", async () => {
    const boom = new Error("connection reset");
    const write = vi.fn().mockRejectedValue(boom);

    await expect(retryOnceOnUniqueViolation("uq_nutrition_targets_user_effective", write)).rejects.toBe(boom);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("does not retry a violation of a DIFFERENT unique index", async () => {
    const other = uniqueViolation("uq_foods_source_source_id");
    const write = vi.fn().mockRejectedValue(other);

    await expect(retryOnceOnUniqueViolation("uq_nutrition_targets_user_effective", write)).rejects.toBe(other);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("gives up after the second conflict instead of looping", async () => {
    const violation = uniqueViolation("uq_nutrition_targets_user_effective");
    const write = vi.fn().mockRejectedValue(violation);

    await expect(retryOnceOnUniqueViolation("uq_nutrition_targets_user_effective", write)).rejects.toBe(violation);
    expect(write).toHaveBeenCalledTimes(2);
  });
});
