import { Badge } from "@/components/ui/badge";
import { DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CheckCircle2, Clock, XCircle, SkipForward } from "lucide-react";
import { SiStrava } from "react-icons/si";

interface WorkoutDetailHeaderProps {
  status: string;
  source?: string;
  dayName?: string;
  focus: string;
  isEditing: boolean;
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

export function WorkoutDetailHeader({ status, source, dayName, focus, isEditing }: Readonly<WorkoutDetailHeaderProps>) {
  return (
    <DialogHeader>
      <div className="flex items-center gap-2 flex-wrap">
        {getStatusBadge(status)}
        {source === "strava" && (
          <Badge className="bg-[#FC4C02]/10 text-[#FC4C02]">
            <SiStrava className="h-3 w-3 mr-1" />
            Strava
          </Badge>
        )}
        {dayName && (
          <Badge variant="secondary">{dayName}</Badge>
        )}
      </div>
      <DialogTitle className="text-left mt-2">
        {isEditing ? "Edit Workout" : focus}
      </DialogTitle>
      <DialogDescription className="sr-only">
        View and manage workout details
      </DialogDescription>
    </DialogHeader>
  );
}
