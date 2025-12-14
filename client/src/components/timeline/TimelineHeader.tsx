import { Button } from "@/components/ui/button";
import { Sparkles, CalendarCheck, Loader2 } from "lucide-react";

interface TimelineHeaderProps {
  onAICoach: () => void;
  onScrollToToday: () => void;
  isLoading: boolean;
}

export default function TimelineHeader({
  onAICoach,
  onScrollToToday,
  isLoading,
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
          onClick={onAICoach}
          disabled={isLoading}
          data-testid="button-get-suggestions"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 mr-2" />
          )}
          AI Coach
        </Button>
        <Button
          variant="outline"
          onClick={onScrollToToday}
          data-testid="button-jump-to-today"
        >
          <CalendarCheck className="h-4 w-4 mr-2" />
          Go to Today
        </Button>
      </div>
    </div>
  );
}
