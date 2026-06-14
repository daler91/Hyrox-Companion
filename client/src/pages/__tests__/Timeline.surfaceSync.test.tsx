import type { TimelineEntry } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SCROLL_TO_TODAY_DELAY_MS } from "@/hooks/constants";

import Timeline from "../Timeline";

const authState = vi.hoisted(() => ({ aiCoachEnabled: true }));
const timelineMocks = vi.hoisted(() => ({ setCoachOpen: vi.fn() }));
const workoutActionMocks = vi.hoisted(() => ({ handleMarkComplete: vi.fn() }));
const apiMocks = vi.hoisted(() => ({ updatePreferences: vi.fn() }));
const viewportState = vi.hoisted(() => ({ isMobile: false }));
const dataMocks = vi.hoisted(() => ({
  scrollToToday: vi.fn(),
  todayRef: { current: null as HTMLElement | null },
}));
const virtualizerMocks = vi.hoisted(() => ({
  getVirtualItems: vi.fn(() => [{ key: "0", index: 0, start: 0, end: 300, size: 300 }]),
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
}));

const setOpenWorkoutId = vi.fn();
let openWorkoutId: string | null = null;
let timelineData: TimelineEntry[] = [];
let visiblePastGroups: Array<[string, TimelineEntry[]]> = [];
let visibleFutureGroups: Array<[string, TimelineEntry[]]> = [];
let timelineLoading = false;
let logSheetMounts = 0;

vi.mock("@/hooks/useOpenWorkoutId", () => ({
  useOpenWorkoutId: () => ({ openWorkoutId, setOpenWorkoutId }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useIsAiCoachEnabled: () => authState.aiCoachEnabled,
  useIsAuthUserLoaded: () => true,
  useIsAutoCoaching: () => false,
  useIsOnboardingCompleted: () => false,
}));

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => viewportState.isMobile }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useMoveTimelineEntry", () => ({
  useMoveTimelineEntry: () => ({ moveEntry: vi.fn(), isMoving: false }),
}));
vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-virtual")>();
  return {
    ...actual,
    useVirtualizer: () => ({
      getTotalSize: () => 300,
      getVirtualItems: virtualizerMocks.getVirtualItems,
      measureElement: virtualizerMocks.measureElement,
      scrollToIndex: virtualizerMocks.scrollToIndex,
    }),
  };
});
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
      timelineLoading,
      annotations: [],
      isNewUser: false,
      todayRef: dataMocks.todayRef,
      scrollToToday: dataMocks.scrollToToday,
    },
    filters: {
      filterStatus: "all",
      setFilterStatus: vi.fn(),
      showAllPast: true,
      setShowAllPast: vi.fn(),
      showAllFuture: true,
      setShowAllFuture: vi.fn(),
      pastGroups: visiblePastGroups,
      futureGroups: visibleFutureGroups,
      visiblePastGroups,
      visibleFutureGroups,
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
      deletePlanMutation: { isPending: false, mutate: vi.fn() },
    },
    workoutActions: {
      skipConfirmEntry: null,
      setSkipConfirmEntry: vi.fn(),
      handleMarkComplete: workoutActionMocks.handleMarkComplete,
      handleChangeStatus: vi.fn(),
      handleDelete: vi.fn(),
      confirmSkip: vi.fn(),
      logWorkoutMutation: { isPending: false },
      bulkDeleteWorkoutMutation: { isPending: false, mutate: vi.fn() },
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
  TimelineSummaryCard: () => <div data-testid="timeline-summary-card" />,
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
  BulkDeleteControls: () => <div />,
}));

vi.mock("@/components/workout-detail/LogSheet", () => ({
  LogSheet: ({
    entry,
    mode,
    onLogAsPlanned,
    onClose,
  }: {
    entry: TimelineEntry | null;
    mode?: "log" | "edit";
    onLogAsPlanned?: (
      entry: TimelineEntry,
      rpe: number | null,
      note: string | null,
    ) => Promise<void> | void;
    onClose?: () => void;
  }) => {
    if (!entry) return null;
    if (mode === "edit") return <div data-testid="edit-sheet">{`${entry.id}:${entry.date}`}</div>;
    logSheetMounts += 1;
    return (
      <div data-testid="log-sheet">
        {`${entry.id}:${entry.date}`}
        <button
          type="button"
          data-testid="mock-log-complete"
          onClick={() => {
            void onLogAsPlanned?.(entry, null, null);
          }}
        >
          Complete
        </button>
        <button type="button" data-testid="mock-log-close" onClick={() => onClose?.()}>
          Close
        </button>
      </div>
    );
  },
}));
vi.mock("@/components/workout-detail/PreviewSheet", () => ({
  PreviewSheet: ({
    entry,
    onEditWorkout,
    onAskCoach,
    coachChatOpen,
    coachChatNonce,
    mobileCoachPanelOpen,
    onCloseCoachChat,
    onShowCoachPanel,
    onShowWorkoutDetails,
  }: {
    entry: TimelineEntry | null;
    onEditWorkout?: (entry: TimelineEntry) => void;
    onAskCoach?: (entry: TimelineEntry) => void;
    coachChatOpen?: boolean;
    coachChatNonce?: number;
    mobileCoachPanelOpen?: boolean;
    onCloseCoachChat?: () => void;
    onShowCoachPanel?: () => void;
    onShowWorkoutDetails?: () => void;
  }) => {
    if (!entry) return null;
    return (
      <section data-testid="preview-sheet">
        {mobileCoachPanelOpen ? null : (
          <div data-testid="preview-details">
            <button type="button" onClick={() => onEditWorkout?.(entry)} data-testid="preview-edit">
              Edit workout
            </button>
            <button type="button" onClick={() => onAskCoach?.(entry)} data-testid="preview-ask">
              Ask coach
            </button>
            {coachChatOpen ? (
              <button
                type="button"
                onClick={onShowCoachPanel}
                data-testid="return-to-coach-chat"
              >
                Return to coach chat
              </button>
            ) : null}
          </div>
        )}
        {coachChatOpen ? (
          <div
            data-testid="embedded-chat"
            data-nonce={String(coachChatNonce ?? "")}
            data-visible={String(!!mobileCoachPanelOpen)}
          >
            <button
              type="button"
              onClick={mobileCoachPanelOpen ? onShowWorkoutDetails : onCloseCoachChat}
              data-testid="embedded-back"
            >
              Workout details
            </button>
          </div>
        ) : null}
      </section>
    );
  },
}));
vi.mock("@/components/workout-detail/ReviewSurface", () => ({
  ReviewSurface: ({
    entry,
    showCompletionSuccess,
  }: {
    entry: TimelineEntry | null;
    showCompletionSuccess?: boolean;
  }) =>
    entry ? (
      <div data-testid="review-surface" data-completion-success={String(!!showCompletionSuccess)}>
        {entry.id}
      </div>
    ) : null,
}));
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

function setVisibleTimelineGroups({
  past = [],
  future = [],
}: {
  readonly past?: Array<[string, TimelineEntry[]]>;
  readonly future?: Array<[string, TimelineEntry[]]>;
}) {
  visiblePastGroups = past;
  visibleFutureGroups = future;
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

function renderFuturePreview({
  aiCoachEnabled = true,
  isMobile = false,
}: {
  readonly aiCoachEnabled?: boolean;
  readonly isMobile?: boolean;
} = {}) {
  const user = userEvent.setup();
  const queryClient = new QueryClient();
  authState.aiCoachEnabled = aiCoachEnabled;
  viewportState.isMobile = isMobile;
  timelineData = [makeEntry({ date: "2099-01-01" })];
  setVisibleTimelineGroups({ future: [["2099-01-01", timelineData]] });

  renderTimeline(queryClient);

  return { user };
}

async function askCoachFromPreview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId("preview-ask"));
}

async function acceptAIConsent(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText("Enable"));

  await waitFor(() =>
    expect(apiMocks.updatePreferences).toHaveBeenCalledWith({ aiCoachEnabled: true }),
  );
}

function expectEmbeddedCoachOpen() {
  expect(screen.getByTestId("preview-sheet")).toBeInTheDocument();
  expect(screen.getByTestId("embedded-chat")).toBeInTheDocument();
}

function expectMobileCoachPanelOpen() {
  expect(screen.getByTestId("preview-sheet")).toBeInTheDocument();
  expect(screen.queryByTestId("preview-details")).not.toBeInTheDocument();
  expect(screen.getByTestId("embedded-chat")).toHaveAttribute("data-visible", "true");
}

function expectGlobalCoachRemainsClosed() {
  expect(timelineMocks.setCoachOpen).toHaveBeenCalledWith(false);
  expect(timelineMocks.setCoachOpen).not.toHaveBeenCalledWith(true);
}

describe("Timeline surface sync", () => {
  beforeEach(() => {
    setOpenWorkoutId.mockReset();
    openWorkoutId = "pd1";
    logSheetMounts = 0;
    timelineData = [makeEntry({})];
    setVisibleTimelineGroups({ past: [["2026-01-01", timelineData]] });
    timelineLoading = false;
    authState.aiCoachEnabled = true;
    viewportState.isMobile = false;
    timelineMocks.setCoachOpen.mockReset();
    workoutActionMocks.handleMarkComplete.mockReset();
    apiMocks.updatePreferences.mockReset();
    apiMocks.updatePreferences.mockResolvedValue({});
    dataMocks.scrollToToday.mockReset();
    dataMocks.todayRef.current = null;
    virtualizerMocks.getVirtualItems.mockReset();
    virtualizerMocks.getVirtualItems.mockReturnValue([{ key: "0", index: 0, start: 0, end: 300, size: 300 }]);
    virtualizerMocks.measureElement.mockReset();
    virtualizerMocks.scrollToIndex.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("hands a completed workout from the log sheet into the review surface", async () => {
    const user = userEvent.setup();
    const completedEntry = makeEntry({
      id: "log-wl1",
      status: "completed",
      workoutLogId: "wl1",
    });
    workoutActionMocks.handleMarkComplete.mockImplementation((
      _entry: TimelineEntry,
      options?: { onSuccess?: (entry: TimelineEntry) => void },
    ) => {
      options?.onSuccess?.(completedEntry);
    });

    renderTimeline();

    expect(await screen.findByTestId("log-sheet")).toHaveTextContent("e1:2026-01-01");

    await user.click(screen.getByTestId("mock-log-complete"));

    await waitFor(() => {
      expect(screen.getByTestId("review-surface")).toHaveTextContent("log-wl1");
    });
    expect(screen.queryByTestId("log-sheet")).not.toBeInTheDocument();
    expect(screen.getByTestId("review-surface")).toHaveAttribute("data-completion-success", "true");
    expect(openWorkoutId).toBe("pd1");
    expect(setOpenWorkoutId).not.toHaveBeenCalledWith(null);
  });

  it("does not reopen the workout surface when the log sheet is dismissed mid-mutation", async () => {
    const user = userEvent.setup();
    const completedEntry = makeEntry({
      id: "log-wl1",
      status: "completed",
      workoutLogId: "wl1",
    });
    let resolveSuccess: (() => void) | null = null;
    workoutActionMocks.handleMarkComplete.mockImplementation((
      _entry: TimelineEntry,
      options?: { onSuccess?: (entry: TimelineEntry) => void },
    ) => {
      resolveSuccess = () => options?.onSuccess?.(completedEntry);
    });

    const qc = new QueryClient();
    const { rerender } = renderTimeline(qc);

    expect(await screen.findByTestId("log-sheet")).toHaveTextContent("e1:2026-01-01");

    await user.click(screen.getByTestId("mock-log-complete"));
    await user.click(screen.getByTestId("mock-log-close"));

    openWorkoutId = null;
    rerender(
      <QueryClientProvider client={qc}>
        <Timeline />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("log-sheet")).not.toBeInTheDocument();
    });

    setOpenWorkoutId.mockClear();

    act(() => {
      resolveSuccess?.();
    });

    expect(screen.queryByTestId("review-surface")).not.toBeInTheDocument();
    expect(setOpenWorkoutId).not.toHaveBeenCalledWith("pd1");
  });

  it("clears the completion-success flag when reopening a previously completed entry", async () => {
    const user = userEvent.setup();
    const completedEntry = makeEntry({
      id: "log-wl1",
      status: "completed",
      workoutLogId: "wl1",
    });
    workoutActionMocks.handleMarkComplete.mockImplementation((
      _entry: TimelineEntry,
      options?: { onSuccess?: (entry: TimelineEntry) => void },
    ) => {
      options?.onSuccess?.(completedEntry);
    });

    const qc = new QueryClient();
    const { rerender } = renderTimeline(qc);

    await user.click(await screen.findByTestId("mock-log-complete"));

    await waitFor(() => {
      expect(screen.getByTestId("review-surface")).toHaveAttribute(
        "data-completion-success",
        "true",
      );
    });

    timelineData = [completedEntry];
    setVisibleTimelineGroups({ past: [["2026-01-01", timelineData]] });
    openWorkoutId = null;
    rerender(
      <QueryClientProvider client={qc}>
        <Timeline />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("review-surface")).not.toBeInTheDocument();
    });

    openWorkoutId = "pd1";
    rerender(
      <QueryClientProvider client={qc}>
        <Timeline />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("review-surface")).toHaveTextContent("log-wl1");
    });
    expect(screen.getByTestId("review-surface")).toHaveAttribute(
      "data-completion-success",
      "false",
    );
  });

  it("opens future workout edit mode without changing the scheduled date", async () => {
    openWorkoutId = "pd1";
    const { user } = renderFuturePreview();

    await user.click(await screen.findByTestId("preview-edit"));

    expect(screen.getByTestId("edit-sheet")).toHaveTextContent("e1:2099-01-01");
    expect(screen.queryByTestId("log-sheet")).not.toBeInTheDocument();
  });

  it("opens embedded coach chat from the workout detail without closing the sheet", async () => {
    const { user } = renderFuturePreview();

    await askCoachFromPreview(user);

    expectEmbeddedCoachOpen();
    expect(screen.getByTestId("embedded-chat")).toHaveAttribute("data-nonce", "1");
    expect(timelineMocks.setCoachOpen).toHaveBeenCalledWith(false);

    await askCoachFromPreview(user);

    expect(screen.getByTestId("embedded-chat")).toHaveAttribute("data-nonce", "2");

    await user.click(screen.getByTestId("embedded-back"));

    expect(screen.queryByTestId("embedded-chat")).not.toBeInTheDocument();
    expect(screen.getByTestId("preview-sheet")).toBeInTheDocument();
  });

  it("swaps mobile workout detail to a workout coach panel and back", async () => {
    const { user } = renderFuturePreview({ isMobile: true });

    await askCoachFromPreview(user);

    expectMobileCoachPanelOpen();
    expectGlobalCoachRemainsClosed();

    await user.click(screen.getByTestId("embedded-back"));

    expect(screen.getByTestId("preview-details")).toBeInTheDocument();
    expect(screen.getByTestId("embedded-chat")).toHaveAttribute("data-visible", "false");
    expect(screen.getByTestId("embedded-chat")).toHaveAttribute("data-nonce", "1");

    await askCoachFromPreview(user);

    expectMobileCoachPanelOpen();
    expect(screen.getByTestId("embedded-chat")).toHaveAttribute("data-nonce", "2");

    await user.click(screen.getByTestId("embedded-back"));
    await user.click(screen.getByTestId("return-to-coach-chat"));

    expectMobileCoachPanelOpen();
    expect(screen.getByTestId("embedded-chat")).toHaveAttribute("data-nonce", "2");
    expect(timelineMocks.setCoachOpen).not.toHaveBeenCalledWith(true);
  });

  it("opens embedded coach chat after AI consent instead of the global panel", async () => {
    const { user } = renderFuturePreview({ aiCoachEnabled: false });

    await askCoachFromPreview(user);
    expect(screen.getByTestId("ai-consent-dialog")).toBeInTheDocument();

    await acceptAIConsent(user);

    expectEmbeddedCoachOpen();
    expectGlobalCoachRemainsClosed();
  });

  it("opens the mobile workout coach panel after AI consent instead of the global panel", async () => {
    const { user } = renderFuturePreview({ aiCoachEnabled: false, isMobile: true });

    await askCoachFromPreview(user);
    expect(screen.getByTestId("ai-consent-dialog")).toBeInTheDocument();

    await acceptAIConsent(user);

    expectMobileCoachPanelOpen();
    expectGlobalCoachRemainsClosed();
  });

  it("scrolls to today through the virtualizer when the today row is not mounted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T12:00:00Z"));
    viewportState.isMobile = true;
    openWorkoutId = null;

    const pastEntry = makeEntry({ id: "past", date: "2026-05-14", planDayId: "past-day" });
    const todayEntry = makeEntry({ id: "today", date: "2026-05-15", planDayId: "today-day" });
    timelineData = [pastEntry, todayEntry];
    setVisibleTimelineGroups({
      past: [["2026-05-14", [pastEntry]]],
      future: [["2026-05-15", [todayEntry]]],
    });
    virtualizerMocks.getVirtualItems.mockReturnValue([{ key: "0", index: 0, start: 0, end: 300, size: 300 }]);

    renderTimeline();

    act(() => {
      vi.advanceTimersByTime(SCROLL_TO_TODAY_DELAY_MS);
    });

    expect(virtualizerMocks.scrollToIndex).toHaveBeenCalledWith(1, { align: "center" });
    expect(dataMocks.scrollToToday).not.toHaveBeenCalled();
  });

  it("lands precisely on the mounted today row via scrollIntoView", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T12:00:00Z"));
    viewportState.isMobile = true;
    openWorkoutId = null;

    // Simulate the today row being mounted: scrollToIndex only guarantees the row
    // exists; the precise landing reads the real DOM node so the header above the
    // virtualized list is accounted for.
    const scrollIntoView = vi.fn();
    dataMocks.todayRef.current = { scrollIntoView } as unknown as HTMLElement;

    const pastEntry = makeEntry({ id: "past", date: "2026-05-14", planDayId: "past-day" });
    const todayEntry = makeEntry({ id: "today", date: "2026-05-15", planDayId: "today-day" });
    timelineData = [pastEntry, todayEntry];
    setVisibleTimelineGroups({
      past: [["2026-05-14", [pastEntry]]],
      future: [["2026-05-15", [todayEntry]]],
    });

    renderTimeline();

    act(() => {
      vi.advanceTimersByTime(SCROLL_TO_TODAY_DELAY_MS);
    });

    expect(virtualizerMocks.scrollToIndex).toHaveBeenCalledWith(1, { align: "center" });
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
  });

  it("does not force-scroll when today is absent from the visible timeline groups", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T12:00:00Z"));
    viewportState.isMobile = true;
    openWorkoutId = null;

    const pastEntry = makeEntry({ id: "past", date: "2026-05-14", planDayId: "past-day" });
    timelineData = [pastEntry];
    setVisibleTimelineGroups({ past: [["2026-05-14", [pastEntry]]] });

    renderTimeline();

    act(() => {
      vi.advanceTimersByTime(SCROLL_TO_TODAY_DELAY_MS);
    });

    expect(virtualizerMocks.scrollToIndex).not.toHaveBeenCalled();
    expect(dataMocks.scrollToToday).not.toHaveBeenCalled();
  });
});
