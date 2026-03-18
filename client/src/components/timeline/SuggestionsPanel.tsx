import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Lightbulb, X, ChevronDown, ChevronUp } from "lucide-react";
import type { WorkoutSuggestion } from "./types";

interface SuggestionsPanelProps {
  readonly suggestions: WorkoutSuggestion[];
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onDismiss: (workoutId: string) => void;
  readonly onApply: (suggestion: WorkoutSuggestion) => void;
}



function getBadgeVariant(priority: string) {
  if (priority === "high") return "destructive";
  if (priority === "medium") return "default";
  return "secondary";
}

export default function SuggestionsPanel({
  suggestions,
  isOpen,
  onOpenChange,
  onDismiss,
  onApply,
}: Readonly<SuggestionsPanelProps>) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <Collapsible open={isOpen} onOpenChange={onOpenChange}>
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-2">
          <CollapsibleTrigger asChild>
            <div className="flex items-center justify-between cursor-pointer">
              <CardTitle className="text-base flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-primary" />
                AI Training Suggestions
                <Badge variant="secondary">{suggestions.length}</Badge>
              </CardTitle>
              {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-3">
            {suggestions.map((suggestion) => (
              <div
                key={suggestion.workoutId}
                className="p-3 rounded-md bg-background border"
                data-testid={`suggestion-${suggestion.workoutId}`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant={getBadgeVariant(suggestion.priority)}
                    >
                      {suggestion.priority}
                    </Badge>
                    <span className="text-sm font-medium">{suggestion.workoutFocus}</span>
                    <span className="text-xs text-muted-foreground">{suggestion.workoutDate}</span>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => onDismiss(suggestion.workoutId)}
                    data-testid={`dismiss-suggestion-${suggestion.workoutId}`}
                    aria-label="Dismiss suggestion"
                    title="Dismiss suggestion"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
                <p className="text-sm mb-2">{suggestion.recommendation}</p>
                <p className="text-xs text-muted-foreground mb-3">{suggestion.rationale}</p>
                <Button
                  size="sm"
                  onClick={() => onApply(suggestion)}
                  data-testid={`apply-suggestion-${suggestion.workoutId}`}
                >
                  Apply to Workout
                </Button>
              </div>
            ))}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
