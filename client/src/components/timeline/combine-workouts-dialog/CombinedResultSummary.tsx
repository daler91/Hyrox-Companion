import { Clock, Flame } from "lucide-react";

import { Label } from "@/components/ui/label";

export function CombinedResultSummary({
  duration,
  calories,
}: {
  readonly duration: number;
  readonly calories: number;
}) {
  if (duration <= 0 && calories <= 0) return null;
  return (
    <div className="rounded-md border p-4 bg-muted/30">
      <Label className="text-sm font-medium">Combined Result (auto-summed)</Label>
      <div className="mt-2 flex flex-wrap gap-4 text-sm">
        {duration > 0 && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>{duration} min total</span>
          </div>
        )}
        {calories > 0 && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Flame className="h-4 w-4" />
            <span>{calories} cal total</span>
          </div>
        )}
      </div>
    </div>
  );
}
