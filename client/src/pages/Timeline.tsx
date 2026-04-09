import type { Virtualizer } from "@tanstack/react-virtual";
import { useVirtualizer } from "@tanstack/react-virtual";
import { format,isToday, parseISO } from "date-fns";
import {
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useCallback,useMemo, useRef } from "react";

import { CoachPanel } from "@/components/CoachPanel";
import { FeatureErrorBoundaryWrapper } from "@/components/FeatureErrorBoundaryWrapper";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import {
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
  WorkoutDetailDialog,
} from "@/components/timeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useTimelineState } from "@/hooks/useTimelineState";

type TimelineState = ReturnType<typeof useTimelineState>;
type TimelineData = TimelineState["data"];
type TimelineFiltersState = TimelineState["filters"];
type PlanImportState = TimelineState["planImport"];

interface TimelineContentProps {
  timelineLoading: TimelineData["timelineLoading"];
  filteredTimeline: TimelineFiltersState["filteredTimeline"];
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
}

function TimelineContent({
  timelineLoading,
  filteredTimeline,
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
}: Readonly<TimelineContentProps>) {
  if (timelineLoading) {
    return <TimelineSkeleton />;
  }

  if (filteredTimeline.length === 0) {
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
                  onMarkComplete={handleMarkComplete}
                  onClick={openDetailDialog}
                  onCombineSelect={handleCombine}
                  isCombining={!!combiningEntry}
                  combiningEntryId={combiningEntry?.id || null}
                  combiningEntryDate={combiningEntry?.date || null}
                  personalRecords={personalRecords}
                  isAutoCoaching={isAutoCoaching}
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
  const { data, filters, onboarding, planImport, workoutActions, combine, selectedPlanId, setSelectedPlanId } = useTimelineState();

  const { plans, plansLoading, personalRecords, timelineData, timelineLoading, isNewUser, todayRef, scrollToToday } = data;
  const { filterStatus, setFilterStatus, showAllPast, setShowAllPast, showAllFuture, setShowAllFuture, filteredTimeline, pastGroups, futureGroups, visiblePastGroups, visibleFutureGroups, hiddenPastCount, hiddenFutureCount } = filters;
  const { showOnboarding, coachOpen, setCoachOpen, handleOnboardingComplete } = onboarding;
  const { csvPreview, setCsvPreview, schedulingPlanId, setSchedulingPlanId, startDate, setStartDate, fileInputRef, handleFileUpload, confirmImport, importMutation, samplePlanMutation, renamePlanMutation, schedulePlanMutation, updatePlanGoalMutation } = planImport;
  const { detailEntry, setDetailEntry, skipConfirmEntry, setSkipConfirmEntry, openDetailDialog, handleSaveFromDetail, handleMarkComplete, handleChangeStatus, handleDelete, confirmSkip, updateDayMutation, logWorkoutMutation, updateWorkoutMutation, deleteWorkoutMutation, deletePlanDayMutation } = workoutActions;
  const { combiningEntry, setCombiningEntry, combineSecondEntry, setCombineSecondEntry, showCombineDialog, setShowCombineDialog, handleCombine, handleConfirmCombine, combineWorkoutsMutation } = combine;
  const { user } = useAuth();
  const scrollRef = useRef<HTMLDivElement>(null);

  const allVisibleGroups = useMemo(() => {
    return [...visiblePastGroups.slice().reverse(), ...visibleFutureGroups];
  }, [visiblePastGroups, visibleFutureGroups]);

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
          <TimelineHeader
            onScrollToToday={handleScrollToToday}
          />

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
      />

      <TimelineContent
        timelineLoading={timelineLoading}
        filteredTimeline={filteredTimeline}
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
      />

          <FloatingActionButton coachPanelOpen={coachOpen} onCoachToggle={() => setCoachOpen(!coachOpen)} />

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

          <WorkoutDetailDialog
            entry={detailEntry}
            onClose={() => setDetailEntry(null)}
            onMarkComplete={(entry) => {
              handleMarkComplete(entry);
              setDetailEntry(null);
            }}
            onChangeStatus={(entry, status) => {
              handleChangeStatus(entry, status);
              setDetailEntry(null);
            }}
            onSave={handleSaveFromDetail}
            onDelete={handleDelete}
            onCombine={(entry) => {
              setDetailEntry(null);
              handleCombine(entry);
            }}
            isSaving={updateDayMutation.isPending || updateWorkoutMutation.isPending || logWorkoutMutation.isPending}
            isDeleting={deleteWorkoutMutation.isPending || deletePlanDayMutation.isPending}
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
        </div>
      </div>
      
      {coachOpen && (
        <div className="w-80 lg:w-96 flex-shrink-0 hidden md:block">
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
      
      {coachOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-background/80 backdrop-blur-sm w-full h-full border-none p-0 focus:outline-none cursor-pointer"
            onClick={() => setCoachOpen(false)}
            aria-label="Close coach panel"
          />
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-sm bg-background shadow-lg">
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
    </div>
    </>
  );
}
