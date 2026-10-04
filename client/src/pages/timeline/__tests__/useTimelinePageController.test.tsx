import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

import { useTimelinePageController } from "../useTimelinePageController";

const mocks = vi.hoisted(() => ({
  deleteAnnotation: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      timelineAnnotations: { ...actual.api.timelineAnnotations, delete: mocks.deleteAnnotation },
    },
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/hooks/useMoveTimelineEntry", () => ({
  useMoveTimelineEntry: () => ({ moveEntry: vi.fn(), isMoving: false }),
}));

function renderController() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useTimelinePageController(null, []), { wrapper });
}

describe("useTimelinePageController annotation delete", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The card's own delete button goes through this mutation, not the
  // annotations dialog's, so it needs the same timeline refresh
  // (CL10, CODEBASE_ANALYSIS_2026-10-03).
  it("refreshes the timeline after deleting an annotation from its card", async () => {
    mocks.deleteAnnotation.mockResolvedValueOnce(undefined);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
    const { result } = renderController();

    act(() => {
      result.current.handleDeleteAnnotation("ann-1");
    });

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith({ title: "Annotation removed" });
    });
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toContainEqual(QUERY_KEYS.timeline);
    expect(keys).toContainEqual(QUERY_KEYS.timelineAnnotations);
  });
});
