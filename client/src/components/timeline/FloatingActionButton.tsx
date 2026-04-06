import { MessageSquare,Plus } from "lucide-react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";

import { Button } from "@/components/ui/button";

interface FloatingActionButtonProps {
  readonly coachPanelOpen?: boolean;
  readonly onCoachToggle?: () => void;
}

export default function FloatingActionButton({
  coachPanelOpen,
  onCoachToggle,
}: Readonly<FloatingActionButtonProps>) {
  const [, setLocation] = useLocation();

  const rightPosition = coachPanelOpen
    ? "!right-6 md:!right-[calc(20rem+1.5rem)] lg:!right-[calc(24rem+1.5rem)] max-md:hidden"
    : "!right-6";

  const handleNewWorkout = () => {
    setLocation("/log");
  };

  return createPortal(
    <div
      className={`!fixed !bottom-6 flex flex-col gap-3 items-end transition-all duration-300 ${rightPosition}`}
      style={{ zIndex: 9999 }}
    >
      <Button
        className="rounded-full shadow-lg gap-2"
        onClick={onCoachToggle}
        data-testid="button-coach-fab"
        aria-expanded={coachPanelOpen}
        aria-controls="coach-panel"
      >
        <MessageSquare className="h-4 w-4" />
        <span>AI Coach</span>
      </Button>
      <Button
        className="rounded-full shadow-lg gap-2"
        onClick={handleNewWorkout}
        data-testid="button-log-workout-fab"
      >
        <Plus className="h-5 w-5" />
        <span>New Workout</span>
      </Button>
    </div>,
    document.body,
  );
}
