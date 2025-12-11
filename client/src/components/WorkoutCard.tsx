import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, Flame, MoreVertical, Calendar } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ExerciseType = 
  | "running" 
  | "skierg" 
  | "sled_push" 
  | "sled_pull" 
  | "burpees" 
  | "rowing" 
  | "farmers_carry" 
  | "wall_balls"
  | "other";

interface WorkoutCardProps {
  id: string;
  date: string;
  title: string;
  duration: number;
  exercises: ExerciseType[];
  notes?: string;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
}

const exerciseLabels: Record<ExerciseType, string> = {
  running: "Running",
  skierg: "SkiErg",
  sled_push: "Sled Push",
  sled_pull: "Sled Pull",
  burpees: "Burpees",
  rowing: "Rowing",
  farmers_carry: "Farmers Carry",
  wall_balls: "Wall Balls",
  other: "Other",
};

const exerciseColors: Record<ExerciseType, string> = {
  running: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  skierg: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  sled_push: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  sled_pull: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  burpees: "bg-red-500/10 text-red-600 dark:text-red-400",
  rowing: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  farmers_carry: "bg-green-500/10 text-green-600 dark:text-green-400",
  wall_balls: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
  other: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
};

export function WorkoutCard({ 
  id, 
  date, 
  title, 
  duration, 
  exercises, 
  notes,
  onEdit,
  onDelete,
  onDuplicate 
}: WorkoutCardProps) {
  const formatDuration = (mins: number) => {
    const hours = Math.floor(mins / 60);
    const minutes = mins % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  return (
    <Card className="hover-elevate" data-testid={`card-workout-${id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Calendar className="h-4 w-4" />
              <span>{date}</span>
            </div>
            <h3 className="text-lg font-semibold truncate">{title}</h3>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" data-testid={`button-workout-menu-${id}`}>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit?.(id)} data-testid={`button-edit-${id}`}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDuplicate?.(id)} data-testid={`button-duplicate-${id}`}>
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => onDelete?.(id)} 
                className="text-destructive"
                data-testid={`button-delete-${id}`}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <Clock className="h-4 w-4" />
            <span>{formatDuration(duration)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Flame className="h-4 w-4" />
            <span>{exercises.length} exercises</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-3">
          {exercises.slice(0, 4).map((exercise, index) => (
            <Badge 
              key={index} 
              variant="secondary" 
              className={`${exerciseColors[exercise]} border-0`}
            >
              {exerciseLabels[exercise]}
            </Badge>
          ))}
          {exercises.length > 4 && (
            <Badge variant="secondary">+{exercises.length - 4} more</Badge>
          )}
        </div>

        {notes && (
          <p className="mt-3 text-sm text-muted-foreground line-clamp-2">{notes}</p>
        )}
      </CardContent>
    </Card>
  );
}
