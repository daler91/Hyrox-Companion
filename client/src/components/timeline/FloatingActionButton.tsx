import { MessageSquare, Plus } from "lucide-react";
import type { Ref } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";

interface FloatingActionButtonProps {
  readonly coachPanelOpen?: boolean;
  readonly onCoachToggle?: () => void;
  readonly onLogWorkout: () => void;
  /**
   * The coach button, so the phone coach overlay can hand focus back to it on
   * close (U4, CODEBASE_ANALYSIS_2026-10-03).
   */
  readonly coachButtonRef?: Ref<HTMLButtonElement>;
}

export default function FloatingActionButton({
  coachPanelOpen,
  onCoachToggle,
  onLogWorkout,
  coachButtonRef,
}: Readonly<FloatingActionButtonProps>) {
  const rightPosition = coachPanelOpen
    ? "!right-6 md:!right-[calc(20rem+1.5rem)] lg:!right-[calc(24rem+1.5rem)] max-md:hidden"
    : "!right-6";

  // z-40 on purpose: below the mobile nav drawer, dialogs and detail sheets
  // (z-50) and the privacy notice (z-60). At 9999 the two pills floated over
  // the open drawer's overlay and sat on top of the consent banner's buttons
  // on first run. The bottom offset clears the phone tab bar (--mobile-nav-h,
  // 0 on desktop) and the iOS home indicator.
  return createPortal(
    <div
      className={`!fixed !bottom-[calc(1.5rem+var(--mobile-nav-h,0px)+env(safe-area-inset-bottom))] z-40 flex flex-col gap-3 items-end transition-all duration-300 ${rightPosition}`}
    >
      <Button
        ref={coachButtonRef}
        className="rounded-full shadow-lg gap-2"
        onClick={onCoachToggle}
        data-testid="button-coach-fab"
        aria-expanded={Boolean(coachPanelOpen)}
        // U18 (CODEBASE_ANALYSIS_2026-10-03): TimelineCoachPanels renders
        // id="coach-panel" only while the panel is open, so point at it only
        // then rather than at an id that does not exist.
        aria-controls={coachPanelOpen ? "coach-panel" : undefined}
      >
        <MessageSquare className="h-4 w-4" aria-hidden />
        <span>AI Coach</span>
      </Button>
      <Button
        className="rounded-full shadow-lg gap-2"
        onClick={onLogWorkout}
        data-testid="button-log-workout-fab"
      >
        <Plus className="h-5 w-5" aria-hidden />
        <span>Log Workout</span>
      </Button>
    </div>,
    document.body,
  );
}
