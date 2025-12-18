import { createPortal } from "react-dom";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Plus, MessageSquare } from "lucide-react";

interface FloatingActionButtonProps {
  coachPanelOpen?: boolean;
  onCoachToggle?: () => void;
}

export default function FloatingActionButton({ coachPanelOpen, onCoachToggle }: FloatingActionButtonProps) {
  const rightPosition = coachPanelOpen 
    ? "!right-6 md:!right-[calc(20rem+1.5rem)] lg:!right-[calc(24rem+1.5rem)] max-md:hidden" 
    : "!right-6";

  return createPortal(
    <div 
      className={`!fixed !bottom-6 flex flex-col gap-3 transition-all duration-300 ${rightPosition}`}
      style={{ zIndex: 9999 }}
    >
      <Button
        size="icon"
        variant={coachPanelOpen ? "default" : "secondary"}
        className="rounded-full shadow-lg h-12 w-12"
        onClick={onCoachToggle}
        data-testid="button-coach-fab"
        title="AI Coach"
      >
        <MessageSquare className="h-5 w-5" />
      </Button>
      <Link href="/log">
        <Button
          className="rounded-full shadow-lg gap-2"
          data-testid="button-log-workout-fab"
        >
          <Plus className="h-5 w-5" />
          <span>New Workout</span>
        </Button>
      </Link>
    </div>,
    document.body
  );
}
