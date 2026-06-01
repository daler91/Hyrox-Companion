import type { InsertTimelineAnnotation, TimelineAnnotationType } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTimelineAnnotationMutations, useTimelineAnnotations } from "./useTimelineAnnotationMutations";

const mocks = vi.hoisted(() => ({
  listAnnotations: vi.fn(),
  createAnnotation: vi.fn(),
  deleteAnnotation: vi.fn(),
  toast: vi.fn(),
  handleCreateAnnotationSuccess: vi.fn(),
  handleDeleteAnnotationSuccess: vi.fn(),
  handleMutationError: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      timelineAnnotations: {
        list: mocks.listAnnotations,
        create: mocks.createAnnotation,
        delete: mocks.deleteAnnotation,
      },
    },
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("./timelineAnnotationMutations.utils", () => ({
  handleCreateAnnotationSuccess: mocks.handleCreateAnnotationSuccess,
  handleDeleteAnnotationSuccess: mocks.handleDeleteAnnotationSuccess,
  handleMutationError: mocks.handleMutationError,
}));

function renderQueryHook(open: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useTimelineAnnotations(open), { wrapper });
}

function renderMutationHook(type: TimelineAnnotationType, onCreated: () => void) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useTimelineAnnotationMutations({ type, onCreated }), { wrapper });
}

describe("useTimelineAnnotations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches annotations when open is true", async () => {
    mocks.listAnnotations.mockResolvedValueOnce([{ id: "1" }]);
    const { result } = renderQueryHook(true);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.listAnnotations).toHaveBeenCalledOnce();
    expect(result.current.data).toEqual([{ id: "1" }]);
  });

  it("does not fetch annotations when open is false", () => {
    const { result } = renderQueryHook(false);

    expect(result.current.isFetching).toBe(false);
    expect(mocks.listAnnotations).not.toHaveBeenCalled();
  });
});

describe("useTimelineAnnotationMutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createMutation", () => {
    it("calls handleCreateAnnotationSuccess on success", async () => {
      mocks.createAnnotation.mockResolvedValueOnce({ id: "1" });
      const onCreated = vi.fn();
      const { result } = renderMutationHook("injury", onCreated);

      const payload: InsertTimelineAnnotation = { type: "injury", startDate: "2023-01-01", endDate: "2023-01-01", note: "Test" };
      await act(async () => {
        await result.current.createMutation.mutateAsync(payload);
      });

      expect(mocks.createAnnotation).toHaveBeenCalledWith(payload);
      expect(mocks.handleCreateAnnotationSuccess).toHaveBeenCalledWith({
        toast: mocks.toast,
        type: "injury",
        onCreated,
      });
      expect(mocks.handleMutationError).not.toHaveBeenCalled();
    });

    it("calls handleMutationError on error", async () => {
      mocks.createAnnotation.mockRejectedValueOnce(new Error("Failed"));
      const onCreated = vi.fn();
      const { result } = renderMutationHook("injury", onCreated);

      const payload: InsertTimelineAnnotation = { type: "injury", startDate: "2023-01-01", endDate: "2023-01-01", note: "Test" };
      await act(async () => {
        await expect(result.current.createMutation.mutateAsync(payload)).rejects.toThrow("Failed");
      });

      expect(mocks.createAnnotation).toHaveBeenCalledWith(payload);
      expect(mocks.handleCreateAnnotationSuccess).not.toHaveBeenCalled();
      expect(mocks.handleMutationError).toHaveBeenCalledWith(mocks.toast, "Couldn't add annotation");
    });
  });

  describe("deleteMutation", () => {
    it("calls handleDeleteAnnotationSuccess on success", async () => {
      mocks.deleteAnnotation.mockResolvedValueOnce(undefined);
      const onCreated = vi.fn();
      const { result } = renderMutationHook("injury", onCreated);

      await act(async () => {
        await result.current.deleteMutation.mutateAsync("1");
      });

      expect(mocks.deleteAnnotation).toHaveBeenCalledWith("1");
      expect(mocks.handleDeleteAnnotationSuccess).toHaveBeenCalledWith(mocks.toast);
      expect(mocks.handleMutationError).not.toHaveBeenCalled();
    });

    it("calls handleMutationError on error", async () => {
      mocks.deleteAnnotation.mockRejectedValueOnce(new Error("Failed"));
      const onCreated = vi.fn();
      const { result } = renderMutationHook("injury", onCreated);

      await act(async () => {
        await expect(result.current.deleteMutation.mutateAsync("1")).rejects.toThrow("Failed");
      });

      expect(mocks.deleteAnnotation).toHaveBeenCalledWith("1");
      expect(mocks.handleDeleteAnnotationSuccess).not.toHaveBeenCalled();
      expect(mocks.handleMutationError).toHaveBeenCalledWith(mocks.toast, "Couldn't delete annotation");
    });
  });
});
