import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  Clock,
  XCircle,
  SkipForward,
  Flame,
  Zap,
  Activity,
  TrendingUp,
  Circle,
  BookOpen,
} from "lucide-react";
import { SiStrava } from "react-icons/si";
import type { TimelineEntry } from "@shared/schema";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { formatSpeed } from "@shared/unitConversion";

interface TimelineWorkoutCardProps {
  entry: TimelineEntry;
  onMarkComplete: (entry: TimelineEntry) => void;
  onClick: (entry: TimelineEntry) => void;
  onCombineSelect?: (entry: TimelineEntry) => void;
  isCombining?: boolean;
  combiningEntryId?: string | null;
  combiningEntryDate?: string | null;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "completed":
      return (
        <Badge className="bg-green-500/10 text-green-600 dark:text-green-400">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Completed
        </Badge>
      );
    case "planned":
      return (
        <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400">
          <Clock className="h-3 w-3 mr-1" />
          Planned
        </Badge>
      );
    case "missed":
      return (
        <Badge className="bg-red-500/10 text-red-600 dark:text-red-400">
          <XCircle className="h-3 w-3 mr-1" />
          Missed
        </Badge>
      );
    case "skipped":
      return (
        <Badge className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
          <SkipForward className="h-3 w-3 mr-1" />
          Skipped
        </Badge>
      );
    default:
      return null;
  }
}

export default function TimelineWorkoutCard({
  entry,
  onMarkComplete,
  onClick,
  onCombineSelect,
  isCombining,
  combiningEntryId,
  combiningEntryDate,
}: TimelineWorkoutCardProps) {
  const { distanceUnit } = useUnitPreferences();
  
  const isBeingCombined = combiningEntryId === entry.id;
  const isSameDate = combiningEntryDate === entry.date;
  const canBeCombinedWith = isCombining && !isBeingCombined && isSameDate;
  const isPlanned = entry.status === "planned" && entry.planDayId;

  const handleCardClick = (e: React.MouseEvent) => {
    if (canBeCombinedWith) {
      onCombineSelect?.(entry);
    } else {
      onClick(entry);
    }
  };

  const handleCompleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onMarkComplete(entry);
  };

  return (
    <Card
      className={`cursor-pointer transition-colors hover-elevate ${
        isBeingCombined
          ? "border-primary ring-2 ring-primary/30"
          : canBeCombinedWith
          ? "border-primary/50 hover:border-primary"
          : entry.status === "completed"
          ? "border-green-500/20 bg-green-500/5"
          : entry.status === "missed"
          ? "border-red-500/20 bg-red-500/5"
          : entry.status === "skipped"
          ? "border-yellow-500/20 bg-yellow-500/5"
          : ""
      }`}
      onClick={handleCardClick}
      data-testid={`card-timeline-entry-${entry.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {isPlanned && (
            <Button
              size="icon"
              variant="ghost"
              className="shrink-0 mt-0.5 text-muted-foreground hover:text-green-600"
              onClick={handleCompleteClick}
              data-testid={`button-complete-${entry.id}`}
            >
              <Circle className="h-5 w-5" />
            </Button>
          )}
          
          {entry.status === "completed" && (
            <div className="shrink-0 mt-0.5 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {getStatusBadge(entry.status)}
              {entry.source === "strava" && (
                <Badge className="bg-[#FC4C02]/10 text-[#FC4C02]">
                  <SiStrava className="h-3 w-3 mr-1" />
                  Strava
                </Badge>
              )}
              {entry.planName && (
                <Badge variant="outline" className="text-muted-foreground" data-testid={`badge-plan-${entry.id}`}>
                  <BookOpen className="h-3 w-3 mr-1" />
                  {entry.planName}
                </Badge>
              )}
              {entry.dayName && (
                <Badge variant="secondary">{entry.dayName}</Badge>
              )}
              <span className="font-medium">{entry.focus}</span>
            </div>
            <p className="text-sm text-muted-foreground mb-1">
              {entry.mainWorkout}
            </p>
            {entry.accessory && (
              <p className="text-sm text-muted-foreground/70 mb-1">
                {entry.accessory}
              </p>
            )}
            {entry.notes && (
              <p className="text-xs text-muted-foreground italic mt-2">
                {entry.notes}
              </p>
            )}
            {entry.duration && entry.source !== "strava" && (
              <p className="text-xs text-muted-foreground mt-1">
                Duration: {entry.duration} min
                {entry.rpe && ` | RPE: ${entry.rpe}`}
              </p>
            )}
            {entry.source === "strava" && (entry.calories || entry.avgWatts || entry.sufferScore || entry.avgCadence || entry.avgSpeed) && (
              <div className="flex flex-wrap gap-3 mt-2 pt-2 border-t border-border/50">
                {entry.calories && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-calories-${entry.id}`}>
                    <Flame className="h-3 w-3 text-orange-500" />
                    <span>{entry.calories} cal</span>
                  </div>
                )}
                {entry.avgWatts && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-power-${entry.id}`}>
                    <Zap className="h-3 w-3 text-yellow-500" />
                    <span>{entry.avgWatts}W</span>
                  </div>
                )}
                {entry.avgCadence && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-cadence-${entry.id}`}>
                    <Activity className="h-3 w-3 text-blue-500" />
                    <span>{Math.round(entry.avgCadence)} spm</span>
                  </div>
                )}
                {entry.avgSpeed && entry.avgSpeed > 0 && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-speed-${entry.id}`}>
                    <TrendingUp className="h-3 w-3 text-green-500" />
                    <span>{formatSpeed(entry.avgSpeed, distanceUnit)}</span>
                  </div>
                )}
                {entry.sufferScore && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-effort-${entry.id}`}>
                    <TrendingUp className="h-3 w-3 text-purple-500" />
                    <span>Effort: {entry.sufferScore}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
