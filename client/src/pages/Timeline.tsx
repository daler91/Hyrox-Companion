import {
  type Announcements,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  type ScreenReaderInstructions,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { FuellingDayPoint, TimelineEntry } from "@shared/schema";
import { useVirtualizer } from "@tanstack/react-virtual";
import { format } from "date-fns";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { OnboardingWizard } from "@/components/OnboardingWizard";
import {
  BulkDeleteControls,
  CoachReviewingIndicator,
  FloatingActionButton,
  TimelineFilters,
  TimelineHeader,
  TimelineSummaryCard,
  TimelineTodayIndicator,
} from "@/components/timeline";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/ui/PageContainer";
import { SCROLL_TO_TODAY_DELAY_MS } from "@/hooks/constants";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { useIsAiCoachEnabled, useIsAuthUserLoaded, useIsAutoCoaching, useIsOnboardingCompleted } from "@/hooks/useAuth";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useFuellingRange } from "@/hooks/useNutrition";
import { useTimelineState } from "@/hooks/useTimelineState";
import { featureFlags } from "@/lib/featureFlags";
import { TimelineCoachPanels } from "@/pages/timeline/TimelineCoachPanels";
import { TimelineContent } from "@/pages/timeline/TimelineContent";
import { TimelineWorkoutSurfaces } from "@/pages/timeline/TimelineWorkoutSurfaces";
import { useBulkDeleteSelection } from "@/pages/timeline/useBulkDeleteSelection";
import { useEmbeddedCoachRouting } from "@/pages/timeline/useEmbeddedCoachRouting";
import { useTimelineDialogState } from "@/pages/timeline/useTimelineDialogState";
import { useTimelinePageController } from "@/pages/timeline/useTimelinePageController";
import { useTimelineSurfaceSelection } from "@/pages/timeline/useTimelineSurfaceSelection";

// Screen-reader feedback for keyboard-driven workout rescheduling (S9). The
// default dnd-kit announcements read opaque draggable/droppable ids; these
// reference the calendar dates the drag actually moves between.
const dndScreenReaderInstructions: ScreenReaderInstructions = {
  draggable:
    "To reschedule a workout, press space or enter to pick it up, use the arrow keys to choose a different day, then press space or enter to drop it. Press escape to cancel.",
};

function draggedFromDate(active: { data: { current?: unknown } }): string {
  return (active.data.current as { entry?: TimelineEntry } | undefined)?.entry?.date ?? "its day";
}

const dndAnnouncements: Announcements = {
  onDragStart: ({ active }) =>
    `Picked up the workout from ${draggedFromDate(active)}. Use the arrow keys to move it to a different day, then press space to drop.`,
  onDragOver: ({ over }) => {
    const date = (over?.data.current as { date?: string } | undefined)?.date;
    return date ? `Over ${date}.` : "Not over a day.";
  },
  onDragEnd: ({ active, over }) => {
    const date = (over?.data.current as { date?: string } | undefined)?.date;
    return date
      ? `Moved the workout to ${date}.`
      : `Drop cancelled; the workout stayed on ${draggedFromDate(active)}.`;
  },
  onDragCancel: ({ active }) => `Cancelled; the workout stayed on ${draggedFromDate(active)}.`,
};

// scrollToIndex only guarantees the today row is *mounted*; it scrolls within the
// virtualizer's own coordinate space, which ignores the non-virtualized header above
// the list and so undershoots. Phase 2 reads the true pixel position from the live DOM
// node (it's in normal flow, so the browser accounts for the current header height).
// The row can take a frame or two to mount + measure, so retry across a few frames,
// then bail. Returns the rAF handle so callers can cancel a pending retry on cleanup.
const SCROLL_TO_TODAY_MAX_FRAMES = 10;

function scrollTodayIntoViewWhenReady(
  todayRef: RefObject<HTMLDivElement | null>,
  framesLeft = SCROLL_TO_TODAY_MAX_FRAMES,
): number | undefined {
  const el = todayRef.current;
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    return undefined;
  }
  if (framesLeft <= 0) return undefined;
  return requestAnimationFrame(() => scrollTodayIntoViewWhenReady(todayRef, framesLeft - 1));
}

export default function Timeline() {
  useDocumentTitle("Timeline");
  // Keep Timeline off the full auth object while auto-coach polling is active.
  const aiCoachEnabled = useIsAiCoachEnabled();
  const isAutoCoaching = useIsAutoCoaching();
  const isAuthUserLoaded = useIsAuthUserLoaded();
  const onboardingCompleted = useIsOnboardingCompleted();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const {
    data,
    filters,
    onboarding,
    planImport,
    workoutActions,
    combine,
    selectedPlanId,
    setSelectedPlanId,
  } = useTimelineState({ aiCoachEnabled, isAuthUserLoaded, onboardingCompleted });

  const {
    plans,
    plansLoading,
    personalRecords,
    timelineData,
    timelineLoading,
    annotations,
    isNewUser,
    todayRef,
    scrollToToday,
  } = data;
  const {
    filterStatus,
    setFilterStatus,
    showAllPast,
    setShowAllPast,
    showAllFuture,
    setShowAllFuture,
    pastGroups,
    futureGroups,
    visiblePastGroups,
    visibleFutureGroups,
    hiddenPastCount,
    hiddenFutureCount,
  } = filters;
  const { showOnboarding, coachOpen, setCoachOpen, handleOnboardingComplete } = onboarding;
  // Only the members Timeline itself renders with are destructured here;
  // the full slices flow to TimelineWorkoutSurfaces as grouped props.
  const {
    setSchedulingPlanId,
    fileInputRef,
    handleFileUpload,
    importMutation,
    samplePlanMutation,
    renamePlanMutation,
    updatePlanGoalMutation,
    deletePlanMutation,
  } = planImport;
  const { handleMarkComplete, bulkDeleteWorkoutMutation } = workoutActions;
  const { combiningEntry, handleCombine } = combine;
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialTodayScrollKeyRef = useRef<string | null>(null);
  const surfaceSelection = useTimelineSurfaceSelection(timelineData);
  const {
    previewEntry,
    futureEditEntry,
    logEntry,
    reviewEntry,
    skippedEntry,
    openSurface,
    closeAllSurfacesAndClearUrl,
  } = surfaceSelection;
  const [adhocOpen, setAdhocOpen] = useState(false);
  const dialogState = useTimelineDialogState();
  const {
    showAIConsent,
    setShowAIConsent,
    handleAddAnnotation,
    handleEditAnnotation,
  } = dialogState;
  const coachRouting = useEmbeddedCoachRouting({
    aiCoachEnabled,
    isAuthUserLoaded,
    setCoachOpen,
    setShowAIConsent,
    openSurface,
    closeAllSurfacesAndClearUrl,
    toast,
  });
  const {
    handleCoachToggle,
    openTimelineSurface,
    clearPendingCoachIntent,
    handleAIConsentAccept,
  } = coachRouting;

  const { annotationsByDate, moveEntry, isMoving, handleDeleteAnnotation, isAnnotationDeleting } =
    useTimelinePageController(selectedPlanId, annotations);

  const allVisibleGroups = useMemo(() => {
    return [...visiblePastGroups.slice().reverse(), ...visibleFutureGroups];
  }, [visiblePastGroups, visibleFutureGroups]);

  // Phase 2: per-day fuelling chips on the home screen. Fetch the whole visible
  // window once (groups are ascending by date) and look up per-date below — no
  // per-day fan-out. Gated by the nutrition feature flag; no-ops without data.
  const { data: fuellingRange } = useFuellingRange(
    allVisibleGroups[0]?.[0] ?? "",
    allVisibleGroups[allVisibleGroups.length - 1]?.[0] ?? "",
    featureFlags.nutritionEnabled,
  );
  const fuellingByDate = useMemo(() => {
    const map = new Map<string, FuellingDayPoint>();
    for (const day of fuellingRange?.days ?? []) map.set(day.date, day);
    return map;
  }, [fuellingRange]);

  const {
    bulkDeleteMode,
    bulkDeleteConfirmOpen,
    setBulkDeleteConfirmOpen,
    bulkDeletableEntries,
    selectedBulkEntries,
    selectedBulkEntryKeys,
    clearBulkSelection,
    finishBulkDelete,
    handleBulkDeleteModeChange,
    handleBulkSelectAll,
    handleBulkSelectToggle,
  } = useBulkDeleteSelection(allVisibleGroups);

  const handleBulkDeleteConfirm = useCallback(() => {
    if (selectedBulkEntries.length === 0) return;
    bulkDeleteWorkoutMutation.mutate(selectedBulkEntries, {
      onSuccess: finishBulkDelete,
    });
  }, [bulkDeleteWorkoutMutation, finishBulkDelete, selectedBulkEntries]);

  // Stable handler identities for TimelineFilters (mutation `.mutate` fns are
  // referentially stable in TanStack v5, unlike the mutation result objects).
  const { mutate: mutateRenamePlan } = renamePlanMutation;
  const { mutate: mutatePlanGoal } = updatePlanGoalMutation;
  const { mutate: mutateDeletePlan } = deletePlanMutation;
  const handleRenamePlan = useCallback(
    (planId: string, name: string) => mutateRenamePlan({ planId, name }),
    [mutateRenamePlan],
  );
  const handleGoalSave = useCallback(
    (planId: string, goal: string | null) => mutatePlanGoal({ planId, goal }),
    [mutatePlanGoal],
  );
  const handleDeletePlan = useCallback(
    (planId: string) =>
      mutateDeletePlan(planId, {
        onSuccess: () => {
          if (selectedPlanId === planId) setSelectedPlanId(null);
        },
      }),
    [mutateDeletePlan, selectedPlanId, setSelectedPlanId],
  );

  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;
      const entry = (active.data.current as { entry?: TimelineEntry } | undefined)?.entry;
      const newDate = (over.data.current as { date?: string } | undefined)?.date;
      if (!entry || !newDate || entry.date === newDate) return;
      moveEntry(entry, newDate);
    },
    [moveEntry],
  );

  const todayPresent = useMemo(() => {
    const todayStr = format(new Date(), "yyyy-MM-dd");
    return allVisibleGroups.some(([dateGroupStr]) => dateGroupStr === todayStr);
  }, [allVisibleGroups]);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual known issue
  const rowVirtualizer = useVirtualizer({
    count: allVisibleGroups.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 150,
    overscan: 5,
  });

  const handleScrollToToday = useCallback(() => {
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const todayIndex = allVisibleGroups.findIndex(([dateGroupStr]) => dateGroupStr === todayStr);

    if (todayIndex < 0) {
      scrollToToday();
      return;
    }

    // Phase 1: mount the today row (instant); phase 2: land precisely on the real node.
    rowVirtualizer.scrollToIndex(todayIndex, { align: "center" });
    scrollTodayIntoViewWhenReady(todayRef);
  }, [allVisibleGroups, rowVirtualizer, scrollToToday, todayRef]);

  useEffect(() => {
    if (timelineLoading) return undefined;

    const scrollKey = selectedPlanId ?? "all-plans";
    if (initialTodayScrollKeyRef.current === scrollKey) return undefined;

    const todayStr = format(new Date(), "yyyy-MM-dd");
    const todayIndex = allVisibleGroups.findIndex(([dateGroupStr]) => dateGroupStr === todayStr);

    if (todayIndex < 0) {
      initialTodayScrollKeyRef.current = scrollKey;
      return undefined;
    }

    let rafId: number | undefined;
    const timerId = setTimeout(() => {
      // Phase 1: mount the today row (instant); phase 2: land precisely on the real node.
      rowVirtualizer.scrollToIndex(todayIndex, { align: "center" });
      rafId = scrollTodayIntoViewWhenReady(todayRef);
      initialTodayScrollKeyRef.current = scrollKey;
    }, SCROLL_TO_TODAY_DELAY_MS);

    return () => {
      clearTimeout(timerId);
      if (rafId !== undefined) cancelAnimationFrame(rafId);
    };
  }, [allVisibleGroups, rowVirtualizer, selectedPlanId, timelineLoading, todayRef]);

  const isWorkoutSurfaceOpen = Boolean(
    previewEntry ||
      futureEditEntry ||
      logEntry ||
      reviewEntry ||
      skippedEntry ||
      adhocOpen,
  );

  return (
    <>
      <OnboardingWizard open={showOnboarding} onComplete={handleOnboardingComplete} />
      <Input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleFileUpload}
        data-testid="input-csv-upload-onboarding"
      />
      <div className="flex h-full">
        <div ref={scrollRef} className="flex-1 overflow-auto relative">
          <PageContainer size="default" className="space-y-6">
            <TimelineHeader />

            <CoachReviewingIndicator isActive={isAutoCoaching} />

            <TimelineFilters
              plans={plans}
              plansLoading={plansLoading}
              selectedPlanId={selectedPlanId}
              onPlanChange={setSelectedPlanId}
              filterStatus={filterStatus}
              onFilterChange={setFilterStatus}
              onFileUpload={handleFileUpload}
              isImporting={importMutation.isPending}
              onRenamePlan={handleRenamePlan}
              isRenaming={renamePlanMutation.isPending}
              onGoalSave={handleGoalSave}
              isUpdatingGoal={updatePlanGoalMutation.isPending}
              onScheduleClick={setSchedulingPlanId}
              onDeletePlan={handleDeletePlan}
              isDeletingPlan={deletePlanMutation.isPending}
              canBulkDelete={bulkDeletableEntries.length > 0}
              bulkDeleteMode={bulkDeleteMode}
              onBulkDeleteModeChange={handleBulkDeleteModeChange}
            />

            <TimelineSummaryCard selectedPlanId={selectedPlanId} />

            <BulkDeleteControls
              enabled={bulkDeleteMode}
              selectedCount={selectedBulkEntries.length}
              visibleCount={bulkDeletableEntries.length}
              isPending={bulkDeleteWorkoutMutation.isPending}
              confirmOpen={bulkDeleteConfirmOpen}
              onConfirmOpenChange={setBulkDeleteConfirmOpen}
              onSelectAll={handleBulkSelectAll}
              onClear={clearBulkSelection}
              onCancel={() => handleBulkDeleteModeChange(false)}
              onDelete={() => setBulkDeleteConfirmOpen(true)}
              onConfirmDelete={handleBulkDeleteConfirm}
            />

            <TimelineTodayIndicator
              todayRef={todayRef}
              scrollRef={scrollRef}
              onScrollToToday={handleScrollToToday}
              todayPresent={todayPresent}
            />

            <DndContext
              sensors={dragSensors}
              onDragEnd={handleDragEnd}
              accessibility={{
                announcements: dndAnnouncements,
                screenReaderInstructions: dndScreenReaderInstructions,
              }}
            >
              <TimelineContent
                timelineLoading={timelineLoading}
                filterStatus={filterStatus}
                selectedPlanId={selectedPlanId}
                plans={plans}
                samplePlanMutation={samplePlanMutation}
                importMutation={importMutation}
                handleFileUpload={handleFileUpload}
                setSchedulingPlanId={setSchedulingPlanId}
                setFilterStatus={setFilterStatus}
                hiddenPastCount={hiddenPastCount}
                setShowAllPast={setShowAllPast}
                showAllPast={showAllPast}
                pastGroups={pastGroups}
                hiddenFutureCount={hiddenFutureCount}
                setShowAllFuture={setShowAllFuture}
                showAllFuture={showAllFuture}
                futureGroups={futureGroups}
                allVisibleGroups={allVisibleGroups}
                rowVirtualizer={rowVirtualizer}
                todayRef={todayRef}
                handleMarkComplete={handleMarkComplete}
                onCardClick={openTimelineSurface}
                handleCombine={handleCombine}
                combiningEntry={combiningEntry}
                personalRecords={personalRecords}
                isAutoCoaching={isAutoCoaching}
                annotationsByDate={annotationsByDate}
                onAddAnnotation={handleAddAnnotation}
                onEditAnnotation={handleEditAnnotation}
                onDeleteAnnotation={handleDeleteAnnotation}
                isAnnotationDeleting={isAnnotationDeleting}
                onMoveEntry={moveEntry}
                isMovingEntry={isMoving}
                isBulkSelectMode={bulkDeleteMode}
                selectedBulkEntryKeys={selectedBulkEntryKeys}
                onBulkSelectToggle={handleBulkSelectToggle}
                fuellingByDate={fuellingByDate}
              />
            </DndContext>

            {!isWorkoutSurfaceOpen && !bulkDeleteMode && (
              <FloatingActionButton
                coachPanelOpen={coachOpen}
                onCoachToggle={() => handleCoachToggle(!coachOpen)}
                onLogWorkout={() => setAdhocOpen(true)}
              />
            )}

            <TimelineWorkoutSurfaces
              isMobile={isMobile}
              toast={toast}
              adhocOpen={adhocOpen}
              onAdhocOpenChange={setAdhocOpen}
              surfaces={surfaceSelection}
              coach={coachRouting}
              actions={workoutActions}
              planImport={planImport}
              combine={combine}
              annotations={dialogState}
            />
          </PageContainer>
        </div>

        <TimelineCoachPanels
          coachOpen={coachOpen}
          isMobile={isMobile}
          isWorkoutSurfaceOpen={isWorkoutSurfaceOpen}
          timelineData={timelineData}
          isNewUser={isNewUser}
          onCoachClose={() => setCoachOpen(false)}
          showAIConsent={showAIConsent}
          onAIConsentAccept={handleAIConsentAccept}
          onAIConsentDecline={clearPendingCoachIntent}
        />
      </div>
    </>
  );
}
