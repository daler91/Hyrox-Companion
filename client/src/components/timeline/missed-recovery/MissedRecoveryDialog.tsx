import type {
  ApplyMissedRecoveryBody,
  MissedRecoveryOption,
  MissedSessionRecoveryPreview,
  RecoveryImpact,
  RecoveryMoveOption,
  TimelineEntry,
} from "@shared/schema";
import { CalendarPlus, Feather, Info, Lightbulb, Loader2, Scissors, TriangleAlert } from "lucide-react";
import { type ComponentType, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { useApplyMissedRecovery, useMissedRecoveryPreview } from "@/hooks/useMissedRecovery";
import { cn } from "@/lib/utils";

import {
  describeDay,
  describeKept,
  formatDayChip,
  formatLoadChange,
  formatLongDay,
  formatMinutes,
  formatWeekLabel,
  priorityLabel,
  weekContains,
} from "./recoveryFormat";

export interface MissedRecoveryRequest {
  readonly entry: TimelineEntry;
  /** The option tapped on the card, or null to open on the recommendation. */
  readonly option: MissedRecoveryOption | null;
}

interface MissedRecoveryDialogProps {
  readonly request: MissedRecoveryRequest | null;
  readonly onClose: () => void;
}

interface OptionCopy {
  readonly value: MissedRecoveryOption;
  readonly title: string;
  readonly icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  readonly describe: (preview: MissedSessionRecoveryPreview) => string;
}

const OPTIONS: readonly OptionCopy[] = [
  {
    value: "fold",
    title: "Fold it into another day",
    icon: CalendarPlus,
    describe: (preview) => `Do the whole session (${formatMinutes(preview.session.durationMin)}) on another day.`,
  },
  {
    value: "shorten",
    title: "Shorten it",
    icon: Scissors,
    describe: (preview) =>
      `Do about ${Math.round(preview.shorten.keptFraction * 100)}% of it (${formatMinutes(preview.shorten.durationMin)}) on another day.`,
  },
  {
    value: "let_go",
    title: "Let it go",
    icon: Feather,
    describe: () => "Leave it missed. The rest of the plan carries on as it is.",
  },
];

function moveOptionFor(preview: MissedSessionRecoveryPreview, option: MissedRecoveryOption): RecoveryMoveOption | null {
  if (option === "fold") return preview.fold;
  if (option === "shorten") return preview.shorten;
  return null;
}

function isAvailable(preview: MissedSessionRecoveryPreview, option: MissedRecoveryOption): boolean {
  return moveOptionFor(preview, option)?.available ?? true;
}

/** The day an option opens on: the recommended one when it is the recommended option, else its own best day. */
function startingDate(preview: MissedSessionRecoveryPreview, option: "fold" | "shorten"): string | null {
  const { recommendation } = preview;
  if (recommendation.action === option && recommendation.targetDate) return recommendation.targetDate;
  return preview[option].suggestedDate;
}

/** "today", "tomorrow" or "Thu 25 Sep", for the middle of a sentence. */
function dayInSentence(date: string, today: string): string {
  const label = formatDayChip(date, today);
  return label === "Today" || label === "Tomorrow" ? label.toLowerCase() : label;
}

function confirmLabel(option: MissedRecoveryOption, date: string | null, today: string): string {
  if (option === "let_go") return "Let it go";
  if (!date) return "Choose a day";
  const day = dayInSentence(date, today);
  return option === "fold" ? `Fold into ${day}` : `Shorten and move to ${day}`;
}

export function MissedRecoveryDialog({ request, onClose }: MissedRecoveryDialogProps) {
  const planDayId = request?.entry.planDayId ?? null;
  const preview = useMissedRecoveryPreview(planDayId);
  const apply = useApplyMissedRecovery();

  if (!request || !planDayId) return null;
  const { entry } = request;
  const priority = preview.data?.priority ?? entry.priority;

  const confirm = (body: ApplyMissedRecoveryBody) => {
    apply.mutate({ planDayId, body }, { onSuccess: onClose });
  };

  return (
    <ResponsiveSheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Missed: ${entry.focus || "session"}`}
      description={[formatLongDay(entry.date), priority ? priorityLabel(priority) : null].filter(Boolean).join(" · ")}
      testId="missed-recovery-sheet"
    >
      {preview.isPending ? (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground" data-testid="missed-recovery-loading">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Working out what each option does to your plan…
        </p>
      ) : null}
      {preview.isError ? (
        <div className="space-y-3 py-6" data-testid="missed-recovery-error">
          <p className="text-sm text-muted-foreground">Couldn't work out your options just now.</p>
          <Button variant="outline" size="sm" onClick={() => void preview.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}
      {preview.data ? (
        <RecoveryChooser
          key={`${planDayId}:${request.option ?? "recommended"}`}
          preview={preview.data}
          initialOption={request.option}
          isApplying={apply.isPending}
          onCancel={onClose}
          onConfirm={confirm}
        />
      ) : null}
    </ResponsiveSheet>
  );
}

interface RecoveryChooserProps {
  readonly preview: MissedSessionRecoveryPreview;
  readonly initialOption: MissedRecoveryOption | null;
  readonly isApplying: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (body: ApplyMissedRecoveryBody) => void;
}

function RecoveryChooser({ preview, initialOption, isApplying, onCancel, onConfirm }: RecoveryChooserProps) {
  // Seeded once from the preview and the tapped option; keyed on both by the
  // parent, so a different session or option starts fresh without an effect.
  const [option, setOption] = useState<MissedRecoveryOption>(
    initialOption && isAvailable(preview, initialOption) ? initialOption : preview.recommendation.action,
  );
  const [dates, setDates] = useState({
    fold: startingDate(preview, "fold"),
    shorten: startingDate(preview, "shorten"),
  });

  const move = moveOptionFor(preview, option);
  const date = option === "let_go" ? null : dates[option];
  const target = move?.targets.find((candidate) => candidate.date === date) ?? null;
  const impact: RecoveryImpact | null = option === "let_go" ? preview.letGo.impact : (target?.impact ?? null);

  const submit = () => {
    if (option === "let_go") onConfirm({ action: "let_go" });
    else if (date) onConfirm({ action: option, targetDate: date });
  };

  return (
    <div className="space-y-5" data-testid="missed-recovery-chooser">
      <p className="flex gap-2 rounded-md bg-muted/60 p-3 text-sm" data-testid="missed-recovery-recommendation">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <span>{preview.recommendation.reason}</span>
      </p>

      <RadioGroup
        value={option}
        onValueChange={(value) => setOption(value as MissedRecoveryOption)}
        aria-label="What to do with the missed session"
        className="gap-2"
      >
        {OPTIONS.map((copy) => (
          <OptionCard
            key={copy.value}
            copy={copy}
            preview={preview}
            selected={option === copy.value}
          />
        ))}
      </RadioGroup>

      {move?.available ? (
        <DayPicker
          move={move}
          today={preview.today}
          value={date}
          onChange={(next) => {
            if (option !== "let_go") setDates((current) => ({ ...current, [option]: next }));
          }}
        />
      ) : null}

      {impact ? <ImpactPanel impact={impact} preview={preview} /> : null}

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onCancel} data-testid="missed-recovery-cancel">
          Cancel
        </Button>
        <Button
          onClick={submit}
          disabled={isApplying || (option !== "let_go" && !target)}
          data-testid="missed-recovery-confirm"
        >
          {isApplying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
          {confirmLabel(option, date, preview.today)}
        </Button>
      </div>
    </div>
  );
}

interface OptionCardProps {
  readonly copy: OptionCopy;
  readonly preview: MissedSessionRecoveryPreview;
  readonly selected: boolean;
}

function OptionCard({ copy, preview, selected }: OptionCardProps) {
  const move = moveOptionFor(preview, copy.value);
  const disabled = move !== null && !move.available;
  const recommended = preview.recommendation.action === copy.value;
  const id = `missed-recovery-option-${copy.value}`;
  const Icon = copy.icon;
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer gap-3 rounded-md border p-3 transition-colors",
        selected && "border-primary bg-primary/5",
        disabled && "cursor-not-allowed opacity-60",
      )}
      data-testid={`${id}-card`}
    >
      <RadioGroupItem id={id} value={copy.value} disabled={disabled} className="mt-1" />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-center gap-2 font-medium">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
          {copy.title}
          {recommended ? (
            <Badge className="bg-primary/10 text-primary" data-testid={`${id}-recommended`}>
              Recommended
            </Badge>
          ) : null}
        </span>
        <span className="block text-sm text-muted-foreground">
          {disabled ? move?.unavailableReason : copy.describe(preview)}
        </span>
        {copy.value === "shorten" && !disabled && preview.shorten.changes.length > 0 ? (
          <span className="block text-xs text-muted-foreground" data-testid="missed-recovery-shorten-changes">
            {preview.shorten.changes.map((change) => `${change.label}: ${change.from} → ${change.to}`).join(" · ")}
          </span>
        ) : null}
      </span>
    </label>
  );
}

interface DayPickerProps {
  readonly move: RecoveryMoveOption;
  readonly today: string;
  readonly value: string | null;
  readonly onChange: (date: string) => void;
}

function DayPicker({ move, today, value, onChange }: DayPickerProps) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Which day?</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {move.targets.map((target) => {
          const selected = target.date === value;
          const best = target.date === move.suggestedDate;
          const cautions = target.impact.notes.filter((note) => note.tone === "warning").length;
          return (
            <button
              key={target.date}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(target.date)}
              data-testid={`missed-recovery-day-${target.date}`}
              className={cn(
                "flex min-h-14 flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected ? "border-primary bg-primary/5" : "hover:bg-accent",
              )}
            >
              <span className="flex w-full items-center gap-1 font-medium">
                <span className="whitespace-nowrap">{formatDayChip(target.date, today)}</span>
                {cautions > 0 ? (
                  <TriangleAlert
                    className="ml-auto h-3.5 w-3.5 shrink-0 text-warning"
                    aria-label={`${cautions} caution${cautions === 1 ? "" : "s"}`}
                  />
                ) : null}
              </span>
              <span className="w-full truncate text-xs text-muted-foreground">{describeDay(target.sessions)}</span>
              {best ? <span className="text-xs font-medium text-primary">Best fit</span> : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

interface ImpactPanelProps {
  readonly impact: RecoveryImpact;
  readonly preview: MissedSessionRecoveryPreview;
}

/** "What this does to your plan": the day, each week it touches, and anything to watch. */
function ImpactPanel({ impact, preview }: ImpactPanelProps) {
  const missedWeek = impact.weeks.find((week) => weekContains(week.weekStart, preview.missedDate));
  return (
    <section
      aria-live="polite"
      aria-labelledby="missed-recovery-impact-heading"
      className="space-y-3 rounded-md border p-3"
      data-testid="missed-recovery-impact"
    >
      <h3 id="missed-recovery-impact-heading" className="text-sm font-semibold">
        What this does to your plan
      </h3>
      <p className="text-sm">{impact.summary}</p>
      <p className="text-sm text-muted-foreground" data-testid="missed-recovery-kept">
        {describeKept(impact.keptFraction, impact.keptMinutes, preview.session.durationMin)}
        {preview.session.estimated ? " — an estimate, with no exercise table to go on" : ""}
      </p>
      <ul className="space-y-1 text-sm">
        {impact.weeks.map((week) => (
          <li key={week.weekStart} className="flex flex-wrap justify-between gap-x-3" data-testid={`missed-recovery-week-${week.weekStart}`}>
            <span className="font-medium">{formatWeekLabel(week.weekStart, preview.today)}</span>
            <span className="tabular-nums text-muted-foreground">
              {formatMinutes(week.minutesBefore)} → {formatMinutes(week.minutesAfter)} · load {formatLoadChange(week)}
            </span>
          </li>
        ))}
        {missedWeek && missedWeek.keyScheduled > 0 ? (
          <li className="flex flex-wrap justify-between gap-x-3" data-testid="missed-recovery-key-sessions">
            <span className="font-medium">Key sessions that week</span>
            <span className="tabular-nums text-muted-foreground">
              {missedWeek.keyBefore} → {missedWeek.keyAfter} of {missedWeek.keyScheduled}
            </span>
          </li>
        ) : null}
      </ul>
      {impact.notes.length > 0 ? (
        <ul className="space-y-1.5" data-testid="missed-recovery-notes">
          {impact.notes.map((note) => (
            <li
              key={note.code}
              className={cn("flex gap-2 text-sm", note.tone === "warning" ? "text-warning" : "text-muted-foreground")}
            >
              {note.tone === "warning" ? (
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              ) : (
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              )}
              <span>{note.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
