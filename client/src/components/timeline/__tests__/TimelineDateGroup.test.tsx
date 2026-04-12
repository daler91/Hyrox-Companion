import type { TimelineAnnotation, TimelineEntry } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { format } from "date-fns";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TimelineDateGroup from "../TimelineDateGroup";

// Minimal TimelineEntry for the workout card — the child card pulls unit
// preferences from react-query, so we seed the cache in the render helper.
function makeEntry(overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: "entry-1",
    date: "2030-01-15",
    type: "planned",
    status: "planned",
    focus: "Upper Body Strength",
    mainWorkout: "4x8 bench press",
    accessory: null,
    notes: null,
    ...overrides,
  } as unknown as TimelineEntry;
}

function makeAnnotation(overrides: Partial<TimelineAnnotation> = {}): TimelineAnnotation {
  return {
    id: "a1",
    userId: "user-1",
    startDate: "2030-01-15",
    endDate: "2030-01-20",
    type: "injury",
    note: "Calf strain",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as TimelineAnnotation;
}

function renderGroup(
  props: Partial<Parameters<typeof TimelineDateGroup>[0]>,
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async () => ({ weightUnit: "kg", distanceUnit: "km" }),
      },
    },
  });
  queryClient.setQueryData(["/api/v1/preferences"], { weightUnit: "kg", distanceUnit: "km" });

  return render(
    <QueryClientProvider client={queryClient}>
      <TimelineDateGroup
        date="2030-01-15"
        entries={[]}
        onMarkComplete={vi.fn()}
        onClick={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("TimelineDateGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders annotation cards above workout cards on the same day", () => {
    renderGroup({
      entries: [makeEntry({ id: "entry-1" })],
      annotations: [makeAnnotation({ id: "a1" })],
      onAddAnnotation: vi.fn(),
      onEditAnnotation: vi.fn(),
      onDeleteAnnotation: vi.fn(),
    });

    expect(screen.getByTestId("annotation-card-a1")).toBeInTheDocument();
  });

  it("renders an annotation-only day without any workout cards", () => {
    renderGroup({
      entries: [],
      annotations: [makeAnnotation({ id: "a1" })],
      onAddAnnotation: vi.fn(),
      onEditAnnotation: vi.fn(),
      onDeleteAnnotation: vi.fn(),
    });

    expect(screen.getByTestId("annotation-card-a1")).toBeInTheDocument();
  });

  it("returns null when the day has neither entries nor annotations", () => {
    const { container } = renderGroup({
      entries: [],
      annotations: [],
      onAddAnnotation: vi.fn(),
    });
    expect(container.firstChild).toBeNull();
  });

  it("shows the + Note chip with hover-reveal classes on non-today rows", () => {
    const onAddAnnotation = vi.fn();
    renderGroup({
      date: "2030-01-15",
      entries: [makeEntry()],
      onAddAnnotation,
    });

    const chip = screen.getByTestId("button-add-annotation-2030-01-15");
    // Non-today rows hide the chip on desktop until the row is hovered.
    expect(chip.className).toContain("md:opacity-0");
    expect(chip.className).toContain("md:group-hover/date:opacity-100");
  });

  it("shows the + Note chip unconditionally on the today row", () => {
    const todayStr = format(new Date(), "yyyy-MM-dd");
    renderGroup({
      date: todayStr,
      entries: [makeEntry({ date: todayStr })],
      onAddAnnotation: vi.fn(),
    });

    const chip = screen.getByTestId(`button-add-annotation-${todayStr}`);
    // Today row never hides the chip behind a hover state.
    expect(chip.className).not.toContain("md:opacity-0");
  });

  it("invokes onAddAnnotation with the row date when the + Note chip is clicked", async () => {
    const onAddAnnotation = vi.fn();
    renderGroup({
      date: "2030-01-15",
      entries: [makeEntry()],
      onAddAnnotation,
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("button-add-annotation-2030-01-15"));
    expect(onAddAnnotation).toHaveBeenCalledWith("2030-01-15");
  });
});
