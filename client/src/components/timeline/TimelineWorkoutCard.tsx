import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Pencil,
  CheckCircle2,
  Clock,
  XCircle,
  SkipForward,
  MoreVertical,
  Flame,
  Heart,
  Zap,
  Activity,
  TrendingUp,
  Trash2,
  Combine,
} from "lucide-react";
import { SiStrava } from "react-icons/si";
import type { TimelineEntry, WorkoutStatus } from "@shared/schema";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { formatSpeed } from "@shared/unitConversion";

interface TimelineWorkoutCardProps {
  entry: TimelineEntry;
  onMarkComplete: (entry: TimelineEntry) => void;
  onEdit: (entry: TimelineEntry) => void;
  onSkip: (entry: TimelineEntry) => void;
  onChangeStatus: (entry: TimelineEntry, status: WorkoutStatus) => void;
  onDelete: (entry: TimelineEntry) => void;
  onCombine?: (entry: TimelineEntry) => void;
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

function getStatusChangeOptions(currentStatus: string): { status: WorkoutStatus; label: string; icon: typeof CheckCircle2 }[] {
  const allStatuses: { status: WorkoutStatus; label: string; icon: typeof CheckCircle2 }[] = [
    { status: "completed", label: "Mark Completed", icon: CheckCircle2 },
    { status: "missed", label: "Mark Missed", icon: XCircle },
    { status: "skipped", label: "Mark Skipped", icon: SkipForward },
  ];
  return allStatuses.filter(s => s.status !== currentStatus);
}

export default function TimelineWorkoutCard({
  entry,
  onMarkComplete,
  onEdit,
  onSkip,
  onChangeStatus,
  onDelete,
  onCombine,
  isCombining,
  combiningEntryId,
  combiningEntryDate,
}: TimelineWorkoutCardProps) {
  const { distanceUnit } = useUnitPreferences();
  
  const statusOptions = getStatusChangeOptions(entry.status);
  const hasPlanDayId = !!entry.planDayId;
  const isBeingCombined = combiningEntryId === entry.id;
  const isSameDate = combiningEntryDate === entry.date;
  const canBeCombinedWith = isCombining && !isBeingCombined && isSameDate;

  return (
    <Card
      className={`${
        isBeingCombined
          ? "border-primary ring-2 ring-primary/30"
          : canBeCombinedWith
          ? "border-primary/50 hover:border-primary cursor-pointer"
          : entry.status === "completed"
          ? "border-green-500/20 bg-green-500/5"
          : entry.status === "missed"
          ? "border-red-500/20 bg-red-500/5"
          : entry.status === "skipped"
          ? "border-yellow-500/20 bg-yellow-500/5"
          : ""
      }`}
      onClick={canBeCombinedWith ? () => onCombine?.(entry) : undefined}
      data-testid={`card-timeline-entry-${entry.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {getStatusBadge(entry.status)}
              {entry.source === "strava" && (
                <Badge className="bg-[#FC4C02]/10 text-[#FC4C02]">
                  <SiStrava className="h-3 w-3 mr-1" />
                  Strava
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

          {hasPlanDayId && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  data-testid={`button-entry-menu-${entry.id}`}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {entry.status === "planned" && (
                  <DropdownMenuItem
                    onClick={() => onMarkComplete(entry)}
                    data-testid={`button-complete-${entry.id}`}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Mark Complete
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => onEdit(entry)}
                  data-testid={`button-edit-${entry.id}`}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </DropdownMenuItem>
                {onCombine && (
                  <DropdownMenuItem
                    onClick={() => onCombine(entry)}
                    data-testid={`button-combine-${entry.id}`}
                  >
                    <Combine className="h-4 w-4 mr-2" />
                    Combine with...
                  </DropdownMenuItem>
                )}
                {entry.status === "planned" && (
                  <DropdownMenuItem
                    onClick={() => onSkip(entry)}
                    data-testid={`button-skip-${entry.id}`}
                  >
                    <SkipForward className="h-4 w-4 mr-2" />
                    Skip
                  </DropdownMenuItem>
                )}
                {entry.status !== "planned" && (
                  <>
                    <DropdownMenuSeparator />
                    {statusOptions.map(({ status, label, icon: Icon }) => (
                      <DropdownMenuItem
                        key={status}
                        onClick={() => onChangeStatus(entry, status)}
                        data-testid={`button-status-${status}-${entry.id}`}
                      >
                        <Icon className="h-4 w-4 mr-2" />
                        {label}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {entry.workoutLogId && !entry.planDayId && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  data-testid={`button-entry-menu-${entry.id}`}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => onEdit(entry)}
                  data-testid={`button-edit-${entry.id}`}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </DropdownMenuItem>
                {onCombine && (
                  <DropdownMenuItem
                    onClick={() => onCombine(entry)}
                    data-testid={`button-combine-${entry.id}`}
                  >
                    <Combine className="h-4 w-4 mr-2" />
                    Combine with...
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onDelete(entry)}
                  className="text-destructive focus:text-destructive"
                  data-testid={`button-delete-${entry.id}`}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
