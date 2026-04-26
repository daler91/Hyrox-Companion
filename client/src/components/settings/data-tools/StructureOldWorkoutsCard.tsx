import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import type { ParseResults } from "./useWorkoutReparseTools";

interface StructureOldWorkoutsCardProps {
  readonly unstructuredCount: number | null;
  readonly parseResults: ParseResults | null;
  readonly isFinding: boolean;
  readonly isParsing: boolean;
  readonly onFind: () => void;
  readonly onParse: () => void;
  readonly onReset: () => void;
}

export function StructureOldWorkoutsCard({
  unstructuredCount,
  parseResults,
  isFinding,
  isParsing,
  onFind,
  onParse,
  onReset,
}: StructureOldWorkoutsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          Structure Old Workouts
        </CardTitle>
        <CardDescription>
          Use AI to convert free-text workout descriptions into structured exercise data
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {unstructuredCount === null && parseResults === null ? (
          <div>
            <p className="text-sm text-muted-foreground mb-4">
              Find and parse unstructured workout descriptions to extract exercise data using AI.
            </p>
            <Button
              onClick={onFind}
              disabled={isFinding}
              data-testid="button-find-unstructured"
              variant="outline"
            >
              {isFinding ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Searching...
                </>
              ) : (
                "Find Unstructured Workouts"
              )}
            </Button>
          </div>
        ) : null}

        {unstructuredCount !== null && !parseResults ? (
          <div>
            <p className="text-sm text-muted-foreground mb-4" data-testid="text-unstructured-count">
              Found {unstructuredCount} workouts without structured exercise data
            </p>
            {unstructuredCount > 0 ? (
              <Button onClick={onParse} disabled={isParsing} data-testid="button-batch-reparse">
                {isParsing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Parsing...
                  </>
                ) : (
                  "Parse All with AI"
                )}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                All your workouts are already structured.
              </p>
            )}
          </div>
        ) : null}

        {parseResults ? (
          <div>
            <p className="text-sm text-muted-foreground mb-4" data-testid="text-parse-results">
              Parsed {parseResults.success} workouts successfully. {parseResults.failed} could not
              be parsed.
            </p>
            <Button onClick={onReset} variant="outline" size="sm">
              Run Again
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
