import { Button } from "@/components/ui/button";


import { Input } from "@/components/ui/input";

import {
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react";

import { CoachPanel } from "@/components/CoachPanel";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { isToday, parseISO } from "date-fns";
import {
  TimelineSkeleton,
  TimelineHeader,
  TimelineFilters,
  TimelineEmptyState,
  TimelineDateGroup,
  SchedulePlanDialog,
  WorkoutDetailDialog,
  SkipConfirmDialog,
  ImportPreviewDialog,
  FloatingActionButton,
  CombineWorkoutsDialog,
} from "@/components/timeline";
import { useTimelineState } from "@/hooks/useTimelineState";
import { useAuth } from "@/hooks/useAuth";

export default function Timeline() {
  const state = useTimelineState();
  const { user } = useAuth();

  const {
    plans,
    plansLoading,
    personalRecords,
    timelineData,
    timelineLoading,
    isNewUser,
    selectedPlanId,
    setSelectedPlanId,
    filterStatus,
    setFilterStatus,
    detailEntry,
    setDetailEntry,
    schedulingPlanId,
    setSchedulingPlanId,
    startDate,
    setStartDate,
    skipConfirmEntry,
    setSkipConfirmEntry,
    csvPreview,
    setCsvPreview,
    showAllPast,
    setShowAllPast,
    showAllFuture,
    setShowAllFuture,
    combiningEntry,
    setCombiningEntry,
    combineSecondEntry,
    setCombineSecondEntry,
    showCombineDialog,
    setShowCombineDialog,
    coachOpen,
    setCoachOpen,
    showOnboarding,
    todayRef,
    fileInputRef,
    scrollToToday,
    handleOnboardingComplete,
    handleFileUpload,
    confirmImport,
    openDetailDialog,
    handleSaveFromDetail,
    handleMarkComplete,
    handleChangeStatus,
    handleDelete,
    handleCombine,
    handleConfirmCombine,
    confirmSkip,
    importMutation,
    samplePlanMutation,
    renamePlanMutation,
    schedulePlanMutation,
    updateDayMutation,
    logWorkoutMutation,
    updateWorkoutMutation,
    deleteWorkoutMutation,
    deletePlanDayMutation,
    combineWorkoutsMutation,
    filteredTimeline,
    pastGroups,
    futureGroups,
    visiblePastGroups,
    visibleFutureGroups,
    hiddenPastCount,
    hiddenFutureCount,
    updatePlanGoalMutation,
  } = state;

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
      <div className="flex-1 overflow-auto p-4 md:p-8">
        <div className="max-w-5xl mx-auto space-y-6">
          <TimelineHeader
            onScrollToToday={scrollToToday}
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

      {(() => {
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

            {[...visiblePastGroups.slice().reverse(), ...visibleFutureGroups].map(([date, entries]) => (
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
                isAutoCoaching={!!user?.isAutoCoaching}
              />
            ))}

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
      })()}

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
          <CoachPanel 
            isOpen={coachOpen} 
            onClose={() => setCoachOpen(false)} 
            timeline={timelineData}
            isNewUser={isNewUser}
          />
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
            <CoachPanel 
              isOpen={coachOpen} 
              onClose={() => setCoachOpen(false)} 
              timeline={timelineData}
              isNewUser={isNewUser}
            />
          </div>
        </div>
      )}
    </div>
    </>
  );
}
