import { Loader2, RefreshCw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

import { describeAnalyticsAiError } from "../describeAnalyticsAiError";
import { LastUpdatedNote } from "../LastUpdatedNote";

interface OverviewAnalysisHeaderProps {
  readonly hasAnalysis: boolean;
  readonly isGenerating: boolean;
  readonly generatedAt?: string;
  readonly stale?: boolean;
  readonly error: unknown;
  readonly canGenerate: boolean;
  readonly onGenerate: () => void;
}

/**
 * Single control for the Overview tab's AI chart analysis: one Generate /
 * Regenerate button (the analysis is produced in one AI call and rendered inline
 * under each chart), plus a last-updated/stale note. Mirrors the affordances of
 * CoachInsightsTab's header.
 */
export function OverviewAnalysisHeader({
  hasAnalysis,
  isGenerating,
  generatedAt,
  stale,
  error,
  canGenerate,
  onGenerate,
}: OverviewAnalysisHeaderProps) {
  const errorMessage = error ? describeAnalyticsAiError(error) : null;

  return (
    <div className="space-y-2 rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-semibold">AI Chart Analysis</p>
            <p className="text-xs text-muted-foreground">
              {hasAnalysis
                ? "A plain-language read of your numbers shows under each chart below."
                : "Get a plain-language read of what each chart below is telling you."}
            </p>
          </div>
        </div>
        <div className="ml-auto flex flex-col items-end gap-1">
          <Button
            variant={hasAnalysis ? "outline" : "default"}
            onClick={onGenerate}
            disabled={isGenerating || !canGenerate}
            data-testid="button-generate-overview-analysis"
          >
            {(() => {
              if (isGenerating) {
                return (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Analyzing…
                  </>
                );
              }
              if (hasAnalysis) {
                return (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Regenerate
                  </>
                );
              }
              return (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate analysis
                </>
              );
            })()}
          </Button>
          <LastUpdatedNote value={generatedAt} stale={stale} className="text-right" />
        </div>
      </div>
      {errorMessage && (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
          role="alert"
          data-testid="text-overview-analysis-error"
        >
          {errorMessage}
        </div>
      )}
    </div>
  );
}
