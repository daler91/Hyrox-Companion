import type {
  RacePredictionBasis,
  RacePredictionConfidence,
  RacePredictionResponse,
  RaceSegmentPrediction,
} from "@shared/schema";
import {
  AlertTriangle,
  Dumbbell,
  Footprints,
  Info,
  Loader2,
  RefreshCw,
  Timer,
  Trophy,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { Link } from "wouter";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { formatSecondsToClock, formatSecondsToMmSs } from "@/lib/statsUtils";
import { cn } from "@/lib/utils";

import { LastUpdatedNote } from "./LastUpdatedNote";
import { useRacePrediction } from "./useRacePrediction";

const CONFIDENCE_STYLES: Record<RacePredictionConfidence, { label: string; className: string }> = {
  high: {
    label: "High confidence",
    className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
  medium: {
    label: "Medium confidence",
    className: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  low: { label: "Low confidence", className: "bg-muted text-muted-foreground" },
};

const BASIS_LABELS: Record<RacePredictionBasis, string> = {
  logged: "From your logs",
  benchmark: "Benchmark",
  blended: "Blended",
};

function ConfidenceBadge({ confidence }: Readonly<{ confidence: RacePredictionConfidence }>) {
  const style = CONFIDENCE_STYLES[confidence];
  return (
    <Badge
      className={cn("border-transparent", style.className)}
      data-testid="race-prediction-confidence"
    >
      {style.label}
    </Badge>
  );
}

function divisionLabel(division: RacePredictionResponse["division"]): string {
  return division === "pro" ? "Pro" : "Open";
}

function genderLabel(gender: RacePredictionResponse["gender"]): string {
  if (gender === "male") return "Men";
  if (gender === "female") return "Women";
  return "Unspecified";
}

function aiUnavailableCopy(reason: RacePredictionResponse["aiUnavailableReason"]): string {
  switch (reason) {
    case "ai_consent_off":
      return "This is a baseline estimate from your logged data. Enable the AI Coach in Settings for a sharper, fatigue-aware prediction.";
    case "ai_budget_exceeded":
      return "You've reached today's AI usage limit, so this is a baseline estimate from your logged data. Try again tomorrow for an AI-refined prediction.";
    case "ai_disabled":
      return "AI features are temporarily unavailable, so this is a baseline estimate from your logged data.";
    case "ai_error":
      return "The AI coach couldn't be reached just now, so this is a baseline estimate from your logged data.";
    default:
      return "This is a baseline estimate from your logged data.";
  }
}

function SegmentRow({ segment }: Readonly<{ segment: RaceSegmentPrediction }>) {
  const isRun = segment.kind === "run";
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-md px-3 py-2",
        isRun ? "bg-muted/40" : "bg-card",
      )}
      data-testid="race-prediction-segment"
    >
      <div className="flex min-w-0 items-center gap-2">
        {isRun ? (
          <Footprints className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <Dumbbell className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        )}
        <span className="truncate text-sm font-medium">{segment.label}</span>
        <Badge variant="outline" className="hidden shrink-0 text-[10px] sm:inline-flex">
          {BASIS_LABELS[segment.basis]}
          {segment.sampleSize > 0 ? ` · ${segment.sampleSize}` : ""}
        </Badge>
      </div>
      <span
        className="shrink-0 font-mono text-sm tabular-nums"
        data-testid="race-prediction-segment-split"
      >
        {formatSecondsToMmSs(segment.estimatedSeconds)}
      </span>
    </div>
  );
}

export function RacePredictorTab() {
  const { query, refresh, isRefreshing } = useRacePrediction();
  const data = query.data;

  // Spinner only on a true cold start — when a snapshot/stored result exists it
  // paints immediately as placeholderData and we skip straight to the result.
  if (query.isLoading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner iconClassName="h-6 w-6" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-muted/20 py-12 text-center text-muted-foreground">
        <AlertTriangle className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
        <p>Couldn't load your race prediction. Please try again.</p>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={isRefreshing}
          aria-label="Retry loading prediction"
          data-testid="race-prediction-retry"
        >
          {isRefreshing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {isRefreshing ? "Retrying…" : "Retry"}
        </Button>
      </div>
    );
  }

  const noData = data.dataCompleteness.stationsWithData === 0 && !data.dataCompleteness.hasRunData;
  if (noData) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed bg-muted/20 py-12 text-center text-muted-foreground">
        <div>
          <Timer className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
          <p>Log some runs and HYROX stations to predict your finish time.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Timer className="h-5 w-5 text-primary" aria-hidden="true" />
                Predicted finish
              </CardTitle>
              <CardDescription>
                {divisionLabel(data.division)} · {genderLabel(data.gender)}
                {data.ageGroup ? ` · ${data.ageGroup}` : ""} ·{" "}
                {data.dataCompleteness.stationsWithData}/{data.dataCompleteness.totalStations}{" "}
                stations logged
              </CardDescription>
            </div>
            <div className="ml-auto flex flex-col items-end gap-1">
              <Button
                variant="outline"
                onClick={refresh}
                disabled={isRefreshing}
                aria-label="Refresh prediction"
                data-testid="race-prediction-refresh"
              >
                {isRefreshing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Regenerating…
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Regenerate
                  </>
                )}
              </Button>
              <LastUpdatedNote value={data.generatedAt} stale={data.stale} className="text-right" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <span
              className="font-mono text-4xl font-bold tabular-nums"
              data-testid="race-prediction-total"
            >
              {formatSecondsToClock(data.totalFinishSeconds)}
            </span>
            <ConfidenceBadge confidence={data.overallConfidence} />
            {data.aiUsed && (
              <Badge variant="secondary" className="gap-1" data-testid="race-prediction-ai-badge">
                AI-refined
              </Badge>
            )}
          </div>
          {data.percentile && (
            <p
              className="flex items-center gap-1.5 text-sm text-muted-foreground"
              data-testid="race-prediction-percentile"
            >
              <Trophy className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
              <span>
                Faster than{" "}
                <span className="font-semibold text-foreground">
                  {data.percentile.fasterThanPct}%
                </span>{" "}
                of {data.percentile.cohortLabel}
                <span className="text-muted-foreground">
                  {" "}
                  · {data.percentile.cohortSize.toLocaleString()} athletes
                </span>
              </span>
            </p>
          )}
          {data.genderAssumed && (
            <p className="text-xs text-muted-foreground">
              Gender not set — using a neutral standard.{" "}
              <Link href="/settings" className="underline">
                Set it in Settings
              </Link>{" "}
              for division-correct loads.
            </p>
          )}
        </CardContent>
      </Card>

      {!data.aiUsed && (
        <div
          className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4 text-sm"
          data-testid="race-prediction-ai-notice"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="space-y-2">
            <p className="text-muted-foreground">{aiUnavailableCopy(data.aiUnavailableReason)}</p>
            {data.aiUnavailableReason === "ai_consent_off" && (
              <Button asChild variant="outline" size="sm">
                <Link href="/settings" data-testid="race-prediction-enable-ai">
                  Enable AI Coach
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}

      {data.narrative && (
        <Card>
          <CardContent className="prose prose-sm dark:prose-invert max-w-none pt-6">
            <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{data.narrative}</ReactMarkdown>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Segment breakdown</CardTitle>
          <CardDescription>8 runs and 8 stations, in race order</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {data.segments.map((segment) => (
            <SegmentRow key={segment.index} segment={segment} />
          ))}
          {data.transitionSeconds > 0 && (
            <div
              className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2"
              data-testid="race-prediction-transition"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Timer className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate text-sm font-medium">Transitions (roxzone)</span>
              </div>
              <span className="shrink-0 font-mono text-sm tabular-nums">
                {formatSecondsToMmSs(data.transitionSeconds)}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
