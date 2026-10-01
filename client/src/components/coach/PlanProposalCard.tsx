import type {
  EnrichedPlanAdjustmentChange,
  PlanAdjustmentChangeKind,
  PlanAdjustmentUpdatedFields,
  PlanProposalStatus,
} from "@shared/schema";
import { ArrowRight, CalendarClock, Check, ChevronDown, Loader2, Wand2, XIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { PlanProposalView } from "@/lib/api";
import { cn } from "@/lib/utils";

interface PlanProposalCardProps {
  readonly proposal: PlanProposalView;
  readonly isApplying: boolean;
  /** Apply and Dismiss show on a pending proposal when the surface handles them. */
  readonly onApply?: (proposal: PlanProposalView) => void;
  readonly onDismiss?: (id: string) => void;
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

/** Every value a diffable field can hold on either side of the comparison. */
type DiffValue = string | number | null | undefined;

const formatPlainValue = (value: DiffValue): string => (value == null ? "—" : String(value));
const formatDateValue = (value: DiffValue): string =>
  formatShortDate(value == null ? null : String(value));
const formatMinutesValue = (value: DiffValue): string => (value == null ? "—" : `${value} min`);

interface DiffFieldSpec {
  readonly key: keyof PlanAdjustmentUpdatedFields;
  readonly label: string;
  readonly format: (value: DiffValue) => string;
  /** After-side wording when the change clears an optional field. */
  readonly removedLabel?: string;
}

// Rendered in this order, which is also the order the card reads top to bottom.
const DIFF_FIELDS: readonly DiffFieldSpec[] = [
  { key: "scheduledDate", label: "Date", format: formatDateValue },
  { key: "focus", label: "Focus", format: formatPlainValue },
  { key: "mainWorkout", label: "Main workout", format: formatPlainValue },
  { key: "accessory", label: "Accessory", format: formatPlainValue, removedLabel: "Removed" },
  { key: "notes", label: "Notes", format: formatPlainValue, removedLabel: "Removed" },
  { key: "expectedDurationMin", label: "Duration", format: formatMinutesValue },
  { key: "expectedRpe", label: "RPE", format: formatPlainValue },
];

function formatAfterValue(spec: DiffFieldSpec, value: DiffValue): string {
  if (value === null && spec.removedLabel) return spec.removedLabel;
  return spec.format(value);
}

function collectFieldDiffs(change: EnrichedPlanAdjustmentChange): FieldDiff[] {
  const { updatedFields: fields, baseline } = change;
  const diffs: FieldDiff[] = [];
  for (const spec of DIFF_FIELDS) {
    const after = fields[spec.key];
    // `undefined` means "untouched"; an unchanged value isn't worth a row.
    if (after === undefined || after === baseline[spec.key]) continue;
    diffs.push({
      label: spec.label,
      before: spec.format(baseline[spec.key]),
      after: formatAfterValue(spec, after),
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
        className="flex items-center gap-1 rounded-sm text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        onClick={() => setShowRationale((v) => !v)}
        aria-expanded={showRationale}
      >
        <ChevronDown
          className={cn("h-3 w-3 transition-transform", showRationale && "rotate-180")}
          aria-hidden="true"
        />
        Why?
      </button>
      {showRationale && <p className="text-xs text-muted-foreground italic">{change.rationale}</p>}
    </div>
  );
}

/** The header for a proposal the athlete can no longer act on. */
const CLOSED_LABELS: Record<Exclude<PlanProposalStatus, "pending" | "applied">, string> = {
  dismissed: "Dismissed — plan not changed",
  superseded: "Replaced by a newer proposal",
  invalidated: "Out of date — not applied",
};

function headerLabel(status: PlanProposalStatus, count: number): string {
  const days = `${count} ${count === 1 ? "day" : "days"}`;
  if (status === "pending") return `Proposed plan changes (${days})`;
  if (status === "applied") return `Applied — ${days} updated`;
  return CLOSED_LABELS[status];
}

function StatusIcon({ status }: { readonly status: PlanProposalStatus }) {
  if (status === "applied") return <Check className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />;
  if (status === "pending") return <Wand2 className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />;
  return <XIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />;
}

function ProposalHeader({ status, count }: { readonly status: PlanProposalStatus; readonly count: number }) {
  const closed = status !== "pending" && status !== "applied";
  return (
    <div className="flex items-center gap-1.5">
      <StatusIcon status={status} />
      <span
        className={cn(
          "text-[10px] font-semibold uppercase tracking-wide",
          closed ? "text-muted-foreground" : "text-primary",
        )}
      >
        {headerLabel(status, count)}
      </span>
      <CalendarClock
        className="h-3 w-3 text-muted-foreground ml-auto shrink-0"
        aria-hidden="true"
      />
    </div>
  );
}

interface ProposalChangesProps {
  readonly changes: EnrichedPlanAdjustmentChange[];
  /** The proposal changed nothing, so its changes start folded away. */
  readonly folded: boolean;
}

function ProposalChanges({ changes, folded }: ProposalChangesProps) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((open) => !open), []);
  return (
    <>
      {folded && changes.length > 0 && (
        <button
          type="button"
          className="flex items-center gap-1 rounded-sm text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          onClick={toggle}
          aria-expanded={expanded}
          data-testid="button-toggle-proposal-changes"
        >
          <ChevronDown
            className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")}
            aria-hidden="true"
          />
          {expanded ? "Hide the changes" : "Show the changes"}
        </button>
      )}
      {(!folded || expanded) && (
        <div className="space-y-2">
          {changes.map((change) => (
            <ChangeRow key={change.planDayId} change={change} />
          ))}
        </div>
      )}
    </>
  );
}

interface ProposalActionsProps {
  readonly proposal: PlanProposalView;
  readonly isApplying: boolean;
  readonly onApply: (proposal: PlanProposalView) => void;
  readonly onDismiss: (id: string) => void;
}

function ProposalActions({ proposal, isApplying, onApply, onDismiss }: ProposalActionsProps) {
  return (
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
  );
}

/**
 * A proposal's card, at the chat turn that produced it. Pending, it offers
 * Apply and Dismiss; applied, it lists what changed; dismissed, replaced or
 * out of date, it says so and folds its changes away.
 */
export function PlanProposalCard({
  proposal,
  isApplying,
  onApply,
  onDismiss,
}: Readonly<PlanProposalCardProps>) {
  const isPending = proposal.status === "pending";
  const isClosed = !isPending && proposal.status !== "applied";

  return (
    <Card
      className={cn(
        "relative p-3 pl-4 space-y-2 border-l-4 shadow-sm",
        isClosed
          ? "border-l-muted-foreground/40 bg-muted/30"
          : "border-l-primary bg-primary/5 dark:bg-primary/10",
      )}
      data-testid={`plan-proposal-card-${proposal.id}`}
      data-status={proposal.status}
    >
      <ProposalHeader status={proposal.status} count={proposal.changes.length} />
      <ProposalChanges changes={proposal.changes} folded={isClosed} />
      {isPending && onApply && onDismiss && (
        <ProposalActions proposal={proposal} isApplying={isApplying} onApply={onApply} onDismiss={onDismiss} />
      )}
    </Card>
  );
}
