import type { TimelineAnnotation } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { TimelineAnnotationsBanner } from "../TimelineAnnotationsBanner";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      timelineAnnotations: {
        list: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    },
  };
});

const mockApi = api.timelineAnnotations as unknown as {
  list: ReturnType<typeof vi.fn>;
};

function renderBanner(onOpenDialog: () => void) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TimelineAnnotationsBanner onOpenDialog={onOpenDialog} />
    </QueryClientProvider>,
  );
}

describe("TimelineAnnotationsBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the empty-state hint with an Add annotation button when the list is empty", async () => {
    mockApi.list.mockResolvedValue([]);
    const onOpenDialog = vi.fn();
    renderBanner(onOpenDialog);

    // Regression guard for the Codex P1 fix: previously the banner returned
    // null, leaving no entry point to the AnnotationsDialog on a clean
    // account.
    const button = await screen.findByTestId("button-add-first-annotation");
    expect(button).toBeInTheDocument();
    expect(screen.getByTestId("banner-timeline-annotations-empty")).toHaveTextContent(
      /track injuries, illness, travel, or rest/i,
    );

    const user = userEvent.setup();
    await user.click(button);
    expect(onOpenDialog).toHaveBeenCalledTimes(1);
  });

  it("renders the populated layout with a Manage button when annotations exist", async () => {
    const annotations: TimelineAnnotation[] = [
      {
        id: "a1",
        userId: "user-1",
        startDate: "2026-03-01",
        endDate: "2026-03-07",
        type: "injury",
        note: "Calf strain",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "a2",
        userId: "user-1",
        startDate: "2026-04-10",
        endDate: "2026-04-14",
        type: "travel",
        note: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    mockApi.list.mockResolvedValue(annotations);
    const onOpenDialog = vi.fn();
    renderBanner(onOpenDialog);

    await screen.findByTestId("banner-timeline-annotations");
    expect(screen.getByTestId("banner-annotation-a1")).toHaveTextContent(/injury/i);
    expect(screen.getByTestId("banner-annotation-a2")).toHaveTextContent(/travel/i);

    const manage = screen.getByTestId("button-manage-annotations");
    const user = userEvent.setup();
    await user.click(manage);
    await waitFor(() => {
      expect(onOpenDialog).toHaveBeenCalledTimes(1);
    });
  });
});
