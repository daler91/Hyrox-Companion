import { AlertTriangle,X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface ExerciseHeaderProps {
  readonly displayLabel: string;
  readonly blockLabel?: string;
  readonly setCount: number;
  readonly exerciseName: string;
  readonly confidence?: number;
  readonly onRemove: () => void;
}

function getConfidenceClasses(confidence: number): string {
  if (confidence >= 80) return "bg-green-500/10 text-green-600 dark:text-green-400";
  if (confidence >= 60) return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400";
  return "bg-red-500/10 text-red-600 dark:text-red-400";
}

export function ExerciseHeader({ displayLabel, blockLabel, setCount, exerciseName, confidence, onRemove }: ExerciseHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2 mb-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h4 className="font-semibold">{displayLabel}{blockLabel ? ` ${blockLabel}` : ""}</h4>
        <span className="text-xs text-muted-foreground">{setCount} {setCount === 1 ? "set" : "sets"}</span>
        {confidence != null && confidence < 90 && (
          <Badge
            variant="secondary"
            className={`text-[10px] ${getConfidenceClasses(confidence)}`}
            data-testid={`badge-confidence-${exerciseName}`}
          >
            {confidence < 60 && <AlertTriangle className="h-3 w-3 mr-0.5" />}
            AI {confidence}%
          </Badge>
        )}
      </div>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" variant="ghost" onClick={onRemove} data-testid={`button-remove-${exerciseName}`} aria-label={`Remove ${displayLabel}`}>
              <X className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Remove exercise</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
