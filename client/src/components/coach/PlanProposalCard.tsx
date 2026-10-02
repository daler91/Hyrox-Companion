import type {
  EnrichedPlanAdjustmentChange,
  PlanAdjustmentChangeKind,
  PlanAdjustmentUpdatedFields,
  PlanProposalStatus,
} from "@shared/schema";
import { ArrowRight, CalendarClock, Check, ChevronDown, Loader2, Undo2, Wand2, XIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { PlanProposalView } from "@/lib/api";
import { cn } from "@/lib/utils";

interface PlanProposalCardProps {
  readonly proposal: PlanProposalView;
  readonly isApplying: boolean;
  /** Apply and Dismiss show on a pending proposal when the surface handles them. */
  readonly onApply?: (proposal: PlanProposalView, planDayIds?: readonly string[]) => void;
  readonly onDismiss?: (id: string) => void;
  /** Undo shows on an applied proposal that can still be undone, when the surface handles it. */
  readonly onUndo?: (proposal: PlanProposalView) => void;
  readonly isUndoing?: boolean;
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

/** A pending change the athlete can leave out of the apply. */
interface ChangeSelection {
  readonly included: boolean;
  readonly onToggle: (planDayId: string) => void;
  readonly disabled: boolean;
}

interface ChangeRowProps {
  readonly change: EnrichedPlanAdjustmentChange;
  readonly selection?: ChangeSelection;
  /** On an applied proposal, a change the athlete left out. */
  readonly notApplied?: boolean;
}

function ChangeRow({ change, selection, notApplied = false }: ChangeRowProps) {
  const [showRationale, setShowRationale] = useState(false);
  const diffs = collectFieldDiffs(change);
  const switchId = `proposal-change-include-${change.planDayId}`;

  return (
    <div
      className={cn(
        "rounded-md border border-border/60 bg-background/60 p-2 space-y-1.5",
        (notApplied || selection?.included === false) && "opacity-60",
      )}
      data-testid={`proposal-change-${change.planDayId}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium">{change.dayLabel}</span>
        <Badge className={cn("text-[10px] shrink-0", KIND_COLORS[change.kind])}>
          {KIND_LABELS[change.kind]}
        </Badge>
        {notApplied && (
          <Badge variant="outline" className="text-[10px] shrink-0">
            Not applied
          </Badge>
        )}
        {selection && (
          <span className="ml-auto flex items-center gap-1.5">
            <label htmlFor={switchId} className="text-[11px] text-muted-foreground">
              Include
            </label>
            <Switch
              id={switchId}
              checked={selection.included}
              onCheckedChange={() => {
              selection.onToggle(change.planDayId);
            }}
              disabled={selection.disabled}
              aria-label={`Include ${change.dayLabel}`}
              data-testid={`switch-include-change-${change.planDayId}`}
            />
          </span>
        )}
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
  reverted: "Undone — plan restored",
};

function headerLabel(status: PlanProposalStatus, count: number, appliedCount: number): string {
  const days = `${count} ${count === 1 ? "day" : "days"}`;
  if (status === "pending") return `Proposed plan changes (${days})`;
  if (status === "applied") {
    return appliedCount < count ? `Applied — ${appliedCount} of ${count} changes` : `Applied — ${days} updated`;
  }
  return CLOSED_LABELS[status];
}

function StatusIcon({ status }: { readonly status: PlanProposalStatus }) {
  if (status === "applied") return <Check className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />;
  if (status === "pending") return <Wand2 className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />;
  return <XIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />;
}

interface ProposalHeaderProps {
  readonly status: PlanProposalStatus;
  readonly count: number;
  readonly appliedCount: number;
}

function ProposalHeader({ status, count, appliedCount }: ProposalHeaderProps) {
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
        {headerLabel(status, count, appliedCount)}
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
  /** Pending, with more than one change: the athlete picks which to apply. */
  readonly selection?: {
    readonly excluded: ReadonlySet<string>;
    readonly onToggle: (planDayId: string) => void;
    readonly disabled: boolean;
  };
  /** Applied: the days the apply changed, when the athlete picked some. */
  readonly appliedIds?: ReadonlySet<string>;
}

function ProposalChanges({ changes, folded, selection, appliedIds }: ProposalChangesProps) {
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
            <ChangeRow
              key={change.planDayId}
              change={change}
              selection={
                selection && {
                  included: !selection.excluded.has(change.planDayId),
                  onToggle: selection.onToggle,
                  disabled: selection.disabled,
                }
              }
              notApplied={appliedIds !== undefined && !appliedIds.has(change.planDayId)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function applyLabel(selected: number, total: number): string {
  if (selected === total) return "Apply all changes";
  if (selected === 0) return "Apply";
  return `Apply ${selected} ${selected === 1 ? "change" : "changes"}`;
}

interface ProposalActionsProps {
  readonly proposal: PlanProposalView;
  readonly isApplying: boolean;
  /** The days to apply; undefined applies every change. */
  readonly selectedIds: readonly string[] | undefined;
  readonly onApply: (proposal: PlanProposalView, planDayIds?: readonly string[]) => void;
  readonly onDismiss: (id: string) => void;
}

function ProposalActions({ proposal, isApplying, selectedIds, onApply, onDismiss }: ProposalActionsProps) {
  const selected = selectedIds?.length ?? proposal.changes.length;
  return (
    <div className="flex items-center gap-2 pt-1">
      <Button
        size="sm"
        className="min-h-11 md:min-h-8"
        onClick={() => {
              onApply(proposal, selectedIds);
            }}
        disabled={isApplying || selected === 0}
        aria-busy={isApplying}
        data-testid="button-apply-plan-proposal"
      >
        {isApplying ? (
          <Loader2 className="h-3 w-3 animate-spin mr-1" aria-hidden="true" />
        ) : (
          <Check className="h-3 w-3 mr-1" aria-hidden="true" />
        )}
        {isApplying ? "Applying…" : applyLabel(selected, proposal.changes.length)}
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

interface UndoActionProps {
  readonly proposal: PlanProposalView;
  readonly isUndoing: boolean;
  readonly onUndo: (proposal: PlanProposalView) => void;
}

function UndoAction({ proposal, isUndoing, onUndo }: UndoActionProps) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <Button
        size="sm"
        variant="outline"
        className="min-h-11 md:min-h-8"
        onClick={() => {
              onUndo(proposal);
            }}
        disabled={isUndoing}
        aria-busy={isUndoing}
        data-testid="button-undo-plan-proposal"
      >
        {isUndoing ? (
          <Loader2 className="h-3 w-3 animate-spin mr-1" aria-hidden="true" />
        ) : (
          <Undo2 className="h-3 w-3 mr-1" aria-hidden="true" />
        )}
        {isUndoing ? "Undoing…" : "Undo"}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {isUndoing ? "Undoing plan changes" : ""}
      </span>
    </div>
  );
}

/** The days left out of a pending apply: none until the athlete turns one off. */
function useExcludedChanges() {
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback((planDayId: string) => {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(planDayId)) next.delete(planDayId);
      else next.add(planDayId);
      return next;
    });
  }, []);
  return { excluded, toggle };
}

/**
 * A proposal's card, at the chat turn that produced it. Pending, it offers
 * Apply and Dismiss, with a toggle on each change when there is more than
 * one; applied, it lists what changed and offers Undo for a week; dismissed,
 * replaced, out of date or undone, it says so and folds its changes away.
 */
export function PlanProposalCard({
  proposal,
  isApplying,
  onApply,
  onDismiss,
  onUndo,
  isUndoing = false,
}: Readonly<PlanProposalCardProps>) {
  const { excluded, toggle } = useExcludedChanges();
  const isPending = proposal.status === "pending";
  const isClosed = !isPending && proposal.status !== "applied";
  const canAct = isPending && onApply !== undefined && onDismiss !== undefined;
  const canPick = canAct && proposal.changes.length > 1;
  const selectedIds =
    excluded.size > 0
      ? proposal.changes.map((change) => change.planDayId).filter((id) => !excluded.has(id))
      : undefined;
  const appliedIds =
    proposal.status === "applied" && proposal.appliedPlanDayIds ? new Set(proposal.appliedPlanDayIds) : undefined;

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
      <ProposalHeader
        status={proposal.status}
        count={proposal.changes.length}
        appliedCount={appliedIds?.size ?? proposal.changes.length}
      />
      <ProposalChanges
        changes={proposal.changes}
        folded={isClosed}
        selection={canPick ? { excluded, onToggle: toggle, disabled: isApplying } : undefined}
        appliedIds={appliedIds}
      />
      {canAct && (
        <ProposalActions
          proposal={proposal}
          isApplying={isApplying}
          selectedIds={selectedIds}
          onApply={onApply}
          onDismiss={onDismiss}
        />
      )}
      {proposal.status === "applied" && proposal.undoable && onUndo && (
        <UndoAction proposal={proposal} isUndoing={isUndoing} onUndo={onUndo} />
      )}
    </Card>
  );
}
