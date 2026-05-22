import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { TimelineEntry } from "@shared/schema";
import { useVirtualizer } from "@tanstack/react-virtual";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { useTimelineState } from "@/hooks/useTimelineState";
import { TimelineCoachPanels } from "@/pages/timeline/TimelineCoachPanels";
import { TimelineContent } from "@/pages/timeline/TimelineContent";
import { TimelineWorkoutSurfaces } from "@/pages/timeline/TimelineWorkoutSurfaces";
import { useBulkDeleteSelection } from "@/pages/timeline/useBulkDeleteSelection";
import { useEmbeddedCoachRouting } from "@/pages/timeline/useEmbeddedCoachRouting";
import { useTimelineDialogState } from "@/pages/timeline/useTimelineDialogState";
import { useTimelinePageController } from "@/pages/timeline/useTimelinePageController";
import { useTimelineSurfaceSelection } from "@/pages/timeline/useTimelineSurfaceSelection";

export default function Timeline() {
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
  const {
    csvPreview,
    setCsvPreview,
    schedulingPlanId,
    setSchedulingPlanId,
    startDate,
    setStartDate,
    fileInputRef,
    handleFileUpload,
    confirmImport,
    importMutation,
    samplePlanMutation,
    renamePlanMutation,
    schedulePlanMutation,
    updatePlanGoalMutation,
  } = planImport;
  const {
    skipConfirmEntry,
    setSkipConfirmEntry,
    handleMarkComplete,
    handleChangeStatus,
    handleDelete,
    confirmSkip,
    logWorkoutMutation,
    bulkDeleteWorkoutMutation,
  } = workoutActions;
  const {
    combiningEntry,
    setCombiningEntry,
    combineSecondEntry,
    setCombineSecondEntry,
    showCombineDialog,
    setShowCombineDialog,
    handleCombine,
    handleConfirmCombine,
    combineWorkoutsMutation,
  } = combine;
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialTodayScrollKeyRef = useRef<string | null>(null);
  const {
    previewEntry,
    setPreviewEntry,
    futureEditEntry,
    setFutureEditEntry,
    logEntry,
    setLogEntry,
    reviewEntry,
    setReviewEntry,
    skippedEntry,
    setSkippedEntry,
    openSurface,
    closeAllSurfacesAndClearUrl,
  } = useTimelineSurfaceSelection(timelineData);
  const [adhocOpen, setAdhocOpen] = useState(false);
  const {
    showAIConsent,
    setShowAIConsent,
    annotationsDialogOpen,
    setAnnotationsDialogOpen,
    annotationInitialDate,
    setAnnotationInitialDate,
    handleAddAnnotation,
    handleEditAnnotation,
  } = useTimelineDialogState();
  const {
    embeddedCoachEntryId,
    embeddedCoachSeedText,
    embeddedCoachSeedNonce,
    mobileCoachPanelOpen,
    handleCoachToggle,
    openEmbeddedCoach,
    closeEmbeddedCoach,
    closeWorkoutSurfaces,
    openTimelineSurface,
    showMobileCoachPanel,
    showWorkoutDetails,
    clearPendingCoachIntent,
    handleAIConsentAccept,
  } = useEmbeddedCoachRouting({
    aiCoachEnabled,
    isAuthUserLoaded,
    setCoachOpen,
    setShowAIConsent,
    openSurface,
    closeAllSurfacesAndClearUrl,
    toast,
  });

  const { annotationsByDate, moveEntry, isMoving, handleDeleteAnnotation, isAnnotationDeleting } =
    useTimelinePageController(selectedPlanId, annotations);

  const allVisibleGroups = useMemo(() => {
    return [...visiblePastGroups.slice().reverse(), ...visibleFutureGroups];
  }, [visiblePastGroups, visibleFutureGroups]);

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

    rowVirtualizer.scrollToIndex(todayIndex, { align: "start", behavior: "smooth" });
  }, [allVisibleGroups, rowVirtualizer, scrollToToday]);

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

    const timerId = setTimeout(() => {
      rowVirtualizer.scrollToIndex(todayIndex, { align: "center", behavior: "smooth" });
      initialTodayScrollKeyRef.current = scrollKey;
    }, SCROLL_TO_TODAY_DELAY_MS);

    return () => clearTimeout(timerId);
  }, [allVisibleGroups, rowVirtualizer, selectedPlanId, timelineLoading]);

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
              onRenamePlan={(planId, name) => renamePlanMutation.mutate({ planId, name })}
              isRenaming={renamePlanMutation.isPending}
              onGoalSave={(planId, goal) => updatePlanGoalMutation.mutate({ planId, goal })}
              isUpdatingGoal={updatePlanGoalMutation.isPending}
              onScheduleClick={(planId) => setSchedulingPlanId(planId)}
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

            <DndContext sensors={dragSensors} onDragEnd={handleDragEnd}>
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
              schedulingPlanId={schedulingPlanId}
              setSchedulingPlanId={setSchedulingPlanId}
              startDate={startDate}
              setStartDate={setStartDate}
              schedulePlanMutation={schedulePlanMutation}
              previewEntry={previewEntry}
              setPreviewEntry={setPreviewEntry}
              futureEditEntry={futureEditEntry}
              setFutureEditEntry={setFutureEditEntry}
              logEntry={logEntry}
              setLogEntry={setLogEntry}
              reviewEntry={reviewEntry}
              setReviewEntry={setReviewEntry}
              skippedEntry={skippedEntry}
              setSkippedEntry={setSkippedEntry}
              closeWorkoutSurfaces={closeWorkoutSurfaces}
              closeEmbeddedCoach={closeEmbeddedCoach}
              openEmbeddedCoach={openEmbeddedCoach}
              embeddedCoachEntryId={embeddedCoachEntryId}
              embeddedCoachSeedNonce={embeddedCoachSeedNonce}
              embeddedCoachSeedText={embeddedCoachSeedText}
              mobileCoachPanelOpen={mobileCoachPanelOpen}
              onCloseCoachChat={closeEmbeddedCoach}
              onShowCoachPanel={showMobileCoachPanel}
              onShowWorkoutDetails={showWorkoutDetails}
              setSkipConfirmEntry={setSkipConfirmEntry}
              skipConfirmEntry={skipConfirmEntry}
              handleMarkComplete={handleMarkComplete}
              handleChangeStatus={handleChangeStatus}
              handleDelete={handleDelete}
              confirmSkip={confirmSkip}
              logWorkoutMutation={logWorkoutMutation}
              csvPreview={csvPreview}
              setCsvPreview={setCsvPreview}
              confirmImport={confirmImport}
              importMutation={importMutation}
              showCombineDialog={showCombineDialog}
              setShowCombineDialog={setShowCombineDialog}
              combiningEntry={combiningEntry}
              setCombiningEntry={setCombiningEntry}
              combineSecondEntry={combineSecondEntry}
              setCombineSecondEntry={setCombineSecondEntry}
              handleConfirmCombine={handleConfirmCombine}
              combineWorkoutsMutation={combineWorkoutsMutation}
              annotationsDialogOpen={annotationsDialogOpen}
              setAnnotationsDialogOpen={setAnnotationsDialogOpen}
              annotationInitialDate={annotationInitialDate}
              setAnnotationInitialDate={setAnnotationInitialDate}
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
