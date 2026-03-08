import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FileText,
  Calendar,
  Loader2,
  ChevronDown,
  ChevronUp,
  Dumbbell,
  Target,
  Zap,
  Sparkles,
} from "lucide-react";
import { Link } from "wouter";
import { CoachPanel } from "@/components/CoachPanel";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { isToday, parseISO } from "date-fns";
import {
  TimelineSkeleton,
  TimelineHeader,
  TimelineFilters,
  TimelineDateGroup,
  SchedulePlanDialog,
  WorkoutDetailDialog,
  SkipConfirmDialog,
  ImportPreviewDialog,
  FloatingActionButton,
  CombineWorkoutsDialog,
} from "@/components/timeline";
import { useTimelineState } from "@/hooks/useTimelineState";

export default function Timeline() {
  const state = useTimelineState();

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
      />

      {timelineLoading ? (
        <TimelineSkeleton />
      ) : filteredTimeline.length === 0 ? (
        <Card className="overflow-visible">
          <CardContent className="p-8 md:p-12">
            {filterStatus === "all" && !selectedPlanId && plans.length === 0 ? (
              <div className="text-center space-y-6">
                <div className="flex justify-center gap-3 mb-2">
                  <div className="p-3 rounded-full bg-primary/10">
                    <Target className="h-6 w-6 text-primary" />
                  </div>
                  <div className="p-3 rounded-full bg-primary/10">
                    <Dumbbell className="h-6 w-6 text-primary" />
                  </div>
                  <div className="p-3 rounded-full bg-primary/10">
                    <Zap className="h-6 w-6 text-primary" />
                  </div>
                </div>
                
                <div>
                  <h2 className="text-2xl font-bold mb-2">Welcome to HyroxTracker</h2>
                  <p className="text-muted-foreground max-w-md mx-auto">
                    Your personal training companion for Hyrox preparation. Track workouts, follow structured plans, and get AI-powered coaching.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                  <Button 
                    size="lg" 
                    onClick={() => samplePlanMutation.mutate()}
                    disabled={samplePlanMutation.isPending}
                    data-testid="button-use-sample-plan"
                  >
                    {samplePlanMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4 mr-2" />
                    )}
                    Use 8-Week Hyrox Plan
                  </Button>
                  <div>
                    <Label htmlFor="csv-upload-empty" className="cursor-pointer">
                      <Button size="lg" variant="outline" disabled={importMutation.isPending} data-testid="button-import-plan-empty">
                        {importMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <FileText className="h-4 w-4 mr-2" />
                        )}
                        Import Your Own
                      </Button>
                    </Label>
                    <Input
                      id="csv-upload-empty"
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={handleFileUpload}
                      data-testid="input-csv-upload-empty"
                    />
                  </div>
                </div>

                <div className="flex justify-center pt-2">
                  <Link href="/log">
                    <Button variant="ghost" data-testid="button-log-workout-empty">
                      <Dumbbell className="h-4 w-4 mr-2" />
                      Or just log a workout
                    </Button>
                  </Link>
                </div>

                <p className="text-xs text-muted-foreground pt-2">
                  New to Hyrox? Ask our AI Coach for training recommendations.
                </p>
              </div>
            ) : filterStatus === "all" && selectedPlanId ? (
              <div className="text-center space-y-4">
                <Calendar className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
                <div>
                  <h3 className="font-semibold mb-2">Ready to Start Training</h3>
                  <p className="text-muted-foreground text-sm max-w-md mx-auto">
                    Set a start date for your plan to schedule workouts on your calendar.
                  </p>
                </div>
                <Button
                  onClick={() => setSchedulingPlanId(selectedPlanId)}
                  data-testid="button-set-start-date"
                >
                  <Calendar className="h-4 w-4 mr-2" />
                  Set Start Date
                </Button>
              </div>
            ) : (
              <div className="text-center space-y-4">
                <Calendar className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
                <div>
                  <h3 className="font-semibold mb-2">No {filterStatus} workouts</h3>
                  <p className="text-muted-foreground text-sm">
                    Try adjusting your filter or complete more workouts to see them here.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setFilterStatus("all")}
                  data-testid="button-clear-filter"
                >
                  Show All
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
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
          )}

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
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setCoachOpen(false)} />
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
