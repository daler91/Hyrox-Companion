import { formatDistanceToNow } from "date-fns";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { useState } from "react";

import type { CoachNoteInputs, TimelineEntry } from "@shared/schema";

import { Badge } from "@/components/ui/badge";

type CoachNoteSource = NonNullable<TimelineEntry["aiSource"]>;

interface CoachNoteProps {
  readonly entryId: string;
  readonly rationale: string;
  readonly source: CoachNoteSource;
  readonly updatedAt: string | Date | null | undefined;
  readonly inputsUsed: CoachNoteInputs | null | undefined;
}

function sourceLabel(source: CoachNoteSource): string {
  switch (source) {
    case "rag": return "RAG";
    case "legacy": return "Legacy";
    case "review": return "Review";
  }
}

function sourceBadgeClasses(source: CoachNoteSource): string {
  switch (source) {
    case "rag":
      return "text-emerald-600 border-emerald-200 bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:bg-emerald-950";
    case "legacy":
      return "text-amber-600 border-amber-200 bg-amber-50 dark:text-amber-400 dark:border-amber-800 dark:bg-amber-950";
    case "review":
      return "text-sky-600 border-sky-200 bg-sky-50 dark:text-sky-400 dark:border-sky-800 dark:bg-sky-950";
  }
}

function basedOnChips(inputs: CoachNoteInputs | null | undefined): string[] {
  if (!inputs) return [];
  const chips: string[] = [];
  if (inputs.planGoalPresent) chips.push("Plan goal");
  if (inputs.planPhase) chips.push(`${inputs.planPhase.charAt(0).toUpperCase()}${inputs.planPhase.slice(1)} phase`);
  if (inputs.rpeTrend && inputs.rpeTrend !== "insufficient_data") {
    chips.push(inputs.fatigueFlag ? "Fatigue flag" : `RPE ${inputs.rpeTrend}`);
  }
  if (inputs.weeklyVolumeTrend) chips.push(`Volume ${inputs.weeklyVolumeTrend}`);
  if (inputs.stationGaps && inputs.stationGaps.length > 0) {
    chips.push(`Gaps: ${inputs.stationGaps.slice(0, 2).join(", ")}${inputs.stationGaps.length > 2 ? "…" : ""}`);
  }
  if (inputs.progressionFlags && inputs.progressionFlags.length > 0) {
    chips.push(`Progression: ${inputs.progressionFlags.length} flag${inputs.progressionFlags.length > 1 ? "s" : ""}`);
  }
  if (inputs.recentWorkoutCount && inputs.recentWorkoutCount > 0) {
    chips.push(`${inputs.recentWorkoutCount} recent workouts`);
  }
  if (inputs.ragUsed) chips.push("Coaching docs");
  return chips;
}

export function CoachNote({
  entryId,
  rationale,
  source,
  updatedAt,
  inputsUsed,
}: CoachNoteProps) {
  const [expanded, setExpanded] = useState(false);

  const updatedText = (() => {
    if (!updatedAt) return null;
    try {
      const d = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
      return formatDistanceToNow(d, { addSuffix: true });
    } catch {
      return null;
    }
  })();

  const chips = basedOnChips(inputsUsed);

  return (
    <div
      className="mt-2 rounded-md border-l-2 border-l-primary/60 bg-primary/5 px-2 py-1.5"
      data-testid={`coach-note-${entryId}`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(v => !v);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className="flex w-full items-center gap-1.5 text-left text-xs font-medium text-primary hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded"
        aria-expanded={expanded}
        aria-controls={`coach-note-body-${entryId}`}
        data-testid={`coach-note-toggle-${entryId}`}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
        )}
        <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
        <span>Coach's note</span>
        {updatedText && (
          <span className="text-muted-foreground font-normal">· updated {updatedText}</span>
        )}
      </button>
      {expanded && (
        <div id={`coach-note-body-${entryId}`} className="mt-2 space-y-2">
          <p
            className="text-sm text-foreground/90 leading-relaxed"
            data-testid={`coach-note-rationale-${entryId}`}
          >
            {rationale}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={`text-[10px] ${sourceBadgeClasses(source)}`}
              data-testid={`coach-note-source-${entryId}`}
            >
              {sourceLabel(source)}
            </Badge>
            {chips.length > 0 && (
              <>
                <span className="text-[10px] text-muted-foreground">Based on:</span>
                {chips.map(chip => (
                  <Badge
                    key={chip}
                    variant="secondary"
                    className="text-[10px] font-normal"
                  >
                    {chip}
                  </Badge>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
