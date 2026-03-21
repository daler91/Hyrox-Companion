import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Zap, Loader2, Check, XIcon } from "lucide-react";
import { RagDebugBadge } from "@/components/RagDebugBadge";
import type { RagInfo } from "@/hooks/useChatSession";

export interface Suggestion {
  workoutId: string;
  date: string;
  focus: string;
  targetField: "mainWorkout" | "accessory" | "notes";
  action: "replace" | "append";
  recommendation: string;
  rationale: string;
  priority: "high" | "medium" | "low";
}

interface SuggestionCardProps {
  readonly suggestion: Suggestion;
  readonly ragInfo?: RagInfo;
  readonly onApply: () => void;
  readonly onDismiss: () => void;
  readonly isApplying: boolean;
}

const FIELD_LABELS: Record<Suggestion["targetField"], string> = {
  mainWorkout: "Main Workout",
  accessory: "Accessory",
  notes: "Notes",
};

const PRIORITY_COLORS: Record<Suggestion["priority"], string> = {
  high: "bg-red-500/10 text-red-600 dark:text-red-400",
  medium: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  low: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
};

export function SuggestionCard({ suggestion, ragInfo, onApply, onDismiss, isApplying }: Readonly<SuggestionCardProps>) {
  const fieldLabel = FIELD_LABELS[suggestion.targetField] || "Notes";
  
  const actionLabel = suggestion.action === "append" ? "Add to" : "Replace";
  
  const priorityColor = PRIORITY_COLORS[suggestion.priority] || PRIORITY_COLORS.low;

  return (
    <Card className="p-3 space-y-2" data-testid={`suggestion-card-${suggestion.workoutId}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">{suggestion.focus}</span>
            <Badge variant="secondary" className="text-[10px] shrink-0">
              {suggestion.date}
            </Badge>
            <Badge className={`text-[10px] shrink-0 ${priorityColor}`}>
              {suggestion.priority}
            </Badge>
          </div>
          <div className="flex items-center gap-1 mt-1">
            <Zap className="h-3 w-3 text-primary shrink-0" />
            <span className="text-xs text-muted-foreground">
              {actionLabel} {fieldLabel}
            </span>
          </div>
        </div>
      </div>
      
      <p className="text-sm">{suggestion.recommendation}</p>
      <p className="text-xs text-muted-foreground italic">{suggestion.rationale}</p>
      {ragInfo && <RagDebugBadge ragInfo={ragInfo} />}
      
      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          onClick={onApply}
          disabled={isApplying}
          data-testid={`button-apply-${suggestion.workoutId}`}
        >
          {isApplying ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <Check className="h-3 w-3 mr-1" />
          )}
          Apply
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDismiss}
          disabled={isApplying}
          data-testid={`button-dismiss-${suggestion.workoutId}`}
        >
          <XIcon className="h-3 w-3 mr-1" />
          Dismiss
        </Button>
      </div>
    </Card>
  );
}
