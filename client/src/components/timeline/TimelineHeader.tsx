import { Button } from "@/components/ui/button";
import { MessageSquare, CalendarCheck } from "lucide-react";

interface TimelineHeaderProps {
  coachOpen: boolean;
  onToggleCoach: () => void;
  onScrollToToday: () => void;
}

export default function TimelineHeader({
  coachOpen,
  onToggleCoach,
  onScrollToToday,
}: TimelineHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">
          Training Timeline
        </h1>
        <p className="text-muted-foreground mt-1">
          Your complete training journey - past, present, and future
        </p>
      </div>
      <div className="flex gap-2 flex-wrap">
        <Button
          variant="outline"
          onClick={onScrollToToday}
          data-testid="button-jump-to-today"
        >
          <CalendarCheck className="h-4 w-4 mr-2" />
          Go to Today
        </Button>
        <Button
          variant={coachOpen ? "default" : "outline"}
          onClick={onToggleCoach}
          className="gap-2"
          data-testid="button-toggle-coach"
        >
          <MessageSquare className="h-4 w-4" />
          <span className="hidden sm:inline">AI Coach</span>
        </Button>
      </div>
    </div>
  );
}
