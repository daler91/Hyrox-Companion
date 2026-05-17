import type { TimelineEntry } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { forwardRef, type ReactNode } from "react";
import { vi } from "vitest";

import Timeline from "../Timeline";

type TimelineStatePayload = ReturnType<typeof buildTimelineStatePayload>;

type HarnessState = {
  timelineState: TimelineStatePayload;
  openWorkoutId: string | null;
  setOpenWorkoutIdImpl: (id: string | null) => void;
  reviewSurfaceImpl: (props: { entry: TimelineEntry | null; onClose: () => void }) => ReactNode;
  logSheetImpl: (props: { entry: TimelineEntry | null }) => ReactNode;
  moveTimelineEntryResult: { handleMoveEntry?: () => void; moveEntry?: () => void; isMovingEntry?: boolean; isMoving?: boolean };
};

const harnessState: HarnessState = {
  timelineState: buildTimelineStatePayload(),
  openWorkoutId: null,
  setOpenWorkoutIdImpl: () => undefined,
  reviewSurfaceImpl: () => null,
  logSheetImpl: () => null,
  moveTimelineEntryResult: { handleMoveEntry: vi.fn(), moveEntry: vi.fn(), isMovingEntry: false, isMoving: false },
};

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useAuth", () => ({
  useIsAiCoachEnabled: () => true,
  useIsAuthUserLoaded: () => true,
  useIsAutoCoaching: () => false,
  useIsOnboardingCompleted: () => false,
}));
vi.mock("@/hooks/useMoveTimelineEntry", () => ({ useMoveTimelineEntry: () => harnessState.moveTimelineEntryResult }));
vi.mock("@/hooks/useOpenWorkoutId", () => ({
  useOpenWorkoutId: () => ({
    openWorkoutId: harnessState.openWorkoutId,
    setOpenWorkoutId: harnessState.setOpenWorkoutIdImpl,
  }),
}));
vi.mock("@tanstack/react-virtual", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-virtual")>("@tanstack/react-virtual");
  return {
    ...actual,
    useVirtualizer: () => ({
      getTotalSize: () => 100,
      getVirtualItems: () => [{ key: "0", index: 0, start: 0, end: 100, size: 100 }],
      measureElement: vi.fn(),
      scrollToIndex: vi.fn(),
    }),
  };
});
vi.mock("@/hooks/useTimelineState", () => ({ useTimelineState: () => harnessState.timelineState }));
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
  BulkDeleteControls: () => <div />,
}));
vi.mock("@/components/workout-detail/LogSheet", () => ({ LogSheet: (props: { entry: TimelineEntry | null }) => harnessState.logSheetImpl(props) }));
vi.mock("@/components/workout-detail/PreviewSheet", () => ({ PreviewSheet: () => null }));
vi.mock("@/components/workout-detail/SkippedSheet", () => ({ SkippedSheet: () => null }));
vi.mock("@/components/workout-detail/ReviewSurface", () => ({ ReviewSurface: (props: { entry: TimelineEntry | null; onClose: () => void }) => harnessState.reviewSurfaceImpl(props) }));
vi.mock("@/components/FeatureErrorBoundaryWrapper", () => ({ FeatureErrorBoundaryWrapper: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/CoachPanel", () => ({ CoachPanel: () => null }));
vi.mock("@/components/coach/AIConsentDialog", () => ({ AIConsentDialog: () => null }));
vi.mock("@/components/OnboardingWizard", () => ({ OnboardingWizard: () => null }));

export function buildTimelineEntry(overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: "entry-1",
    date: "2026-05-01",
    type: "planned",
    status: "planned",
    planDayId: "plan-day-1",
    workoutLogId: null,
    focus: "Run",
    ...overrides,
  } as unknown as TimelineEntry;
}

export function buildTimelineStatePayload(entries: TimelineEntry[] = [buildTimelineEntry()]) {
  const today = entries[0]?.date ?? "2026-05-01";
  return {
    data: {
      plans: [], plansLoading: false, personalRecords: [], timelineData: entries, timelineLoading: false,
      annotations: [], isNewUser: false, todayRef: { current: null }, scrollToToday: vi.fn(),
    },
    filters: {
      filterStatus: "all", setFilterStatus: vi.fn(), showAllPast: true, setShowAllPast: vi.fn(),
      showAllFuture: true, setShowAllFuture: vi.fn(), pastGroups: [[today, entries]], futureGroups: [],
      visiblePastGroups: [[today, entries]], visibleFutureGroups: [], hiddenPastCount: 0, hiddenFutureCount: 0,
    },
    onboarding: { showOnboarding: false, coachOpen: false, setCoachOpen: vi.fn(), handleOnboardingComplete: vi.fn() },
    planImport: {
      csvPreview: null, setCsvPreview: vi.fn(), schedulingPlanId: null, setSchedulingPlanId: vi.fn(),
      startDate: null, setStartDate: vi.fn(), fileInputRef: { current: null }, handleFileUpload: vi.fn(),
      confirmImport: vi.fn(), importMutation: { isPending: false }, samplePlanMutation: { isPending: false },
      renamePlanMutation: { isPending: false }, schedulePlanMutation: { isPending: false }, updatePlanGoalMutation: { isPending: false },
    },
    workoutActions: {
      skipConfirmEntry: null, setSkipConfirmEntry: vi.fn(), handleMarkComplete: vi.fn(), handleChangeStatus: vi.fn(),
      handleDelete: vi.fn(), confirmSkip: vi.fn(), logWorkoutMutation: { isPending: false },
      bulkDeleteWorkoutMutation: { isPending: false, mutate: vi.fn() },
    },
    combine: {
      combiningEntry: null, setCombiningEntry: vi.fn(), combineSecondEntry: null, setCombineSecondEntry: vi.fn(),
      showCombineDialog: false, setShowCombineDialog: vi.fn(), handleCombine: vi.fn(), handleConfirmCombine: vi.fn(),
      combineWorkoutsMutation: { isPending: false },
    },
    selectedPlanId: null,
    setSelectedPlanId: vi.fn(),
  };
}

export function setHarnessOpenWorkoutId(id: string | null) {
  harnessState.openWorkoutId = id;
}

export function renderTimelineWithState(overrides: Partial<HarnessState> = {}) {
  harnessState.timelineState = overrides.timelineState ?? buildTimelineStatePayload();
  harnessState.openWorkoutId = overrides.openWorkoutId ?? null;
  harnessState.setOpenWorkoutIdImpl = overrides.setOpenWorkoutIdImpl ?? (() => undefined);
  harnessState.reviewSurfaceImpl = overrides.reviewSurfaceImpl ?? (() => null);
  harnessState.logSheetImpl = overrides.logSheetImpl ?? (() => null);
  harnessState.moveTimelineEntryResult = overrides.moveTimelineEntryResult ?? { handleMoveEntry: vi.fn(), moveEntry: vi.fn(), isMovingEntry: false, isMoving: false };

  const queryClient = new QueryClient();
  queryClient.setQueryDefaults(["/api/v1/preferences"], {
    queryFn: async () => ({ weightUnit: "kg", distanceUnit: "km" }),
    staleTime: Infinity,
  });
  queryClient.setQueryData(["/api/v1/preferences"], { weightUnit: "kg", distanceUnit: "km" });
  return render(<QueryClientProvider client={queryClient}><Timeline /></QueryClientProvider>);
}
