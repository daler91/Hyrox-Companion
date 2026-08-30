import { vi } from "vitest";

/**
 * Factory body for `vi.mock("@/lib/queryClient", ...)` — an apiRequest spy plus
 * an invalidate-only queryClient. Lives in its own module (nothing here imports
 * "@/lib/queryClient") so the mock factory can await-import it without cycling
 * back into the module being mocked.
 */
export function makeQueryClientLibMock() {
  return {
    apiRequest: vi.fn(),
    queryClient: {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    },
  };
}
