import type { TimelineEntry } from "@shared/schema";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

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

import type { useEmbeddedCoachRouting } from "./useEmbeddedCoachRouting";
import type { useTimelineDialogState } from "./useTimelineDialogState";
import type { useTimelineSurfaceSelection } from "./useTimelineSurfaceSelection";
import { useTimelineTitleMutation } from "./useTimelineTitleMutation";

type TimelineState = ReturnType<typeof useTimelineState>;
type SurfaceSelectionState = ReturnType<typeof useTimelineSurfaceSelection>;
type CoachRoutingState = ReturnType<typeof useEmbeddedCoachRouting>;
type DialogState = ReturnType<typeof useTimelineDialogState>;
type ToastFn = ReturnType<typeof useToast>["toast"];

// Props are grouped by producer hook slice — Timeline passes each hook's
// return object straight through (Pick keeps the contract explicit about
// which members this component actually consumes).
interface TimelineWorkoutSurfacesProps {
  readonly isMobile: boolean;
  readonly toast: ToastFn;
  readonly adhocOpen: boolean;
  readonly onAdhocOpenChange: (open: boolean) => void;
  /** Entry selection for the five workout sheets (useTimelineSurfaceSelection). */
  readonly surfaces: Pick<
    SurfaceSelectionState,
    | "previewEntry"
    | "setPreviewEntry"
    | "futureEditEntry"
    | "setFutureEditEntry"
    | "logEntry"
    | "setLogEntry"
    | "reviewEntry"
    | "setReviewEntry"
    | "skippedEntry"
    | "setSkippedEntry"
  >;
  /** Embedded-coach routing shared across all sheets (useEmbeddedCoachRouting). */
  readonly coach: Pick<
    CoachRoutingState,
    | "embeddedCoachEntryId"
    | "embeddedCoachSeedNonce"
    | "embeddedCoachSeedText"
    | "mobileCoachPanelOpen"
    | "openEmbeddedCoach"
    | "closeEmbeddedCoach"
    | "closeWorkoutSurfaces"
    | "showMobileCoachPanel"
    | "showWorkoutDetails"
  >;
  /** Workout actions + skip confirm (useTimelineState().workoutActions). */
  readonly actions: Pick<
    TimelineState["workoutActions"],
    | "skipConfirmEntry"
    | "setSkipConfirmEntry"
    | "handleMarkComplete"
    | "handleChangeStatus"
    | "handleDelete"
    | "confirmSkip"
    | "logWorkoutMutation"
  >;
  /** Plan scheduling + CSV import preview (useTimelineState().planImport). */
  readonly planImport: Pick<
    TimelineState["planImport"],
    | "schedulingPlanId"
    | "setSchedulingPlanId"
    | "startDate"
    | "setStartDate"
    | "schedulePlanMutation"
    | "csvPreview"
    | "setCsvPreview"
    | "confirmImport"
    | "importMutation"
  >;
  /** Combine-workouts dialog (useTimelineState().combine). */
  readonly combine: Pick<
    TimelineState["combine"],
    | "showCombineDialog"
    | "setShowCombineDialog"
    | "combiningEntry"
    | "setCombiningEntry"
    | "combineSecondEntry"
    | "setCombineSecondEntry"
    | "handleConfirmCombine"
    | "combineWorkoutsMutation"
  >;
  /** Annotations dialog (useTimelineDialogState). */
  readonly annotations: Pick<
    DialogState,
    | "annotationsDialogOpen"
    | "setAnnotationsDialogOpen"
    | "annotationInitialDate"
    | "setAnnotationInitialDate"
  >;
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
  surfaces,
  coach,
  actions,
  planImport,
  combine,
  annotations,
}: Readonly<TimelineWorkoutSurfacesProps>) {
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
  } = surfaces;
  const {
    embeddedCoachEntryId,
    embeddedCoachSeedNonce,
    embeddedCoachSeedText,
    mobileCoachPanelOpen,
    openEmbeddedCoach,
    closeEmbeddedCoach,
    closeWorkoutSurfaces,
    showMobileCoachPanel: onShowCoachPanel,
    showWorkoutDetails: onShowWorkoutDetails,
  } = coach;
  // Closing the coach chat and closing the embedded coach are the same
  // action today (Timeline passed closeEmbeddedCoach for both).
  const onCloseCoachChat = closeEmbeddedCoach;
  const {
    skipConfirmEntry,
    setSkipConfirmEntry,
    handleMarkComplete,
    handleChangeStatus,
    handleDelete,
    confirmSkip,
    logWorkoutMutation,
  } = actions;
  const {
    schedulingPlanId,
    setSchedulingPlanId,
    startDate,
    setStartDate,
    schedulePlanMutation,
    csvPreview,
    setCsvPreview,
    confirmImport,
    importMutation,
  } = planImport;
  const {
    showCombineDialog,
    setShowCombineDialog,
    combiningEntry,
    setCombiningEntry,
    combineSecondEntry,
    setCombineSecondEntry,
    handleConfirmCombine,
    combineWorkoutsMutation,
  } = combine;
  const {
    annotationsDialogOpen,
    setAnnotationsDialogOpen,
    annotationInitialDate,
    setAnnotationInitialDate,
  } = annotations;
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
