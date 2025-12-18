import { createPortal } from "react-dom";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface FloatingActionButtonProps {
  coachPanelOpen?: boolean;
}

export default function FloatingActionButton({ coachPanelOpen }: FloatingActionButtonProps) {
  return createPortal(
    <Link href="/log">
      <Button
        className={`!fixed !bottom-6 rounded-full shadow-lg gap-2 transition-all duration-300 ${
          coachPanelOpen 
            ? "!right-6 md:!right-[calc(20rem+1.5rem)] lg:!right-[calc(24rem+1.5rem)] max-md:hidden" 
            : "!right-6"
        }`}
        style={{ zIndex: 9999 }}
        data-testid="button-log-workout-fab"
      >
        <Plus className="h-5 w-5" />
        <span>New Workout</span>
      </Button>
    </Link>,
    document.body
  );
}
