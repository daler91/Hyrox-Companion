import type { TimelineEntry } from "@shared/schema";
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { CsvPreviewData } from "@/components/timeline";
import {
  AnnotationsDialog,
  CombineWorkoutsDialog,
  ImportPreviewDialog,
  SchedulePlanDialog,
  SkipConfirmDialog,
} from "@/components/timeline";
import { AdhocLogSheet } from "@/components/workout-detail/AdhocLogSheet";
import { LogSheet } from "@/components/workout-detail/LogSheet";
import { PreviewSheet } from "@/components/workout-detail/PreviewSheet";
import { ReviewSurface } from "@/components/workout-detail/ReviewSurface";
import { SkippedSheet } from "@/components/workout-detail/SkippedSheet";
import type { useToast } from "@/hooks/use-toast";
import { useTimelineState } from "@/hooks/useTimelineState";

import { useTimelineTitleMutation } from "./useTimelineTitleMutation";

type TimelineState = ReturnType<typeof useTimelineState>;
type PlanImportState = TimelineState["planImport"];
type WorkoutActionsState = TimelineState["workoutActions"];
type CombineState = TimelineState["combine"];
type ToastFn = ReturnType<typeof useToast>["toast"];

interface TimelineWorkoutSurfacesProps {
  readonly isMobile: boolean;
  readonly toast: ToastFn;
  readonly adhocOpen: boolean;
  readonly onAdhocOpenChange: (open: boolean) => void;
  readonly schedulingPlanId: PlanImportState["schedulingPlanId"];
  readonly setSchedulingPlanId: PlanImportState["setSchedulingPlanId"];
  readonly startDate: PlanImportState["startDate"];
  readonly setStartDate: PlanImportState["setStartDate"];
  readonly schedulePlanMutation: PlanImportState["schedulePlanMutation"];
  readonly previewEntry: TimelineEntry | null;
  readonly setPreviewEntry: Dispatch<SetStateAction<TimelineEntry | null>>;
  readonly futureEditEntry: TimelineEntry | null;
  readonly setFutureEditEntry: Dispatch<SetStateAction<TimelineEntry | null>>;
  readonly logEntry: TimelineEntry | null;
  readonly setLogEntry: Dispatch<SetStateAction<TimelineEntry | null>>;
  readonly reviewEntry: TimelineEntry | null;
  readonly setReviewEntry: Dispatch<SetStateAction<TimelineEntry | null>>;
  readonly skippedEntry: TimelineEntry | null;
  readonly setSkippedEntry: Dispatch<SetStateAction<TimelineEntry | null>>;
  readonly closeWorkoutSurfaces: () => void;
  readonly closeEmbeddedCoach: () => void;
  readonly openEmbeddedCoach: (entry: TimelineEntry, seedText?: string) => void;
  readonly embeddedCoachEntryId: string | null;
  readonly embeddedCoachSeedNonce: number;
  readonly embeddedCoachSeedText: string;
  readonly mobileCoachPanelOpen: boolean;
  readonly onCloseCoachChat: () => void;
  readonly onShowCoachPanel: () => void;
  readonly onShowWorkoutDetails: () => void;
  readonly setSkipConfirmEntry: WorkoutActionsState["setSkipConfirmEntry"];
  readonly skipConfirmEntry: WorkoutActionsState["skipConfirmEntry"];
  readonly handleMarkComplete: WorkoutActionsState["handleMarkComplete"];
  readonly handleChangeStatus: WorkoutActionsState["handleChangeStatus"];
  readonly handleDelete: WorkoutActionsState["handleDelete"];
  readonly confirmSkip: WorkoutActionsState["confirmSkip"];
  readonly logWorkoutMutation: WorkoutActionsState["logWorkoutMutation"];
  readonly csvPreview: CsvPreviewData | null;
  readonly setCsvPreview: PlanImportState["setCsvPreview"];
  readonly confirmImport: PlanImportState["confirmImport"];
  readonly importMutation: PlanImportState["importMutation"];
  readonly showCombineDialog: CombineState["showCombineDialog"];
  readonly setShowCombineDialog: CombineState["setShowCombineDialog"];
  readonly combiningEntry: CombineState["combiningEntry"];
  readonly setCombiningEntry: CombineState["setCombiningEntry"];
  readonly combineSecondEntry: CombineState["combineSecondEntry"];
  readonly setCombineSecondEntry: CombineState["setCombineSecondEntry"];
  readonly handleConfirmCombine: CombineState["handleConfirmCombine"];
  readonly combineWorkoutsMutation: CombineState["combineWorkoutsMutation"];
  readonly annotationsDialogOpen: boolean;
  readonly setAnnotationsDialogOpen: (open: boolean) => void;
  readonly annotationInitialDate: string | undefined;
  readonly setAnnotationInitialDate: (date: string | undefined) => void;
}

function isMobileCoachPanelActive(
  isMobile: boolean,
  entry: TimelineEntry | null,
  embeddedCoachEntryId: string | null,
  mobileCoachPanelOpen: boolean,
): boolean {
  return Boolean(isMobile && mobileCoachPanelOpen && embeddedCoachEntryId === entry?.id);
}

export function TimelineWorkoutSurfaces({
  isMobile,
  toast,
  adhocOpen,
  onAdhocOpenChange,
  schedulingPlanId,
  setSchedulingPlanId,
  startDate,
  setStartDate,
  schedulePlanMutation,
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
  closeWorkoutSurfaces,
  closeEmbeddedCoach,
  openEmbeddedCoach,
  embeddedCoachEntryId,
  embeddedCoachSeedNonce,
  embeddedCoachSeedText,
  mobileCoachPanelOpen,
  onCloseCoachChat,
  onShowCoachPanel,
  onShowWorkoutDetails,
  setSkipConfirmEntry,
  skipConfirmEntry,
  handleMarkComplete,
  handleChangeStatus,
  handleDelete,
  confirmSkip,
  logWorkoutMutation,
  csvPreview,
  setCsvPreview,
  confirmImport,
  importMutation,
  showCombineDialog,
  setShowCombineDialog,
  combiningEntry,
  setCombiningEntry,
  combineSecondEntry,
  setCombineSecondEntry,
  handleConfirmCombine,
  combineWorkoutsMutation,
  annotationsDialogOpen,
  setAnnotationsDialogOpen,
  annotationInitialDate,
  setAnnotationInitialDate,
}: Readonly<TimelineWorkoutSurfacesProps>) {
  const [completionSuccessEntryId, setCompletionSuccessEntryId] = useState<string | null>(null);
  const logEntryRef = useRef(logEntry);
  // Sync synchronously during commit so a mutation promise resolving between
  // the dismiss render and a passive effect still sees the cleared entry.
  useLayoutEffect(() => {
    logEntryRef.current = logEntry;
  }, [logEntry]);
  const titleMutation = useTimelineTitleMutation({
    setPreviewEntry,
    setFutureEditEntry,
    setLogEntry,
    setReviewEntry,
    setSkippedEntry,
  });
  const handleRenameTitle = (entry: TimelineEntry, title: string) => {
    titleMutation.mutate({ entry, title });
  };

  useEffect(() => {
    if (completionSuccessEntryId && reviewEntry?.id !== completionSuccessEntryId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears stale success callout when review surface transitions to a different entry
      setCompletionSuccessEntryId(null);
    }
  }, [completionSuccessEntryId, reviewEntry?.id]);

  return (
    <>
      <AdhocLogSheet open={adhocOpen} onClose={() => onAdhocOpenChange(false)} />

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
        onLogAsPlanned={(entry, rpeOverride, noteOverride) => {
          return new Promise<void>((resolve, reject) => {
            handleMarkComplete({
              ...entry,
              rpe: rpeOverride ?? null,
              notes: noteOverride,
            }, {
              onSuccess: (completedEntry) => {
                const userDismissedLogSheet = logEntryRef.current?.id !== entry.id;
                closeEmbeddedCoach();
                setLogEntry(null);
                if (!userDismissedLogSheet) {
                  setReviewEntry(completedEntry);
                  setCompletionSuccessEntryId(completedEntry.id);
                }
                resolve();
              },
              onError: reject,
            });
          });
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
        onCloseCoachChat={onCloseCoachChat}
        onShowCoachPanel={onShowCoachPanel}
        onShowWorkoutDetails={onShowWorkoutDetails}
        onRenameTitle={handleRenameTitle}
        isRenamingTitle={titleMutation.isRenamingEntry(logEntry)}
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
        onCloseCoachChat={onCloseCoachChat}
        onShowCoachPanel={onShowCoachPanel}
        onShowWorkoutDetails={onShowWorkoutDetails}
        onRenameTitle={handleRenameTitle}
        isRenamingTitle={titleMutation.isRenamingEntry(futureEditEntry)}
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
        onCloseCoachChat={onCloseCoachChat}
        onShowCoachPanel={onShowCoachPanel}
        onShowWorkoutDetails={onShowWorkoutDetails}
        onRenameTitle={handleRenameTitle}
        isRenamingTitle={titleMutation.isRenamingEntry(skippedEntry)}
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
        onClose={() => {
          setCompletionSuccessEntryId(null);
          closeWorkoutSurfaces();
        }}
        onAskCoach={openEmbeddedCoach}
        coachChatOpen={embeddedCoachEntryId === reviewEntry?.id}
        coachChatNonce={embeddedCoachSeedNonce}
        coachSeedText={embeddedCoachSeedText}
        mobileCoachPanelOpen={isMobileCoachPanelActive(isMobile, reviewEntry, embeddedCoachEntryId, mobileCoachPanelOpen)}
        onCloseCoachChat={onCloseCoachChat}
        onShowCoachPanel={onShowCoachPanel}
        onShowWorkoutDetails={onShowWorkoutDetails}
        onRenameTitle={handleRenameTitle}
        isRenamingTitle={titleMutation.isRenamingEntry(reviewEntry)}
        showCompletionSuccess={reviewEntry?.id === completionSuccessEntryId}
        onMarkPlanned={(entry) => {
          closeEmbeddedCoach();
          setReviewEntry(null);
          setCompletionSuccessEntryId(null);
          handleChangeStatus(entry, "planned");
        }}
        onDelete={(entry) => {
          closeEmbeddedCoach();
          setReviewEntry(null);
          setCompletionSuccessEntryId(null);
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
        onCloseCoachChat={onCloseCoachChat}
        onShowCoachPanel={onShowCoachPanel}
        onShowWorkoutDetails={onShowWorkoutDetails}
        onRenameTitle={handleRenameTitle}
        isRenamingTitle={titleMutation.isRenamingEntry(previewEntry)}
        onMove={() => {
          closeEmbeddedCoach();
          setPreviewEntry(null);
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
    </>
  );
}
