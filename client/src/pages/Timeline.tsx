import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { ExerciseSet, TimelineAnnotation, TimelineEntry } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
import type { Virtualizer } from "@tanstack/react-virtual";
import { useVirtualizer } from "@tanstack/react-virtual";
import { format,isToday, parseISO } from "date-fns";
import {
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useCallback,useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";

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
import { WorkoutDetailDialogV2 } from "@/components/workout-detail/WorkoutDetailDialogV2";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { saveLogWorkoutDraftFromTimelineEntry } from "@/hooks/useLogWorkoutDraft";
import { useMoveTimelineEntry } from "@/hooks/useMoveTimelineEntry";
import { useTimelineState } from "@/hooks/useTimelineState";
import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

type TimelineState = ReturnType<typeof useTimelineState>;
type TimelineData = TimelineState["data"];
type TimelineFiltersState = TimelineState["filters"];
type PlanImportState = TimelineState["planImport"];

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
  openDetailDialog: (entry: Parameters<ReturnType<typeof useTimelineState>["workoutActions"]["openDetailDialog"]>[0]) => void;
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
  openDetailDialog,
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
          Show {hiddenPastCount} more past workout{hiddenPastCount > 1 ? 's' : ''}
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

      <div style={{ position: 'relative' }}>
        <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const [date, entries] = allVisibleGroups[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
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
                  onClick={openDetailDialog}
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
          Show {hiddenFutureCount} more upcoming workout{hiddenFutureCount > 1 ? 's' : ''}
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
  const { user } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [, setLocation] = useLocation();
  const { data, filters, onboarding, planImport, workoutActions, combine, selectedPlanId, setSelectedPlanId } = useTimelineState({ aiCoachEnabled: !!user?.aiCoachEnabled });

  const { plans, plansLoading, personalRecords, timelineData, timelineLoading, annotations, isNewUser, todayRef, scrollToToday } = data;
  const { filterStatus, setFilterStatus, showAllPast, setShowAllPast, showAllFuture, setShowAllFuture, pastGroups, futureGroups, visiblePastGroups, visibleFutureGroups, hiddenPastCount, hiddenFutureCount } = filters;
  const { showOnboarding, coachOpen, setCoachOpen, handleOnboardingComplete } = onboarding;
  const { csvPreview, setCsvPreview, schedulingPlanId, setSchedulingPlanId, startDate, setStartDate, fileInputRef, handleFileUpload, confirmImport, importMutation, samplePlanMutation, renamePlanMutation, schedulePlanMutation, updatePlanGoalMutation } = planImport;
  const { detailEntry, setDetailEntry, skipConfirmEntry, setSkipConfirmEntry, openDetailDialog, handleMarkComplete, handleChangeStatus, handleDelete, confirmSkip, logWorkoutMutation } = workoutActions;
  const { combiningEntry, setCombiningEntry, combineSecondEntry, setCombineSecondEntry, showCombineDialog, setShowCombineDialog, handleCombine, handleConfirmCombine, combineWorkoutsMutation } = combine;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showAIConsent, setShowAIConsent] = useState(false);
  const [annotationsDialogOpen, setAnnotationsDialogOpen] = useState(false);
  // Seeds the create form in AnnotationsDialog when the user clicks a row's
  // inline "+ Note" chip, so they don't have to re-pick the date.
  const [annotationInitialDate, setAnnotationInitialDate] = useState<string | undefined>(undefined);

  // Gate the AI Coach behind an explicit consent prompt when the user has
  // not yet opted in (aiCoachEnabled defaults to false for new users).
  const handleCoachToggle = useCallback((open: boolean) => {
    if (open && user && !user.aiCoachEnabled) {
      setShowAIConsent(true);
      return;
    }
    setCoachOpen(open);
  }, [user, setCoachOpen]);

  const handleAIConsentAccept = useCallback(() => {
    setShowAIConsent(false);
    api.preferences.update({ aiCoachEnabled: true })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.authUser }).catch(() => {});
        setCoachOpen(true);
      })
      .catch(() => {
        toast({ title: "Could not enable AI Coach", description: "Please try again." });
      });
  }, [setCoachOpen, toast]);

  const handleOpenLogWorkout = useCallback((entry: TimelineEntry, exerciseSets: ExerciseSet[]) => {
    saveLogWorkoutDraftFromTimelineEntry(user?.id ?? "anon", entry, exerciseSets);
    setDetailEntry(null);
    setLocation("/log");
  }, [setDetailEntry, setLocation, user?.id]);

  // O(1) lookup by start date for the virtualized row renderer. Rebuilds
  // only when the annotations array itself changes.
  const annotationsByDate = useMemo(() => {
    return annotations.reduce<Record<string, TimelineAnnotation[]>>((acc, annotation) => {
      if (!acc[annotation.startDate]) {
        acc[annotation.startDate] = [];
      }
      acc[annotation.startDate].push(annotation);
      return acc;
    }, {});
  }, [annotations]);

  // Inline-delete mutation for annotation cards. Mirrors the invalidation
  // set in AnnotationsDialog so the Analytics chart bands stay in sync.
  const deleteAnnotationMutation = useMutation({
    mutationFn: (id: string) => api.timelineAnnotations.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timelineAnnotations }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.trainingOverview }).catch(() => {});
      toast({ title: "Annotation removed" });
    },
    onError: () =>
      toast({
        title: "Couldn't delete annotation",
        description: "Please try again.",
        variant: "destructive",
      }),
  });

  const handleAddAnnotation = useCallback((date: string) => {
    setAnnotationInitialDate(date);
    setAnnotationsDialogOpen(true);
  }, []);

  // Edit just opens the dialog (scoped to the existing list). The dialog
  // does not yet support per-entry edit mode — users delete and re-create.
  const handleEditAnnotation = useCallback((_annotation: TimelineAnnotation) => {
    setAnnotationInitialDate(undefined);
    setAnnotationsDialogOpen(true);
  }, []);

  const handleDeleteAnnotation = useCallback((id: string) => {
    deleteAnnotationMutation.mutate(id);
  }, [deleteAnnotationMutation]);

  const allVisibleGroups = useMemo(() => {
    return [...visiblePastGroups.slice().reverse(), ...visibleFutureGroups];
  }, [visiblePastGroups, visibleFutureGroups]);

  const { moveEntry, isMoving } = useMoveTimelineEntry(selectedPlanId);

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

    if (todayIndex >= 0) {
      rowVirtualizer.scrollToIndex(todayIndex, { align: 'start', behavior: 'smooth' });
    } else {
      scrollToToday();
    }
  }, [allVisibleGroups, rowVirtualizer, scrollToToday]);




  return (
    <>
      <OnboardingWizard
        open={showOnboarding}
        onComplete={handleOnboardingComplete}
      />
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

          <CoachReviewingIndicator isActive={!!user?.isAutoCoaching} />

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
          openDetailDialog={openDetailDialog}
          handleCombine={handleCombine}
          combiningEntry={combiningEntry}
          personalRecords={personalRecords}
          isAutoCoaching={!!user?.isAutoCoaching}
          annotationsByDate={annotationsByDate}
          onAddAnnotation={handleAddAnnotation}
          onEditAnnotation={handleEditAnnotation}
          onDeleteAnnotation={handleDeleteAnnotation}
          isAnnotationDeleting={deleteAnnotationMutation.isPending}
          onMoveEntry={moveEntry}
          isMovingEntry={isMoving}
        />
      </DndContext>

          {!detailEntry && (
            <FloatingActionButton coachPanelOpen={coachOpen} onCoachToggle={() => handleCoachToggle(!coachOpen)} />
          )}

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

          <WorkoutDetailDialogV2
            entry={detailEntry}
            onClose={() => setDetailEntry(null)}
            onDelete={handleDelete}
            onChangeStatus={(entry, status) => {
              handleChangeStatus(entry, status);
              setDetailEntry(null);
            }}
            onMarkComplete={handleMarkComplete}
            onOpenLogWorkout={handleOpenLogWorkout}
            isMarkingComplete={logWorkoutMutation.isPending}
            onCombine={(entry) => {
              setDetailEntry(null);
              handleCombine(entry);
            }}
            weightUnit={user?.weightUnit === "lbs" ? "lb" : "kg"}
            distanceUnit={user?.distanceUnit === "miles" ? "miles" : "km"}
            // Close the global coach rail when the in-dialog chat
            // opens so the two chat surfaces never coexist with
            // independent session state (see the comment in the
            // dialog's onOpenChat handler).
            onAskCoachOpen={() => setCoachOpen(false)}
            // Gate Ask-coach on the same AI-coach consent that the
            // global FAB flow runs through `handleCoachToggle`.
            // Users who haven't opted in get the AIConsentDialog
            // instead of the chat auto-opening.
            aiCoachEnabled={!!user?.aiCoachEnabled}
            onRequestCoachConsent={() => setShowAIConsent(true)}
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
        <div className={detailEntry ? "hidden" : "w-80 lg:w-96 flex-shrink-0"}>
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
        // Mobile coach surface: a bottom sheet at ~70vh so the user can still
        // see the top of their timeline while chatting with the coach.
        // Hidden (display:none) rather than unmounted while a workout detail
        // is open so in-flight chat streams and local message state survive.
        <div className={detailEntry ? "hidden" : "fixed inset-x-0 bottom-0 z-50 h-[70vh]"}>
          <div
            data-testid="coach-panel-mobile-sheet"
            className="relative h-full bg-background shadow-2xl rounded-t-2xl border-t border-x"
          >
            <div className="flex items-center justify-center pt-2" aria-hidden="true">
              <div className="h-1 w-10 rounded-full bg-muted-foreground/40" />
            </div>
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
        onDecline={() => setShowAIConsent(false)}
      />
    </div>
    </>
  );
}
