import type { TimelineEntry } from "@shared/schema";
import { vi } from "vitest";

// The useTimelineState payload builders shared by the Timeline specs. Kept in a
// module with no vi.mock calls of its own so specs that define their own mock
// graph (e.g. Timeline.surfaceSync) can reuse the payload without pulling in
// timelineTestHarness's mocks.

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
      setPlanRetirementMutation: { isPending: false, mutate: vi.fn() },
      deletePlanMutation: { isPending: false, mutate: vi.fn() },
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
