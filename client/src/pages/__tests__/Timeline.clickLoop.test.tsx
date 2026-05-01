import type { TimelineEntry } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { forwardRef, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Timeline from "../Timeline";

// This test reproduces the "open a workout → page constantly reloads"
// bug. The two effects that sync `openSheetEntry` ↔ `?workout=` query
// param fire in the same effect cycle. State→URL writes the URL via
// wouter's setLocation (synchronously mutates window.history); URL→state
// then reads its closed-over `openWorkoutId === null` and was calling
// closeAllSurfaces(), which fights state→URL into an infinite reopen
// loop. The fix re-reads window.location synchronously before closing.

const today = "2026-05-01";
const completedEntry = {
  id: "entry-completed",
  date: today,
  type: "completed",
  status: "completed",
  // planDayId differs from workoutLogId — this is what triggered the
  // companion regression in the openSurface early-return guard (using
  // entryId instead of surfaceId never matched, so the click was
  // dispatched repeatedly).
  planDayId: "plan-day-42",
  workoutLogId: "log-42",
  focus: "Run",
} as unknown as TimelineEntry;

let liveWorkoutId: string | null = null;
let mountCount = 0;
const setOpenWorkoutIdMock = vi.fn();

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useAuth", () => ({
  useIsAiCoachEnabled: () => true,
  useIsAuthUserLoaded: () => true,
  useIsAutoCoaching: () => false,
}));
vi.mock("@/hooks/useMoveTimelineEntry", () => ({
  useMoveTimelineEntry: () => ({ moveEntry: vi.fn(), isMoving: false }),
}));

// Mock useOpenWorkoutId so setOpenWorkoutId mutates BOTH the React
// state (returned next render) and window.location.search — this is
// what wouter does in production via history.pushState, and it's what
// our race-fix reads synchronously.
vi.mock("@/hooks/useOpenWorkoutId", () => ({
  useOpenWorkoutId: () => ({
    openWorkoutId: liveWorkoutId,
    setOpenWorkoutId: (id: string | null) => {
      setOpenWorkoutIdMock(id);
      liveWorkoutId = id;
      const params = new URLSearchParams(globalThis.window.location.search);
      if (id) params.set("workout", id);
      else params.delete("workout");
      const query = params.toString();
      globalThis.window.history.replaceState(
        null,
        "",
        query ? `${globalThis.window.location.pathname}?${query}` : globalThis.window.location.pathname,
      );
    },
  }),
}));

vi.mock("@tanstack/react-virtual", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-virtual")>("@tanstack/react-virtual");
  return {
    ...actual,
    useVirtualizer: () => ({
      getTotalSize: () => 100,
      getVirtualItems: () => [{ key: "0", index: 0, start: 0 }],
      measureElement: vi.fn(),
      scrollToIndex: vi.fn(),
    }),
  };
});

vi.mock("@/hooks/useTimelineState", () => ({
  useTimelineState: () => ({
    data: {
      plans: [],
      plansLoading: false,
      personalRecords: [],
      timelineData: [completedEntry],
      timelineLoading: false,
      annotations: [],
      isNewUser: false,
      todayRef: { current: null },
      scrollToToday: vi.fn(),
    },
    filters: {
      filterStatus: "all",
      setFilterStatus: vi.fn(),
      showAllPast: true,
      setShowAllPast: vi.fn(),
      showAllFuture: true,
      setShowAllFuture: vi.fn(),
      pastGroups: [[today, [completedEntry]]],
      futureGroups: [],
      visiblePastGroups: [[today, [completedEntry]]],
      visibleFutureGroups: [],
      hiddenPastCount: 0,
      hiddenFutureCount: 0,
    },
    onboarding: { showOnboarding: false, coachOpen: false, setCoachOpen: vi.fn(), handleOnboardingComplete: vi.fn() },
    planImport: {
      csvPreview: null, setCsvPreview: vi.fn(), schedulingPlanId: null, setSchedulingPlanId: vi.fn(),
      startDate: null, setStartDate: vi.fn(), fileInputRef: { current: null }, handleFileUpload: vi.fn(),
      confirmImport: vi.fn(), importMutation: { isPending: false }, samplePlanMutation: { isPending: false },
      renamePlanMutation: { isPending: false, mutate: vi.fn() }, schedulePlanMutation: { isPending: false, mutate: vi.fn() },
      updatePlanGoalMutation: { isPending: false, mutate: vi.fn() },
    },
    workoutActions: {
      skipConfirmEntry: null, setSkipConfirmEntry: vi.fn(),
      handleMarkComplete: vi.fn(), handleChangeStatus: vi.fn(), handleDelete: vi.fn(),
      confirmSkip: vi.fn(), logWorkoutMutation: { isPending: false },
    },
    combine: {
      combiningEntry: null, setCombiningEntry: vi.fn(), combineSecondEntry: null, setCombineSecondEntry: vi.fn(),
      showCombineDialog: false, setShowCombineDialog: vi.fn(), handleCombine: vi.fn(),
      handleConfirmCombine: vi.fn(), combineWorkoutsMutation: { isPending: false },
    },
    selectedPlanId: null,
    setSelectedPlanId: vi.fn(),
  }),
}));

vi.mock("@/components/timeline", () => ({
  TimelineDateGroup: forwardRef<HTMLDivElement, { entries: TimelineEntry[]; onClick: (entry: TimelineEntry) => void }>(
    ({ entries, onClick }, ref) => (
      <div ref={ref}>
        <button data-testid="timeline-entry" onClick={() => onClick(entries[0])}>open</button>
      </div>
    ),
  ),
  TimelineHeader: () => <div />,
  TimelineFilters: () => <div />,
  TimelineSkeleton: () => <div />,
  TimelineEmptyState: () => <div />,
  TimelineTodayIndicator: () => <div />,
  FloatingActionButton: () => <div />,
  CombineWorkoutsDialog: () => <div />,
  SkipConfirmDialog: () => <div />,
  SchedulePlanDialog: () => <div />,
  ImportPreviewDialog: () => <div />,
  CoachReviewingIndicator: () => <div />,
  AnnotationsDialog: () => <div />,
}));

vi.mock("@/components/workout-detail/LogSheet", () => ({ LogSheet: () => null }));
vi.mock("@/components/workout-detail/PreviewSheet", () => ({ PreviewSheet: () => null }));
vi.mock("@/components/workout-detail/SkippedSheet", () => ({ SkippedSheet: () => null }));
vi.mock("@/components/workout-detail/ReviewSurface", () => ({
  // Count how many times the surface mounts. In a reopen loop this grows
  // without bound; in the steady state it should mount exactly once per
  // user click.
  ReviewSurface: ({ entry, onClose }: { entry: TimelineEntry | null; onClose: () => void }) => {
    if (entry) mountCount += 1;
    return entry ? (
      <div data-testid="review-surface">
        {entry.id}
        <button data-testid="review-surface-close" type="button" onClick={onClose}>Close</button>
      </div>
    ) : null;
  },
}));
vi.mock("@/components/FeatureErrorBoundaryWrapper", () => ({ FeatureErrorBoundaryWrapper: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/CoachPanel", () => ({ CoachPanel: () => null }));
vi.mock("@/components/coach/AIConsentDialog", () => ({ AIConsentDialog: () => null }));
vi.mock("@/components/OnboardingWizard", () => ({ OnboardingWizard: () => null }));

beforeEach(() => {
  liveWorkoutId = null;
  mountCount = 0;
  setOpenWorkoutIdMock.mockReset();
  globalThis.window.history.replaceState(null, "", "/");
});

function renderTimeline() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <Timeline />
    </QueryClientProvider>,
  );
}

function openCompletedWorkout(getByTestId: (id: string) => HTMLElement) {
  act(() => {
    fireEvent.click(getByTestId("timeline-entry"));
  });
}

describe("Timeline click does not loop", () => {
  it("opens a completed workout exactly once and stays open", () => {
    const { getByTestId } = renderTimeline();
    openCompletedWorkout(getByTestId);

    // The surface should be on screen.
    expect(getByTestId("review-surface")).toBeTruthy();
    // And the URL should reflect the open sheet.
    expect(liveWorkoutId).toBe(completedEntry.planDayId);
    // Most importantly, the loop is gone — bounded mount count.
    // (Pre-fix this would be in the hundreds before React's recursion
    // bail-out tripped.)
    expect(mountCount).toBeLessThan(5);
  });

  it("closes from the exit control without route navigation side effects", async () => {
    const { getByTestId } = renderTimeline();
    openCompletedWorkout(getByTestId);

    expect(getByTestId("review-surface")).toBeTruthy();
    expect(globalThis.window.location.pathname).toBe("/");
    expect(globalThis.window.location.search).toBe("?workout=plan-day-42");

    act(() => {
      fireEvent.click(getByTestId("review-surface-close"));
    });

    await waitFor(() => {
      expect(setOpenWorkoutIdMock).toHaveBeenCalledWith(null);
    });

    expect(globalThis.window.location.pathname).toBe("/");
    expect(setOpenWorkoutIdMock).toHaveBeenCalledWith("plan-day-42");
    expect(setOpenWorkoutIdMock).toHaveBeenCalledWith(null);
    expect(mountCount).toBeLessThan(5);
  });
});
