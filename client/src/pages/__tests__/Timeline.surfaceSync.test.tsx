import type { TimelineEntry } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Timeline from "../Timeline";

const setOpenWorkoutId = vi.fn();
let openWorkoutId: string | null = null;
let timelineData: TimelineEntry[] = [];
let logSheetMounts = 0;

vi.mock("@/hooks/useOpenWorkoutId", () => ({
  useOpenWorkoutId: () => ({ openWorkoutId, setOpenWorkoutId }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useIsAiCoachEnabled: () => true,
  useIsAuthUserLoaded: () => true,
  useIsAutoCoaching: () => false,
}));

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useMoveTimelineEntry", () => ({ useMoveTimelineEntry: () => ({ moveEntry: vi.fn(), isMoving: false }) }));

vi.mock("@/hooks/useTimelineState", () => ({
  useTimelineState: () => ({
    data: { plans: [], plansLoading: false, personalRecords: [], timelineData, timelineLoading: false, annotations: [], isNewUser: false, todayRef: { current: null }, scrollToToday: vi.fn() },
    filters: { filterStatus: "all", setFilterStatus: vi.fn(), showAllPast: true, setShowAllPast: vi.fn(), showAllFuture: true, setShowAllFuture: vi.fn(), pastGroups: [], futureGroups: [], visiblePastGroups: [["2026-01-01", timelineData]], visibleFutureGroups: [], hiddenPastCount: 0, hiddenFutureCount: 0 },
    onboarding: { showOnboarding: false, coachOpen: false, setCoachOpen: vi.fn(), handleOnboardingComplete: vi.fn() },
    planImport: { csvPreview: null, setCsvPreview: vi.fn(), schedulingPlanId: null, setSchedulingPlanId: vi.fn(), startDate: "2026-01-01", setStartDate: vi.fn(), fileInputRef: { current: null }, handleFileUpload: vi.fn(), confirmImport: vi.fn(), importMutation: { isPending: false }, samplePlanMutation: { isPending: false }, renamePlanMutation: { isPending: false, mutate: vi.fn() }, schedulePlanMutation: { isPending: false, mutate: vi.fn() }, updatePlanGoalMutation: { isPending: false, mutate: vi.fn() } },
    workoutActions: { skipConfirmEntry: null, setSkipConfirmEntry: vi.fn(), handleMarkComplete: vi.fn(), handleChangeStatus: vi.fn(), handleDelete: vi.fn(), confirmSkip: vi.fn(), logWorkoutMutation: { isPending: false } },
    combine: { combiningEntry: null, setCombiningEntry: vi.fn(), combineSecondEntry: null, setCombineSecondEntry: vi.fn(), showCombineDialog: false, setShowCombineDialog: vi.fn(), handleCombine: vi.fn(), handleConfirmCombine: vi.fn(), combineWorkoutsMutation: { isPending: false } },
    selectedPlanId: null,
    setSelectedPlanId: vi.fn(),
  }),
}));

vi.mock("@/components/timeline", () => ({
  TimelineDateGroup: ({ entries, onClick }: { entries: TimelineEntry[]; onClick: (e: TimelineEntry) => void }) => (
    <button onClick={() => onClick(entries[0])}>open</button>
  ),
  TimelineHeader: () => <div />,
  TimelineFilters: () => <div />,
  TimelineTodayIndicator: () => <div />,
  TimelineSkeleton: () => <div />,
  TimelineEmptyState: () => <div />,
  AnnotationsDialog: () => <div />,
  CoachReviewingIndicator: () => <div />,
  CombineWorkoutsDialog: () => <div />,
  FloatingActionButton: () => <div />,
  ImportPreviewDialog: () => <div />,
  SchedulePlanDialog: () => <div />,
  SkipConfirmDialog: () => <div />,
}));

vi.mock("@/components/workout-detail/LogSheet", () => ({ LogSheet: ({ entry }: { entry: TimelineEntry | null }) => { if (entry) { logSheetMounts += 1; return <div data-testid="log-sheet">{entry.id}</div>; } return null; } }));
vi.mock("@/components/workout-detail/PreviewSheet", () => ({ PreviewSheet: () => <div /> }));
vi.mock("@/components/workout-detail/ReviewSurface", () => ({ ReviewSurface: () => <div /> }));
vi.mock("@/components/workout-detail/SkippedSheet", () => ({ SkippedSheet: () => <div /> }));
vi.mock("@/components/coach/AIConsentDialog", () => ({ AIConsentDialog: () => <div /> }));
vi.mock("@/components/CoachPanel", () => ({ CoachPanel: () => <div /> }));
vi.mock("@/components/FeatureErrorBoundaryWrapper", () => ({ FeatureErrorBoundaryWrapper: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/OnboardingWizard", () => ({ OnboardingWizard: () => <div /> }));

function makeEntry(overrides: Partial<TimelineEntry>): TimelineEntry {
  return { id: "e1", date: "2026-01-01", status: "planned", workoutLogId: null, planDayId: "pd1", ...overrides } as TimelineEntry;
}

describe("Timeline surface sync", () => {
  beforeEach(() => {
    setOpenWorkoutId.mockReset();
    openWorkoutId = "pd1";
    logSheetMounts = 0;
    timelineData = [makeEntry({})];
  });

  it("keeps sheet identity stable across refetch/state transitions", () => {
    const qc = new QueryClient();
    const { rerender } = render(<QueryClientProvider client={qc}><Timeline /></QueryClientProvider>);
    // simulate refetch changing object reference + adding workoutLogId (planned->completed lifecycle)
    timelineData = [makeEntry({ id: "e2", workoutLogId: "wl1", status: "completed" })];
    rerender(<QueryClientProvider client={qc}><Timeline /></QueryClientProvider>);

    expect(screen.getByTestId("log-sheet")).toHaveTextContent("e1");
    expect(logSheetMounts).toBeGreaterThan(0);
    // No close/reopen loop via URL writes.
    expect(setOpenWorkoutId).toHaveBeenCalledTimes(0);
  });
});
