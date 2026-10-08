import { Content as DialogPrimitiveContent } from "@radix-ui/react-dialog";
import { type ComponentProps, type RefObject, Suspense } from "react";

import { AIConsentDialog } from "@/components/coach/AIConsentDialog";
import { FeatureErrorBoundaryWrapper } from "@/components/FeatureErrorBoundaryWrapper";
import { Dialog, DialogDescription, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { BlockingModalLayerRegistration } from "@/components/ui/modal-layer";
import { useTimelineState } from "@/hooks/useTimelineState";
import { lazyWithReload } from "@/lib/lazyWithReload";
import { cn } from "@/lib/utils";

type TimelineData = ReturnType<typeof useTimelineState>["data"];

// Loaded the first time the panel opens, not with the Timeline, which starts
// with it closed. PF8 (CODEBASE_ANALYSIS_2026-10-03). The markdown stack the
// chat renders with (react-markdown, remark-gfm, rehype-sanitize) is a lazy
// chunk of its own (ChatMessage -> ChatMarkdown), so the workout sheets'
// embedded coach chat no longer pulls it into the Timeline chunk either.
// lazyWithReload, as for the routes, so a chunk a deploy removed reloads onto
// the current build.
const CoachPanel = lazyWithReload(() =>
  import("@/components/CoachPanel").then((coachModule) => ({ default: coachModule.CoachPanel })),
);

/** The coach panel, with a spinner holding its place while its chunk loads. */
function LazyCoachPanel(props: Readonly<ComponentProps<typeof CoachPanel>>) {
  return (
    <Suspense
      fallback={<LoadingSpinner label="Loading the coach" className="h-full w-full py-12" />}
    >
      <CoachPanel {...props} />
    </Suspense>
  );
}

/** The id the coach FAB's aria-controls points at, on whichever panel is showing. */
const COACH_PANEL_ID = "coach-panel";

interface TimelineCoachPanelsProps {
  readonly coachOpen: boolean;
  readonly isMobile: boolean;
  readonly isWorkoutSurfaceOpen: boolean;
  readonly timelineData: TimelineData["timelineData"];
  readonly isNewUser: TimelineData["isNewUser"];
  readonly onCoachClose: () => void;
  /** Where focus goes when the phone overlay closes: the FAB that opened it. */
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
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
  returnFocusRef,
  showAIConsent,
  onAIConsentAccept,
  onAIConsentDecline,
}: Readonly<TimelineCoachPanelsProps>) {
  const coachPanel = (
    <FeatureErrorBoundaryWrapper featureName="Coach">
      <LazyCoachPanel
        isOpen={coachOpen}
        onClose={onCoachClose}
        timeline={timelineData}
        isNewUser={isNewUser}
      />
    </FeatureErrorBoundaryWrapper>
  );

  return (
    <>
      {coachOpen && !isMobile && (
        <div
          id={COACH_PANEL_ID}
          className={isWorkoutSurfaceOpen ? "hidden" : "w-80 lg:w-96 flex-shrink-0"}
        >
          {coachPanel}
        </div>
      )}

      {coachOpen && isMobile && (
        // A modal dialog on phones: it covers the whole screen, so it has to
        // say so, take focus, keep Tab and the screen reader inside it, close
        // on Escape and hand focus back to the FAB, which is hidden while it
        // is open. It was a plain fixed div that did none of those.
        // U4 (CODEBASE_ANALYSIS_2026-10-03)
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) onCoachClose();
          }}
        >
          <DialogPortal>
            <DialogPrimitiveContent
              id={COACH_PANEL_ID}
              // Radix hides the rest of the page with aria-hidden; aria-modal
              // tells assistive tech the same thing up front.
              aria-modal="true"
              data-testid="coach-panel-mobile-sheet"
              // Hide instead of unmounting so in-flight chat streams survive
              // detail sheets, which open as their own dialogs on top.
              className={cn(
                "fixed inset-0 z-50 h-[100dvh] bg-background pt-[env(safe-area-inset-top)] shadow-2xl focus:outline-none",
                isWorkoutSurfaceOpen && "hidden",
              )}
              // Full screen, so "outside" is only portalled UI such as a
              // toast: tapping it must not throw the conversation away.
              onInteractOutside={(event) => {
                event.preventDefault();
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                returnFocusRef?.current?.focus();
              }}
            >
              <BlockingModalLayerRegistration />
              <DialogTitle className="sr-only">AI Coach</DialogTitle>
              <DialogDescription className="sr-only">
                Chat with your AI training coach.
              </DialogDescription>
              {coachPanel}
            </DialogPrimitiveContent>
          </DialogPortal>
        </Dialog>
      )}

      <AIConsentDialog
        open={showAIConsent}
        onAccept={onAIConsentAccept}
        onDecline={onAIConsentDecline}
      />
    </>
  );
}
