import type { Virtualizer } from "@tanstack/react-virtual";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { TimelineContent } from "../TimelineContent";

vi.mock("@/components/timeline", () => ({
  TimelineDateGroup: () => <div data-testid="date-group" />,
  TimelineEmptyState: () => <div data-testid="timeline-welcome">Welcome to fitai.coach</div>,
  TimelineSkeleton: () => <div data-testid="timeline-skeleton" />,
}));

type Props = ComponentProps<typeof TimelineContent>;

function renderContent(overrides: Partial<Props> = {}) {
  const onRetryTimeline = vi.fn();
  const props = {
    timelineLoading: false,
    timelineError: false,
    isRetryingTimeline: false,
    onRetryTimeline,
    filterStatus: "all",
    selectedPlanId: null,
    plans: [],
    samplePlanMutation: { mutate: vi.fn(), isPending: false },
    importMutation: { isPending: false },
    handleFileUpload: vi.fn(),
    setSchedulingPlanId: vi.fn(),
    setFilterStatus: vi.fn(),
    hiddenPastCount: 0,
    setShowAllPast: vi.fn(),
    showAllPast: false,
    pastGroups: [],
    hasOlderEntries: false,
    isLoadingOlder: false,
    onLoadOlder: vi.fn(),
    hiddenFutureCount: 0,
    setShowAllFuture: vi.fn(),
    showAllFuture: false,
    futureGroups: [],
    allVisibleGroups: [],
    rowVirtualizer: { getVirtualItems: () => [], getTotalSize: () => 0 } as unknown as Virtualizer<
      HTMLDivElement,
      Element
    >,
    todayRef: { current: null },
    handleMarkComplete: vi.fn(),
    onCardClick: vi.fn(),
    handleCombine: vi.fn(),
    combiningEntry: null,
    personalRecords: undefined,
    isAutoCoaching: false,
    annotationsByDate: {},
    onAddAnnotation: vi.fn(),
    onEditAnnotation: vi.fn(),
    onDeleteAnnotation: vi.fn(),
    isAnnotationDeleting: false,
    onMoveEntry: vi.fn(),
    isMovingEntry: false,
    isBulkSelectMode: false,
    selectedBulkEntryKeys: new Set<string>(),
    onBulkSelectToggle: vi.fn(),
    onRecoverEntry: vi.fn(),
    ...overrides,
  } as unknown as Props;
  render(<TimelineContent {...props} />);
  return { onRetryTimeline };
}

describe("TimelineContent load failure (U5)", () => {
  it("shows an error with a retry instead of the first-run welcome when the fetch failed", async () => {
    const user = userEvent.setup();
    const { onRetryTimeline } = renderContent({ timelineError: true });

    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load your timeline");
    expect(screen.queryByTestId("timeline-welcome")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("timeline-load-error-retry"));
    expect(onRetryTimeline).toHaveBeenCalledOnce();
  });

  // useTimelineData keeps the error up while its retry runs (or waits for the
  // network), so the card, not a skeleton, shows the retry in flight.
  it("disables the retry while it is in flight", () => {
    renderContent({ timelineError: true, isRetryingTimeline: true });

    expect(screen.getByTestId("timeline-load-error-retry")).toBeDisabled();
    expect(screen.getByTestId("timeline-load-error-retry")).toHaveTextContent("Retrying…");
    expect(screen.queryByTestId("timeline-welcome")).not.toBeInTheDocument();
  });

  it("still shows the welcome for a timeline that loaded empty", () => {
    renderContent();

    expect(screen.getByTestId("timeline-welcome")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the skeleton, not the error, while the first load is running", () => {
    renderContent({ timelineLoading: true, timelineError: true });

    expect(screen.getByTestId("timeline-skeleton")).toBeInTheDocument();
  });
});
