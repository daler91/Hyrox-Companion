import type { TimelineAnnotation } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { AnnotationsDialog } from "../AnnotationsDialog";

// Mock the api module. The dialog calls list() on mount and create()
// / delete() on user interactions.
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
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function renderDialog(props: { open?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AnnotationsDialog open={props.open ?? true} onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("AnnotationsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the empty state when there are no annotations", async () => {
    mockApi.list.mockResolvedValue([]);
    renderDialog();
    expect(await screen.findByTestId("annotations-empty")).toHaveTextContent(/no annotations yet/i);
  });

  it("lists existing annotations", async () => {
    const annotations: TimelineAnnotation[] = [
      {
        id: "a1",
        userId: "user-1",
        startDate: "2026-03-01",
        endDate: "2026-03-07",
        type: "injury",
        note: "Calf strain during sled push",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    mockApi.list.mockResolvedValue(annotations);
    renderDialog();

    const item = await screen.findByTestId("annotation-item-a1");
    expect(item).toHaveTextContent(/injury/i);
    expect(item).toHaveTextContent("2026-03-01 — 2026-03-07");
    expect(item).toHaveTextContent("Calf strain during sled push");
  });

  it("calls create() when the user submits the form", async () => {
    mockApi.list.mockResolvedValue([]);
    mockApi.create.mockResolvedValue({
      id: "new",
      userId: "user-1",
      startDate: "2026-05-01",
      endDate: "2026-05-03",
      type: "injury",
      note: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies TimelineAnnotation);

    renderDialog();
    await screen.findByTestId("annotations-empty");

    const user = userEvent.setup();
    // Type text in the start/end inputs. They're native <input type="date">
    // which react-testing-library doesn't support natively for typing;
    // use fireEvent-style direct input change instead.
    const startInput = screen.getByTestId("input-annotation-start");
    const endInput = screen.getByTestId("input-annotation-end");
    // The dialog initializes both dates to today — override them for the test.
    await user.clear(startInput);
    await user.type(startInput, "2026-05-01");
    await user.clear(endInput);
    await user.type(endInput, "2026-05-03");

    await user.click(screen.getByTestId("button-create-annotation"));

    await waitFor(() => {
      expect(mockApi.create).toHaveBeenCalled();
    });
    const arg = mockApi.create.mock.calls[0][0] as { type: string; startDate: string; endDate: string };
    expect(arg).toMatchObject({
      type: "injury",
      startDate: "2026-05-01",
      endDate: "2026-05-03",
    });
  });

  it("shows a live character counter for the note field", async () => {
    mockApi.list.mockResolvedValue([]);
    renderDialog();
    await screen.findByTestId("annotations-empty");

    const counter = screen.getByTestId("text-annotation-note-counter");
    expect(counter).toHaveTextContent("0/500");
    expect(counter).toHaveAttribute("aria-live", "polite");

    const user = userEvent.setup();
    await user.type(screen.getByTestId("input-annotation-note"), "hello");
    expect(counter).toHaveTextContent("5/500");
  });

  it("calls delete() when the user clicks a trash button", async () => {
    const annotations: TimelineAnnotation[] = [
      {
        id: "a1",
        userId: "user-1",
        startDate: "2026-03-01",
        endDate: "2026-03-07",
        type: "injury",
        note: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    mockApi.list.mockResolvedValue(annotations);
    mockApi.delete.mockResolvedValue({ success: true });

    renderDialog();
    await screen.findByTestId("annotation-item-a1");

    const user = userEvent.setup();
    await user.click(screen.getByTestId("button-delete-annotation-a1"));

    await waitFor(() => {
      expect(mockApi.delete).toHaveBeenCalledWith("a1");
    });
  });
});
