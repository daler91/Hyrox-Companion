import { EXERCISE_DEFINITIONS, type ExerciseName } from "@shared/schema";
import { ChevronDown, MoreVertical, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exerciseIcons } from "@/lib/exerciseIcons";
import { categoryBorderColors } from "@/lib/exerciseUtils";
import { cn } from "@/lib/utils";

interface ExerciseRowShellProps {
  readonly exerciseName: string;
  readonly displayLabel: string;
  readonly category: string;
  /** Summary shown under the title (e.g. "3 sets" or "4 sets · 500 m"). Omit to show nothing. */
  readonly subtitle?: string | null;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
  readonly onDelete?: () => void;
  readonly lowConfidence?: boolean;
  readonly children: ReactNode;
  readonly testId?: string;
}

/**
 * Shared card chrome for the two exercise-row surfaces in the app: the
 * detail-dialog table and the log-workout editor. Renders icon, label,
 * muscle badges, category border, chevron, and an optional ⋮ menu around a
 * body slot. Deliberately data-shape agnostic — both the DB-set editor and
 * the structured-block editor render their body inside this shell.
 */
export function ExerciseRowShell({
  exerciseName,
  displayLabel,
  category,
  subtitle,
  isExpanded,
  onToggle,
  onDelete,
  lowConfidence = false,
  children,
  testId,
}: ExerciseRowShellProps) {
  const def = EXERCISE_DEFINITIONS[exerciseName as ExerciseName];
  const Icon = exerciseIcons[exerciseName as ExerciseName] ?? Plus;
  const muscleGroups = (def?.muscleGroups ?? []) as readonly string[];
  const borderColor = categoryBorderColors[category];

  return (
    <Collapsible open={isExpanded} className="w-full">
      <div
        className={cn(
          "overflow-hidden rounded-2xl border border-border bg-card transition-colors border-l-4",
          borderColor,
        )}
        data-testid={testId ?? "exercise-row"}
      >
        <div className="flex w-full items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={onToggle}
            className="flex flex-1 min-w-0 items-center gap-3 text-left hover-elevate active-elevate-2 rounded-md -mx-1 px-1 py-1"
            aria-expanded={isExpanded}
            data-testid="exercise-row-toggle"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  "truncate font-semibold text-foreground",
                  lowConfidence && "text-muted-foreground",
                )}
                title={lowConfidence ? "Low-confidence parse — expand to review" : displayLabel}
              >
                {displayLabel}
              </div>
              {subtitle && (
                <div className="text-xs text-muted-foreground">{subtitle}</div>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {muscleGroups.slice(0, 2).map((mg) => (
                <Badge
                  key={mg}
                  variant="secondary"
                  className="hidden sm:inline-flex bg-muted/80 text-muted-foreground font-medium"
                >
                  {mg}
                </Badge>
              ))}
              <ChevronDown
                className={cn(
                  "h-5 w-5 text-muted-foreground transition-transform",
                  isExpanded && "rotate-180",
                )}
                aria-hidden
              />
            </div>
          </button>
          {onDelete && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground shrink-0"
                  aria-label={`Row actions for ${displayLabel}`}
                  data-testid="exercise-row-actions"
                >
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onDelete} className="text-destructive">
                  <Trash2 className="mr-2 size-4" aria-hidden /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <CollapsibleContent>
          <div className="border-t border-border px-4 py-4">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
