import type { TimelineEntry } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { forwardRef, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Timeline from "../Timeline";

const setOpenWorkoutId = vi.fn();

const today = "2026-05-01";
const missedEntry = {
  id: "entry-missed",
  date: today,
  type: "planned",
  status: "missed",
  planDayId: "plan-day-1",
  workoutLogId: null,
  focus: "Run",
} as unknown as TimelineEntry;

let openWorkoutIdState: string | null = null;

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useAuth", () => ({
  useIsAiCoachEnabled: () => true,
  useIsAuthUserLoaded: () => true,
  useIsAutoCoaching: () => false,
}));
vi.mock("@/hooks/useMoveTimelineEntry", () => ({ useMoveTimelineEntry: () => ({ handleMoveEntry: vi.fn(), isMovingEntry: false }) }));
vi.mock("@/hooks/useOpenWorkoutId", () => ({
  useOpenWorkoutId: () => ({ openWorkoutId: openWorkoutIdState, setOpenWorkoutId }),
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
      timelineData: [missedEntry],
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
      pastGroups: [[today, [missedEntry]]],
      futureGroups: [],
      visiblePastGroups: [[today, [missedEntry]]],
      visibleFutureGroups: [],
      hiddenPastCount: 0,
      hiddenFutureCount: 0,
    },
    onboarding: { showOnboarding: false, coachOpen: false, setCoachOpen: vi.fn(), handleOnboardingComplete: vi.fn() },
    planImport: {
      csvPreview: null,
      setCsvPreview: vi.fn(),
      schedulingPlanId: null,
      setSchedulingPlanId: vi.fn(),
      startDate: null,
      setStartDate: vi.fn(),
      fileInputRef: { current: null },
      handleFileUpload: vi.fn(),
      confirmImport: vi.fn(),
      importMutation: { isPending: false },
      samplePlanMutation: { isPending: false },
      renamePlanMutation: { isPending: false },
      schedulePlanMutation: { isPending: false },
      updatePlanGoalMutation: { isPending: false },
    },
    workoutActions: {
      skipConfirmEntry: null,
      setSkipConfirmEntry: vi.fn(),
      handleMarkComplete: vi.fn(),
      handleChangeStatus: vi.fn(),
      handleDelete: vi.fn(),
      confirmSkip: vi.fn(),
      logWorkoutMutation: { isPending: false },
    },
    combine: {
      combiningEntry: null,
      setCombiningEntry: vi.fn(),
      combineSecondEntry: null,
      setCombineSecondEntry: vi.fn(),
      showCombineDialog: false,
      setShowCombineDialog: vi.fn(),
      handleCombine: vi.fn(),
      handleConfirmCombine: vi.fn(),
      combineWorkoutsMutation: { isPending: false },
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

vi.mock("@/components/workout-detail/LogSheet", () => ({
  LogSheet: ({ entry }: { entry: TimelineEntry | null }) =>
    entry ? <div data-testid="log-sheet">{entry.status}</div> : null,
}));
vi.mock("@/components/workout-detail/PreviewSheet", () => ({ PreviewSheet: () => null }));
vi.mock("@/components/workout-detail/ReviewSurface", () => ({ ReviewSurface: () => null }));
vi.mock("@/components/workout-detail/SkippedSheet", () => ({ SkippedSheet: () => null }));
vi.mock("@/components/FeatureErrorBoundaryWrapper", () => ({ FeatureErrorBoundaryWrapper: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/CoachPanel", () => ({ CoachPanel: () => null }));
vi.mock("@/components/coach/AIConsentDialog", () => ({ AIConsentDialog: () => null }));
vi.mock("@/components/OnboardingWizard", () => ({ OnboardingWizard: () => null }));

beforeEach(() => {
  openWorkoutIdState = null;
  setOpenWorkoutId.mockClear();
});

function renderTimeline() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <Timeline />
    </QueryClientProvider>,
  );
}

describe("Timeline missed click routing", () => {
  it("routes deep-linked missed entry id to LogSheet", () => {
    openWorkoutIdState = missedEntry.planDayId ?? null;

    renderTimeline();

    expect(screen.getByTestId("log-sheet")).toHaveTextContent("missed");
  });
});
