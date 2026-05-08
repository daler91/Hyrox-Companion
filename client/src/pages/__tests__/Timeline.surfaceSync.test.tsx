import type { TimelineEntry } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Timeline from "../Timeline";

const authState = vi.hoisted(() => ({ aiCoachEnabled: true }));
const timelineMocks = vi.hoisted(() => ({ setCoachOpen: vi.fn() }));
const apiMocks = vi.hoisted(() => ({ updatePreferences: vi.fn() }));

const setOpenWorkoutId = vi.fn();
let openWorkoutId: string | null = null;
let timelineData: TimelineEntry[] = [];
let logSheetMounts = 0;

vi.mock("@/hooks/useOpenWorkoutId", () => ({
  useOpenWorkoutId: () => ({ openWorkoutId, setOpenWorkoutId }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useIsAiCoachEnabled: () => authState.aiCoachEnabled,
  useIsAuthUserLoaded: () => true,
  useIsAutoCoaching: () => false,
}));

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useMoveTimelineEntry", () => ({
  useMoveTimelineEntry: () => ({ moveEntry: vi.fn(), isMoving: false }),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      preferences: {
        ...actual.api.preferences,
        update: apiMocks.updatePreferences,
      },
    },
  };
});

vi.mock("@/hooks/useTimelineState", () => ({
  useTimelineState: () => ({
    data: {
      plans: [],
      plansLoading: false,
      personalRecords: [],
      timelineData,
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
      pastGroups: [],
      futureGroups: [],
      visiblePastGroups: [["2026-01-01", timelineData]],
      visibleFutureGroups: [],
      hiddenPastCount: 0,
      hiddenFutureCount: 0,
    },
    onboarding: {
      showOnboarding: false,
      coachOpen: false,
      setCoachOpen: timelineMocks.setCoachOpen,
      handleOnboardingComplete: vi.fn(),
    },
    planImport: {
      csvPreview: null,
      setCsvPreview: vi.fn(),
      schedulingPlanId: null,
      setSchedulingPlanId: vi.fn(),
      startDate: "2026-01-01",
      setStartDate: vi.fn(),
      fileInputRef: { current: null },
      handleFileUpload: vi.fn(),
      confirmImport: vi.fn(),
      importMutation: { isPending: false },
      samplePlanMutation: { isPending: false },
      renamePlanMutation: { isPending: false, mutate: vi.fn() },
      schedulePlanMutation: { isPending: false, mutate: vi.fn() },
      updatePlanGoalMutation: { isPending: false, mutate: vi.fn() },
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
  TimelineDateGroup: ({
    entries,
    onClick,
  }: {
    entries: TimelineEntry[];
    onClick: (e: TimelineEntry) => void;
  }) => <button onClick={() => onClick(entries[0])}>open</button>,
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

vi.mock("@/components/workout-detail/LogSheet", () => ({
  LogSheet: ({ entry, mode }: { entry: TimelineEntry | null; mode?: "log" | "edit" }) => {
    if (!entry) return null;
    if (mode === "edit") return <div data-testid="edit-sheet">{`${entry.id}:${entry.date}`}</div>;
    logSheetMounts += 1;
    return <div data-testid="log-sheet">{`${entry.id}:${entry.date}`}</div>;
  },
}));
vi.mock("@/components/workout-detail/PreviewSheet", () => ({
  PreviewSheet: ({
    entry,
    onEditWorkout,
    onAskCoach,
    coachChatOpen,
    onCloseCoachChat,
  }: {
    entry: TimelineEntry | null;
    onEditWorkout?: (entry: TimelineEntry) => void;
    onAskCoach?: (entry: TimelineEntry) => void;
    coachChatOpen?: boolean;
    onCloseCoachChat?: () => void;
  }) => {
    if (!entry) return null;
    return (
      <section data-testid="preview-sheet">
        <button type="button" onClick={() => onEditWorkout?.(entry)} data-testid="preview-edit">
          Edit workout
        </button>
        <button type="button" onClick={() => onAskCoach?.(entry)} data-testid="preview-ask">
          Ask coach
        </button>
        {coachChatOpen ? (
          <div data-testid="embedded-chat">
            <button type="button" onClick={onCloseCoachChat} data-testid="embedded-back">
              Back
            </button>
          </div>
        ) : null}
      </section>
    );
  },
}));
vi.mock("@/components/workout-detail/ReviewSurface", () => ({ ReviewSurface: () => <div /> }));
vi.mock("@/components/workout-detail/SkippedSheet", () => ({ SkippedSheet: () => <div /> }));
vi.mock("@/components/coach/AIConsentDialog", () => ({
  AIConsentDialog: ({
    open,
    onAccept,
    onDecline,
  }: {
    open: boolean;
    onAccept: () => void;
    onDecline: () => void;
  }) =>
    open ? (
      <div data-testid="ai-consent-dialog">
        <button type="button" onClick={onAccept}>
          Enable
        </button>
        <button type="button" onClick={onDecline}>
          Decline
        </button>
      </div>
    ) : null,
}));
vi.mock("@/components/CoachPanel", () => ({
  CoachPanel: () => <div data-testid="global-coach-panel" />,
}));
vi.mock("@/components/FeatureErrorBoundaryWrapper", () => ({
  FeatureErrorBoundaryWrapper: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/OnboardingWizard", () => ({ OnboardingWizard: () => <div /> }));

function makeEntry(overrides: Partial<TimelineEntry>): TimelineEntry {
  return {
    id: "e1",
    date: "2026-01-01",
    status: "planned",
    workoutLogId: null,
    planDayId: "pd1",
    ...overrides,
  } as TimelineEntry;
}

function renderTimeline(queryClient = new QueryClient()) {
  queryClient.setQueryDefaults(["/api/v1/preferences"], {
    queryFn: async () => ({ weightUnit: "kg", distanceUnit: "km" }),
  });
  queryClient.setQueryData(["/api/v1/preferences"], { weightUnit: "kg", distanceUnit: "km" });
  return render(
    <QueryClientProvider client={queryClient}>
      <Timeline />
    </QueryClientProvider>,
  );
}

describe("Timeline surface sync", () => {
  beforeEach(() => {
    setOpenWorkoutId.mockReset();
    openWorkoutId = "pd1";
    logSheetMounts = 0;
    timelineData = [makeEntry({})];
    authState.aiCoachEnabled = true;
    timelineMocks.setCoachOpen.mockReset();
    apiMocks.updatePreferences.mockReset();
    apiMocks.updatePreferences.mockResolvedValue({});
  });

  it("keeps sheet identity stable across refetch/state transitions", () => {
    const qc = new QueryClient();
    const { rerender } = renderTimeline(qc);
    // simulate refetch changing object reference + adding workoutLogId (planned->completed lifecycle)
    timelineData = [makeEntry({ id: "e2", workoutLogId: "wl1", status: "completed" })];
    rerender(
      <QueryClientProvider client={qc}>
        <Timeline />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("log-sheet")).toHaveTextContent("e1");
    expect(logSheetMounts).toBeGreaterThan(0);
    // No close/reopen loop via URL writes.
    expect(setOpenWorkoutId).toHaveBeenCalledTimes(0);
  });

  it("opens future workout edit mode without changing the scheduled date", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient();
    openWorkoutId = "pd1";
    timelineData = [makeEntry({ date: "2099-01-01" })];

    renderTimeline(qc);

    await user.click(await screen.findByTestId("preview-edit"));

    expect(screen.getByTestId("edit-sheet")).toHaveTextContent("e1:2099-01-01");
    expect(screen.queryByTestId("log-sheet")).not.toBeInTheDocument();
  });

  it("opens embedded coach chat from the workout detail without closing the sheet", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient();
    timelineData = [makeEntry({ date: "2099-01-01" })];

    renderTimeline(qc);

    await user.click(await screen.findByTestId("preview-ask"));

    expect(screen.getByTestId("preview-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("embedded-chat")).toBeInTheDocument();
    expect(timelineMocks.setCoachOpen).toHaveBeenCalledWith(false);

    await user.click(screen.getByTestId("embedded-back"));

    expect(screen.queryByTestId("embedded-chat")).not.toBeInTheDocument();
    expect(screen.getByTestId("preview-sheet")).toBeInTheDocument();
  });

  it("opens embedded coach chat after AI consent instead of the global panel", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient();
    authState.aiCoachEnabled = false;
    timelineData = [makeEntry({ date: "2099-01-01" })];

    renderTimeline(qc);

    await user.click(await screen.findByTestId("preview-ask"));
    expect(screen.getByTestId("ai-consent-dialog")).toBeInTheDocument();

    await user.click(screen.getByText("Enable"));

    await waitFor(() =>
      expect(apiMocks.updatePreferences).toHaveBeenCalledWith({ aiCoachEnabled: true }),
    );
    expect(screen.getByTestId("preview-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("embedded-chat")).toBeInTheDocument();
    expect(timelineMocks.setCoachOpen).toHaveBeenCalledWith(false);
    expect(timelineMocks.setCoachOpen).not.toHaveBeenCalledWith(true);
  });
});
