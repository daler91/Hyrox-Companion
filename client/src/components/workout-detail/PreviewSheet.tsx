import type { TimelineEntry } from "@shared/schema";
import { CalendarClock, MessageSquare, Pencil, SkipForward } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatScheduledDate } from "@/lib/timelineEntryFormat";

import { buildWorkoutCoachSeedMessage } from "./EmbeddedWorkoutCoachChat";
import { WorkoutPrescriptionSummary } from "./shared/WorkoutPrescriptionSummary";
import {
  getWorkoutCoachPanelState,
  WorkoutCoachChatPanel,
  WorkoutCoachLayout,
} from "./WorkoutCoachPanel";

interface PreviewSheetProps {
  readonly entry: TimelineEntry | null;
  readonly onClose: () => void;
  readonly onAskCoach?: (entry: TimelineEntry, seedText: string) => void;
  readonly coachChatOpen?: boolean;
  readonly coachChatNonce?: number;
  readonly coachSeedText?: string;
  readonly mobileCoachPanelOpen?: boolean;
  readonly onCloseCoachChat?: () => void;
  readonly onShowCoachPanel?: () => void;
  readonly onShowWorkoutDetails?: () => void;
  readonly onMove?: (entry: TimelineEntry) => void;
  readonly onSkip?: (entry: TimelineEntry) => void;
  readonly onEditWorkout?: (entry: TimelineEntry) => void;
}

/**
 * Read-only preview surface for future-dated planned workouts. Removes the
 * primary log CTA so users can't accidentally log a workout that hasn't
 * happened yet. The edit action opens the plan-day prescription editor without
 * creating a workout log.
 */
export function PreviewSheet({
  entry,
  onClose,
  onAskCoach,
  coachChatOpen = false,
  coachChatNonce,
  coachSeedText,
  mobileCoachPanelOpen = false,
  onCloseCoachChat,
  onShowCoachPanel,
  onShowWorkoutDetails,
  onMove,
  onSkip,
  onEditWorkout,
}: PreviewSheetProps) {
  const isMobile = useIsMobile();

  if (!entry) return null;
  const currentCoachSeedText = buildWorkoutCoachSeedMessage(entry, entry.exerciseSets ?? []);
  const coachPanel = getWorkoutCoachPanelState({ coachChatOpen, isMobile, mobileCoachPanelOpen });

  return (
    <ResponsiveSheet
      open={!!entry}
      onOpenChange={(open) => !open && onClose()}
      title={entry.focus || "Upcoming workout"}
      description={formatScheduledDate(entry.date)}
      contentClassName={coachChatOpen ? "sm:max-w-5xl" : undefined}
      testId={`preview-sheet-${entry.id}`}
    >
      <WorkoutCoachLayout
        panelState={coachPanel}
        detailsTestId={`preview-details-${entry.id}`}
        returnTestId={`preview-return-to-coach-${entry.id}`}
        onShowCoachPanel={onShowCoachPanel}
        chat={
          <WorkoutCoachChatPanel
            entry={entry}
            coachChatOpen={coachChatOpen}
            coachChatNonce={coachChatNonce}
            coachSeedText={coachSeedText}
            currentCoachSeedText={currentCoachSeedText}
            panelState={coachPanel}
            onCloseCoachChat={onCloseCoachChat}
            onShowWorkoutDetails={onShowWorkoutDetails}
          />
        }
      >
        <WorkoutPrescriptionSummary entry={entry} rationaleVariant="open" />

        <Separator />

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {onAskCoach ? (
            <Button
              type="button"
              variant="default"
              onClick={() => onAskCoach(entry, currentCoachSeedText)}
              data-testid={`preview-ask-coach-${entry.id}`}
            >
              <MessageSquare className="mr-2 h-4 w-4" />
              Ask coach
            </Button>
          ) : null}
          {onMove ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => onMove(entry)}
              data-testid={`preview-move-${entry.id}`}
            >
              <CalendarClock className="mr-2 h-4 w-4" />
              Move to another day
            </Button>
          ) : null}
          {onSkip ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => onSkip(entry)}
              data-testid={`preview-skip-${entry.id}`}
            >
              <SkipForward className="mr-2 h-4 w-4" />
              Skip
            </Button>
          ) : null}
          {onEditWorkout ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => onEditWorkout(entry)}
              data-testid={`preview-edit-workout-${entry.id}`}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit workout
            </Button>
          ) : null}
        </div>
      </WorkoutCoachLayout>
    </ResponsiveSheet>
  );
}
