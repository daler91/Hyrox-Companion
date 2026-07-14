import type { EnrichedPlanAdjustmentChange, PlanAdjustmentChangeKind } from "@shared/schema";
import { ArrowRight, CalendarClock, Check, ChevronDown, Loader2, Wand2, XIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { PlanProposalView } from "@/lib/api";
import { cn } from "@/lib/utils";

interface PlanProposalCardProps {
  readonly proposal: PlanProposalView;
  readonly isApplying: boolean;
  readonly onApply: (proposal: PlanProposalView) => void;
  readonly onDismiss: (id: string) => void;
}

const KIND_LABELS: Record<PlanAdjustmentChangeKind, string> = {
  reschedule: "Rescheduled",
  workout_update: "Workout updated",
  rest_conversion: "Rest day",
  tune: "Tuned",
};

const KIND_COLORS: Record<PlanAdjustmentChangeKind, string> = {
  reschedule: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  workout_update: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  rest_conversion: "bg-green-500/10 text-green-600 dark:text-green-400",
  tune: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
};

function formatShortDate(date: string | null | undefined): string {
  if (!date) return "—";
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

interface FieldDiff {
  label: string;
  before: string;
  after: string;
}

function collectFieldDiffs(change: EnrichedPlanAdjustmentChange): FieldDiff[] {
  const { updatedFields: fields, baseline } = change;
  const diffs: FieldDiff[] = [];
  if (fields.scheduledDate !== undefined && fields.scheduledDate !== baseline.scheduledDate) {
    diffs.push({
      label: "Date",
      before: formatShortDate(baseline.scheduledDate),
      after: formatShortDate(fields.scheduledDate),
    });
  }
  if (fields.focus !== undefined && fields.focus !== baseline.focus) {
    diffs.push({ label: "Focus", before: baseline.focus, after: fields.focus });
  }
  if (fields.mainWorkout !== undefined && fields.mainWorkout !== baseline.mainWorkout) {
    diffs.push({ label: "Main workout", before: baseline.mainWorkout, after: fields.mainWorkout });
  }
  if (fields.accessory !== undefined && fields.accessory !== baseline.accessory) {
    diffs.push({
      label: "Accessory",
      before: baseline.accessory ?? "—",
      after: fields.accessory ?? "Removed",
    });
  }
  if (fields.notes !== undefined && fields.notes !== baseline.notes) {
    diffs.push({ label: "Notes", before: baseline.notes ?? "—", after: fields.notes ?? "Removed" });
  }
  if (
    fields.expectedDurationMin !== undefined &&
    fields.expectedDurationMin !== baseline.expectedDurationMin
  ) {
    diffs.push({
      label: "Duration",
      before: baseline.expectedDurationMin != null ? `${baseline.expectedDurationMin} min` : "—",
      after: fields.expectedDurationMin != null ? `${fields.expectedDurationMin} min` : "—",
    });
  }
  if (fields.expectedRpe !== undefined && fields.expectedRpe !== baseline.expectedRpe) {
    diffs.push({
      label: "RPE",
      before: baseline.expectedRpe != null ? `${baseline.expectedRpe}` : "—",
      after: fields.expectedRpe != null ? `${fields.expectedRpe}` : "—",
    });
  }
  return diffs;
}

function ChangeRow({ change }: { readonly change: EnrichedPlanAdjustmentChange }) {
  const [showRationale, setShowRationale] = useState(false);
  const diffs = collectFieldDiffs(change);

  return (
    <div
      className="rounded-md border border-border/60 bg-background/60 p-2 space-y-1.5"
      data-testid={`proposal-change-${change.planDayId}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium">{change.dayLabel}</span>
        <Badge className={cn("text-[10px] shrink-0", KIND_COLORS[change.kind])}>
          {KIND_LABELS[change.kind]}
        </Badge>
      </div>
      <div className="space-y-1">
        {diffs.map((diff) => (
          <div key={diff.label} className="text-xs">
            <span className="font-medium text-muted-foreground">{diff.label}: </span>
            <span className="line-through decoration-muted-foreground/60 text-muted-foreground break-words">
              {diff.before}
            </span>
            <ArrowRight className="inline h-3 w-3 mx-1 text-muted-foreground" aria-hidden="true" />
            <span className="break-words">{diff.after}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        onClick={() => setShowRationale((v) => !v)}
        aria-expanded={showRationale}
      >
        <ChevronDown
          className={cn("h-3 w-3 transition-transform", showRationale && "rotate-180")}
          aria-hidden="true"
        />
        Why?
      </button>
      {showRationale && (
        <p className="text-xs text-muted-foreground italic">{change.rationale}</p>
      )}
    </div>
  );
}

export function PlanProposalCard({
  proposal,
  isApplying,
  onApply,
  onDismiss,
}: Readonly<PlanProposalCardProps>) {
  const isAppliedView = proposal.status === "applied";
  const count = proposal.changes.length;

  return (
    <Card
      className="relative p-3 pl-4 space-y-2 border-l-4 border-l-primary bg-primary/5 dark:bg-primary/10 shadow-sm"
      data-testid={`plan-proposal-card-${proposal.id}`}
    >
      <div className="flex items-center gap-1.5">
        {isAppliedView ? (
          <Check className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />
        ) : (
          <Wand2 className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />
        )}
        <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">
          {isAppliedView
            ? `Applied — ${count} day${count === 1 ? "" : "s"} updated`
            : `Proposed plan changes (${count} day${count === 1 ? "" : "s"})`}
        </span>
        <CalendarClock className="h-3 w-3 text-muted-foreground ml-auto shrink-0" aria-hidden="true" />
      </div>

      <div className="space-y-2">
        {proposal.changes.map((change) => (
          <ChangeRow key={change.planDayId} change={change} />
        ))}
      </div>

      {!isAppliedView && (
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            className="min-h-11 md:min-h-8"
            onClick={() => onApply(proposal)}
            disabled={isApplying}
            aria-busy={isApplying}
            data-testid="button-apply-plan-proposal"
          >
            {isApplying ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" aria-hidden="true" />
            ) : (
              <Check className="h-3 w-3 mr-1" aria-hidden="true" />
            )}
            {isApplying ? "Applying…" : `Apply all changes`}
          </Button>
          <span role="status" aria-live="polite" className="sr-only">
            {isApplying ? "Applying plan changes" : ""}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 md:min-h-8"
            onClick={() => onDismiss(proposal.id)}
            disabled={isApplying}
            data-testid="button-dismiss-plan-proposal"
          >
            <XIcon className="h-3 w-3 mr-1" aria-hidden="true" />
            Dismiss
          </Button>
        </div>
      )}
    </Card>
  );
}
