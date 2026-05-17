import { AIConsentDialog } from "@/components/coach/AIConsentDialog";
import { CoachPanel } from "@/components/CoachPanel";
import { FeatureErrorBoundaryWrapper } from "@/components/FeatureErrorBoundaryWrapper";
import { useTimelineState } from "@/hooks/useTimelineState";

type TimelineData = ReturnType<typeof useTimelineState>["data"];

interface TimelineCoachPanelsProps {
  readonly coachOpen: boolean;
  readonly isMobile: boolean;
  readonly isWorkoutSurfaceOpen: boolean;
  readonly timelineData: TimelineData["timelineData"];
  readonly isNewUser: TimelineData["isNewUser"];
  readonly onCoachClose: () => void;
  readonly showAIConsent: boolean;
  readonly onAIConsentAccept: () => void;
  readonly onAIConsentDecline: () => void;
}

export function TimelineCoachPanels({
  coachOpen,
  isMobile,
  isWorkoutSurfaceOpen,
  timelineData,
  isNewUser,
  onCoachClose,
  showAIConsent,
  onAIConsentAccept,
  onAIConsentDecline,
}: Readonly<TimelineCoachPanelsProps>) {
  return (
    <>
      {coachOpen && !isMobile && (
        <div className={isWorkoutSurfaceOpen ? "hidden" : "w-80 lg:w-96 flex-shrink-0"}>
          <FeatureErrorBoundaryWrapper featureName="Coach">
            <CoachPanel
              isOpen={coachOpen}
              onClose={onCoachClose}
              timeline={timelineData}
              isNewUser={isNewUser}
            />
          </FeatureErrorBoundaryWrapper>
        </div>
      )}

      {coachOpen && isMobile && (
        // Hide instead of unmounting so in-flight chat streams survive detail sheets.
        <div className={isWorkoutSurfaceOpen ? "hidden" : "fixed inset-0 z-50 h-[100dvh]"}>
          <div
            data-testid="coach-panel-mobile-sheet"
            className="relative h-full bg-background shadow-2xl"
          >
            <FeatureErrorBoundaryWrapper featureName="Coach">
              <CoachPanel
                isOpen={coachOpen}
                onClose={onCoachClose}
                timeline={timelineData}
                isNewUser={isNewUser}
              />
            </FeatureErrorBoundaryWrapper>
          </div>
        </div>
      )}

      <AIConsentDialog
        open={showAIConsent}
        onAccept={onAIConsentAccept}
        onDecline={onAIConsentDecline}
      />
    </>
  );
}
