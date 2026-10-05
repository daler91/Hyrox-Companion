import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { NUTRITION_TARGET_QUERY_KEYS } from "@/hooks/useNutrition";
import { QUERY_KEYS } from "@/lib/api";

// CL19 (CODEBASE_ANALYSIS_2026-10-03): a target save must refresh every read
// that carries the target. Checked against the real QUERY_KEYS and a real
// QueryClient, so a prefix that stops matching its query fails here.
describe("NUTRITION_TARGET_QUERY_KEYS", () => {
  async function invalidateAfterTargetSave(keys: readonly (readonly unknown[])[]) {
    const client = new QueryClient();
    for (const key of keys) client.setQueryData(key, {});
    await Promise.all(
      NUTRITION_TARGET_QUERY_KEYS.map((queryKey) => client.invalidateQueries({ queryKey })),
    );
    return (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated;
  }

  it("marks the Analytics -> Fuelling block stale, whatever its range", async () => {
    const block = QUERY_KEYS.nutritionBlock("2026-09-01", "2026-09-30");
    const isInvalidated = await invalidateAfterTargetSave([block]);

    expect(isInvalidated(block)).toBe(true);
  });

  it("marks the day summary and the Timeline range stale, and leaves other reads alone", async () => {
    const day = QUERY_KEYS.nutritionDay("2026-09-15");
    const range = QUERY_KEYS.nutritionRange("2026-09-01", "2026-09-30");
    const isInvalidated = await invalidateAfterTargetSave([day, range, QUERY_KEYS.nutritionRecent]);

    expect(isInvalidated(day)).toBe(true);
    expect(isInvalidated(range)).toBe(true);
    expect(isInvalidated(QUERY_KEYS.nutritionRecent)).toBe(false);
  });
});
