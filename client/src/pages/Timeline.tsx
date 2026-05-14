import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { TimelineAnnotation, TimelineEntry } from "@shared/schema";
import type { Virtualizer } from "@tanstack/react-virtual";
import { useVirtualizer } from "@tanstack/react-virtual";
import { format, isToday, parseISO } from "date-fns";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { AIConsentDialog } from "@/components/coach/AIConsentDialog";
import { CoachPanel } from "@/components/CoachPanel";
import { FeatureErrorBoundaryWrapper } from "@/components/FeatureErrorBoundaryWrapper";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import {
  AnnotationsDialog,
  CoachReviewingIndicator,
  CombineWorkoutsDialog,
  FloatingActionButton,
  ImportPreviewDialog,
  SchedulePlanDialog,
  SkipConfirmDialog,
  TimelineDateGroup,
  TimelineEmptyState,
  TimelineFilters,
  TimelineHeader,
  TimelineSkeleton,
  TimelineTodayIndicator,
} from "@/components/timeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdhocLogSheet } from "@/components/workout-detail/AdhocLogSheet";
import { LogSheet } from "@/components/workout-detail/LogSheet";
import { PreviewSheet } from "@/components/workout-detail/PreviewSheet";
import { ReviewSurface } from "@/components/workout-detail/ReviewSurface";
import { SkippedSheet } from "@/components/workout-detail/SkippedSheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { useIsAiCoachEnabled, useIsAuthUserLoaded, useIsAutoCoaching } from "@/hooks/useAuth";
import { useTimelineState } from "@/hooks/useTimelineState";
import { useEmbeddedCoachRouting } from "@/pages/timeline/useEmbeddedCoachRouting";
import { useTimelineDialogState } from "@/pages/timeline/useTimelineDialogState";
import { useTimelinePageController } from "@/pages/timeline/useTimelinePageController";
import { useTimelineSurfaceSelection } from "@/pages/timeline/useTimelineSurfaceSelection";

// Click-routing for timeline cards: PreviewSheet (future planned),
// LogSheet (today/past planned), ReviewSurface (already logged),
// SkippedSheet (status=skipped). One sheet per status; click events
// in TimelineWorkoutCard call openSurface which classifies the entry
// and opens the right one.

type TimelineState = ReturnType<typeof useTimelineState>;
type TimelineData = TimelineState["data"];
type TimelineFiltersState = TimelineState["filters"];
type PlanImportState = TimelineState["planImport"];

function isMobileCoachPanelActive(
  isMobile: boolean,
  entry: TimelineEntry | null,
  embeddedCoachEntryId: string | null,
  mobileCoachPanelOpen: boolean,
): boolean {
  return Boolean(isMobile && mobileCoachPanelOpen && embeddedCoachEntryId === entry?.id);
}

interface TimelineContentProps {
  timelineLoading: TimelineData["timelineLoading"];
  filterStatus: TimelineFiltersState["filterStatus"];
  selectedPlanId: TimelineState["selectedPlanId"];
  plans: TimelineData["plans"];
  samplePlanMutation: PlanImportState["samplePlanMutation"];
  importMutation: PlanImportState["importMutation"];
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  setSchedulingPlanId: PlanImportState["setSchedulingPlanId"];
  setFilterStatus: TimelineFiltersState["setFilterStatus"];
  hiddenPastCount: TimelineFiltersState["hiddenPastCount"];
  setShowAllPast: TimelineFiltersState["setShowAllPast"];
  showAllPast: TimelineFiltersState["showAllPast"];
  pastGroups: TimelineFiltersState["pastGroups"];
  hiddenFutureCount: TimelineFiltersState["hiddenFutureCount"];
  setShowAllFuture: TimelineFiltersState["setShowAllFuture"];
  showAllFuture: TimelineFiltersState["showAllFuture"];
  futureGroups: TimelineFiltersState["futureGroups"];
  allVisibleGroups: TimelineFiltersState["pastGroups"];
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>;
  todayRef: TimelineData["todayRef"];
  handleMarkComplete: ReturnType<typeof useTimelineState>["workoutActions"]["handleMarkComplete"];
  onCardClick: (entry: TimelineEntry) => void;
  handleCombine: ReturnType<typeof useTimelineState>["combine"]["handleCombine"];
  combiningEntry: ReturnType<typeof useTimelineState>["combine"]["combiningEntry"];
  personalRecords: TimelineData["personalRecords"];
  isAutoCoaching: boolean;
  annotationsByDate: Record<string, TimelineAnnotation[]>;
  onAddAnnotation: (date: string) => void;
  onEditAnnotation: (annotation: TimelineAnnotation) => void;
  onDeleteAnnotation: (id: string) => void;
  isAnnotationDeleting: boolean;
  onMoveEntry: (entry: TimelineEntry, newDate: string) => void;
  isMovingEntry: boolean;
}

function TimelineContent({
  timelineLoading,
  filterStatus,
  selectedPlanId,
  plans,
  samplePlanMutation,
  importMutation,
  handleFileUpload,
  setSchedulingPlanId,
  setFilterStatus,
  hiddenPastCount,
  setShowAllPast,
  showAllPast,
  pastGroups,
  hiddenFutureCount,
  setShowAllFuture,
  showAllFuture,
  futureGroups,
  allVisibleGroups,
  rowVirtualizer,
  todayRef,
  handleMarkComplete,
  onCardClick,
  handleCombine,
  combiningEntry,
  personalRecords,
  isAutoCoaching,
  annotationsByDate,
  onAddAnnotation,
  onEditAnnotation,
  onDeleteAnnotation,
  isAnnotationDeleting,
  onMoveEntry,
  isMovingEntry,
}: Readonly<TimelineContentProps>) {
  if (timelineLoading) {
    return <TimelineSkeleton />;
  }

  // Short-circuit to the empty state only when there is literally nothing
  // to render. `allVisibleGroups` already includes annotation-only rows
  // (see `useTimelineFilters`), so a user with notes but no matching
  // workouts — or with a status filter that removes all workouts — still
  // sees their annotation cards instead of being shunted to the empty
  // state. `filteredTimeline.length === 0` is not sufficient on its own
  // because it only reflects workout entries.
  if (allVisibleGroups.length === 0) {
    return (
      <TimelineEmptyState
        filterStatus={filterStatus}
        selectedPlanId={selectedPlanId}
        plans={plans}
        samplePlanMutation={samplePlanMutation}
        importMutation={importMutation}
        handleFileUpload={handleFileUpload}
        setSchedulingPlanId={setSchedulingPlanId}
        setFilterStatus={setFilterStatus}
        onLogNote={() => onAddAnnotation(format(new Date(), "yyyy-MM-dd"))}
      />
    );
  }

  return (
    <div className="space-y-4">
      {hiddenPastCount > 0 && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setShowAllPast(true)}
          data-testid="button-show-more-past"
        >
          <ChevronUp className="h-4 w-4 mr-2" />
          Show {hiddenPastCount} more past workout{hiddenPastCount > 1 ? "s" : ""}
        </Button>
      )}

      {showAllPast && pastGroups.length > 7 && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => setShowAllPast(false)}
          data-testid="button-hide-past"
        >
          Hide older workouts
        </Button>
      )}

      <div style={{ position: "relative" }}>
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const [date, entries] = allVisibleGroups[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
              >
                <TimelineDateGroup
                  key={date}
                  ref={isToday(parseISO(date)) ? todayRef : undefined}
                  date={date}
                  entries={entries}
                  annotations={annotationsByDate[date]}
                  onMarkComplete={handleMarkComplete}
                  onClick={onCardClick}
                  onCombineSelect={handleCombine}
                  isCombining={!!combiningEntry}
                  combiningEntryId={combiningEntry?.id || null}
                  combiningEntryDate={combiningEntry?.date || null}
                  personalRecords={personalRecords}
                  isAutoCoaching={isAutoCoaching}
                  onAddAnnotation={onAddAnnotation}
                  onEditAnnotation={onEditAnnotation}
                  onDeleteAnnotation={onDeleteAnnotation}
                  isAnnotationDeleting={isAnnotationDeleting}
                  onMoveEntry={onMoveEntry}
                  isMovingEntry={isMovingEntry}
                />
              </div>
            );
          })}
        </div>
      </div>

      {hiddenFutureCount > 0 && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setShowAllFuture(true)}
          data-testid="button-show-more-future"
        >
          <ChevronDown className="h-4 w-4 mr-2" />
          Show {hiddenFutureCount} more upcoming workout{hiddenFutureCount > 1 ? "s" : ""}
        </Button>
      )}

      {showAllFuture && futureGroups.length > 7 && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => setShowAllFuture(false)}
          data-testid="button-hide-future"
        >
          Hide later workouts
        </Button>
      )}
    </div>
  );
}

export default function Timeline() {
  // Keep Timeline off the full auth object while auto-coach polling is active.
  const aiCoachEnabled = useIsAiCoachEnabled();
  const isAutoCoaching = useIsAutoCoaching();
  const isAuthUserLoaded = useIsAuthUserLoaded();
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
  } = useTimelineState({ aiCoachEnabled, isAuthUserLoaded });

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

  // Require a small activation distance on pointer drag so clicking the
  // drag handle to open a tooltip / focus it doesn't accidentally pick
  // the card up. The DnD only engages after the user moves >6px, which
  // matches the shadcn grip-handle UX in ExerciseTable.
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

  // Whether today's date is in the currently-filtered/visible groups.
  // Passed to TimelineTodayIndicator so the "Jump to today" pill stays
  // hidden when the active filter excludes today — otherwise a stale
  // observer position could surface a dead jump action.
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
        <div ref={scrollRef} className="flex-1 overflow-auto p-4 md:p-8 relative">
          <div className="max-w-5xl mx-auto space-y-6">
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
              />
            </DndContext>

            {!previewEntry &&
              !futureEditEntry &&
              !logEntry &&
              !reviewEntry &&
              !skippedEntry &&
              !adhocOpen && (
                <FloatingActionButton
                  coachPanelOpen={coachOpen}
                  onCoachToggle={() => handleCoachToggle(!coachOpen)}
                  onLogWorkout={() => setAdhocOpen(true)}
                />
              )}

            <AdhocLogSheet open={adhocOpen} onClose={() => setAdhocOpen(false)} />

            <SchedulePlanDialog
              open={!!schedulingPlanId}
              onOpenChange={(open) => !open && setSchedulingPlanId(null)}
              startDate={startDate}
              onStartDateChange={setStartDate}
              onSchedule={() =>
                schedulingPlanId &&
                schedulePlanMutation.mutate({ planId: schedulingPlanId, startDate })
              }
              isPending={schedulePlanMutation.isPending}
            />

            <LogSheet
              entry={logEntry}
              onClose={closeWorkoutSurfaces}
              isLogging={logWorkoutMutation.isPending}
              onLogAsPlanned={(entry, rpeOverride) => {
                closeEmbeddedCoach();
                setLogEntry(null);
                // Only fan a fresh entry through when RPE actually
                // changed so we don't churn the cache for a no-op.
                if (rpeOverride === entry.rpe) {
                  handleMarkComplete(entry);
                } else {
                  handleMarkComplete({ ...entry, rpe: rpeOverride ?? null });
                }
              }}
              onSkip={(entry) => {
                closeEmbeddedCoach();
                setLogEntry(null);
                setSkipConfirmEntry(entry);
              }}
              onAskCoach={openEmbeddedCoach}
              coachChatOpen={embeddedCoachEntryId === logEntry?.id}
              coachChatNonce={embeddedCoachSeedNonce}
              coachSeedText={embeddedCoachSeedText}
              mobileCoachPanelOpen={isMobileCoachPanelActive(isMobile, logEntry, embeddedCoachEntryId, mobileCoachPanelOpen)}
              onCloseCoachChat={closeEmbeddedCoach}
              onShowCoachPanel={showMobileCoachPanel}
              onShowWorkoutDetails={showWorkoutDetails}
            />

            <LogSheet
              mode="edit"
              entry={futureEditEntry}
              onClose={closeWorkoutSurfaces}
              onSkip={(entry) => {
                closeEmbeddedCoach();
                setFutureEditEntry(null);
                setSkipConfirmEntry(entry);
              }}
              onAskCoach={openEmbeddedCoach}
              coachChatOpen={embeddedCoachEntryId === futureEditEntry?.id}
              coachChatNonce={embeddedCoachSeedNonce}
              coachSeedText={embeddedCoachSeedText}
              mobileCoachPanelOpen={isMobileCoachPanelActive(isMobile, futureEditEntry, embeddedCoachEntryId, mobileCoachPanelOpen)}
              onCloseCoachChat={closeEmbeddedCoach}
              onShowCoachPanel={showMobileCoachPanel}
              onShowWorkoutDetails={showWorkoutDetails}
            />

            <SkippedSheet
              key={skippedEntry?.id ?? "skipped-sheet"}
              entry={skippedEntry}
              onClose={closeWorkoutSurfaces}
              onAskCoach={openEmbeddedCoach}
              coachChatOpen={embeddedCoachEntryId === skippedEntry?.id}
              coachChatNonce={embeddedCoachSeedNonce}
              coachSeedText={embeddedCoachSeedText}
              mobileCoachPanelOpen={isMobileCoachPanelActive(isMobile, skippedEntry, embeddedCoachEntryId, mobileCoachPanelOpen)}
              onCloseCoachChat={closeEmbeddedCoach}
              onShowCoachPanel={showMobileCoachPanel}
              onShowWorkoutDetails={showWorkoutDetails}
              onUndoSkip={(entry) => {
                closeEmbeddedCoach();
                setSkippedEntry(null);
                handleChangeStatus(entry, "planned");
              }}
              onDelete={(entry) => {
                closeEmbeddedCoach();
                setSkippedEntry(null);
                handleDelete(entry);
              }}
            />

            <ReviewSurface
              key={reviewEntry?.id ?? "review-surface"}
              entry={reviewEntry}
              onClose={closeWorkoutSurfaces}
              onAskCoach={openEmbeddedCoach}
              coachChatOpen={embeddedCoachEntryId === reviewEntry?.id}
              coachChatNonce={embeddedCoachSeedNonce}
              coachSeedText={embeddedCoachSeedText}
              mobileCoachPanelOpen={isMobileCoachPanelActive(isMobile, reviewEntry, embeddedCoachEntryId, mobileCoachPanelOpen)}
              onCloseCoachChat={closeEmbeddedCoach}
              onShowCoachPanel={showMobileCoachPanel}
              onShowWorkoutDetails={showWorkoutDetails}
              onMarkPlanned={(entry) => {
                closeEmbeddedCoach();
                setReviewEntry(null);
                handleChangeStatus(entry, "planned");
              }}
              onDelete={(entry) => {
                closeEmbeddedCoach();
                setReviewEntry(null);
                handleDelete(entry);
              }}
            />

            <PreviewSheet
              entry={previewEntry}
              onClose={closeWorkoutSurfaces}
              onAskCoach={openEmbeddedCoach}
              coachChatOpen={embeddedCoachEntryId === previewEntry?.id}
              coachChatNonce={embeddedCoachSeedNonce}
              coachSeedText={embeddedCoachSeedText}
              mobileCoachPanelOpen={isMobileCoachPanelActive(isMobile, previewEntry, embeddedCoachEntryId, mobileCoachPanelOpen)}
              onCloseCoachChat={closeEmbeddedCoach}
              onShowCoachPanel={showMobileCoachPanel}
              onShowWorkoutDetails={showWorkoutDetails}
              onMove={() => {
                closeEmbeddedCoach();
                setPreviewEntry(null);
                // The card owns the move affordance, so close the sheet and point there.
                toast({
                  title: "Use the move icon on the card",
                  description: "Drag, or use the calendar menu in the card's top corner.",
                });
              }}
              onSkip={(entry) => {
                closeEmbeddedCoach();
                setPreviewEntry(null);
                setSkipConfirmEntry(entry);
              }}
              onEditWorkout={(entry) => {
                closeEmbeddedCoach();
                setPreviewEntry(null);
                setFutureEditEntry(entry);
              }}
            />

            <SkipConfirmDialog
              entry={skipConfirmEntry}
              onOpenChange={() => setSkipConfirmEntry(null)}
              onConfirm={confirmSkip}
            />

            <ImportPreviewDialog
              preview={csvPreview}
              onOpenChange={() => setCsvPreview(null)}
              onConfirm={confirmImport}
              isPending={importMutation.isPending}
            />

            <CombineWorkoutsDialog
              open={showCombineDialog}
              onOpenChange={(open) => {
                setShowCombineDialog(open);
                if (!open) {
                  setCombiningEntry(null);
                  setCombineSecondEntry(null);
                }
              }}
              entry1={combiningEntry}
              entry2={combineSecondEntry}
              onConfirm={handleConfirmCombine}
              isPending={combineWorkoutsMutation.isPending}
            />

            <AnnotationsDialog
              open={annotationsDialogOpen}
              onOpenChange={(open) => {
                setAnnotationsDialogOpen(open);
                if (!open) {
                  setAnnotationInitialDate(undefined);
                }
              }}
              initialDate={annotationInitialDate}
            />
          </div>
        </div>

        {coachOpen && !isMobile && (
          <div
            className={
              previewEntry ||
              futureEditEntry ||
              logEntry ||
              reviewEntry ||
              skippedEntry ||
              adhocOpen
                ? "hidden"
                : "w-80 lg:w-96 flex-shrink-0"
            }
          >
            <FeatureErrorBoundaryWrapper featureName="Coach">
              <CoachPanel
                isOpen={coachOpen}
                onClose={() => setCoachOpen(false)}
                timeline={timelineData}
                isNewUser={isNewUser}
              />
            </FeatureErrorBoundaryWrapper>
          </div>
        )}

        {coachOpen && isMobile && (
          // Hide instead of unmounting so in-flight chat streams survive detail sheets.
          <div
            className={
              previewEntry ||
              futureEditEntry ||
              logEntry ||
              reviewEntry ||
              skippedEntry ||
              adhocOpen
                ? "hidden"
                : "fixed inset-0 z-50 h-[100dvh]"
            }
          >
            <div
              data-testid="coach-panel-mobile-sheet"
              className="relative h-full bg-background shadow-2xl"
            >
              <FeatureErrorBoundaryWrapper featureName="Coach">
                <CoachPanel
                  isOpen={coachOpen}
                  onClose={() => setCoachOpen(false)}
                  timeline={timelineData}
                  isNewUser={isNewUser}
                />
              </FeatureErrorBoundaryWrapper>
            </div>
          </div>
        )}

        <AIConsentDialog
          open={showAIConsent}
          onAccept={handleAIConsentAccept}
          onDecline={clearPendingCoachIntent}
        />
      </div>
    </>
  );
}
