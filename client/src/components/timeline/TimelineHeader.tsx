import { Button } from "@/components/ui/button";
import { CalendarCheck } from "lucide-react";

interface TimelineHeaderProps {
  onScrollToToday: () => void;
}

export default function TimelineHeader({
  onScrollToToday,
}: Readonly<TimelineHeaderProps>) {
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
      <Button
        variant="outline"
        onClick={onScrollToToday}
        data-testid="button-jump-to-today"
      >
        <CalendarCheck className="h-4 w-4 mr-2" />
        Go to Today
      </Button>
    </div>
  );
}
