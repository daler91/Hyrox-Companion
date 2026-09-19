import { vi } from "vitest";

/**
 * Module factory for `vi.mock("@/lib/api", …)` in the recycle-bin specs. The
 * hooks reach for every query key a restore invalidates, so the mock has to
 * carry them all; sharing the shape keeps the three specs from drifting (and
 * from tripping the duplication gate). Use as
 * `vi.mock("@/lib/api", async () => (await import("@/test/support/recycleBinApiMock")).mockRecycleBinApiModule())`.
 */
export function mockRecycleBinApiModule() {
  return {
    api: {
      recycleBin: {
        list: vi.fn(),
        restore: vi.fn(),
        restoreBatch: vi.fn(),
        purge: vi.fn(),
        empty: vi.fn(),
      },
    },
    QUERY_KEYS: {
      recycleBin: ["/api/v1/recycle-bin"],
      timeline: ["/api/v1/timeline"],
      workouts: ["/api/v1/workouts"],
      plans: ["/api/v1/plans"],
      personalRecords: ["/api/v1/personal-records"],
      exerciseAnalytics: ["/api/v1/exercise-analytics"],
      trainingOverview: ["/api/v1/training-overview"],
    },
  };
}
