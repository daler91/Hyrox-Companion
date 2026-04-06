import { Clock, Flame } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

import type { WorkoutCardProps } from "./types";

function truncate(text: string | null | undefined, maxLen: number = 150) {
  if (!text) return null;
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + "...";
}

export function WorkoutCard({ label, entry, variant }: Readonly<WorkoutCardProps>) {
  return (
    <Card className="p-4 space-y-3" data-testid={`card-workout-${variant}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Badge variant={variant === "primary" ? "default" : "secondary"}>
          {label}
        </Badge>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          {entry.duration && (
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {entry.duration}m
            </span>
          )}
          {entry.calories && (
            <span className="flex items-center gap-1">
              <Flame className="h-3.5 w-3.5" />
              {entry.calories}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div>
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Focus</Label>
          <p className="text-sm font-medium mt-0.5">{entry.focus || "(none)"}</p>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Main Workout</Label>
          <p className="text-sm mt-0.5 whitespace-pre-wrap">{truncate(entry.mainWorkout) || "(none)"}</p>
        </div>

        {entry.notes && (
          <div>
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Notes</Label>
            <p className="text-sm mt-0.5 text-muted-foreground whitespace-pre-wrap">{truncate(entry.notes, 100)}</p>
          </div>
        )}
      </div>
    </Card>
  );
}
