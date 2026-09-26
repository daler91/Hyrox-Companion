import type { PlanDayPriority, TimelineEntry } from "@shared/schema";
import { useState } from "react";

import { useSetSessionPriority } from "@/hooks/useMissedRecovery";
import { cn } from "@/lib/utils";

const TIERS: ReadonlyArray<{ value: PlanDayPriority; label: string; help: string }> = [
  {
    value: "key",
    label: "Key",
    help: "The plan is built on it. If it's missed, it's worth fitting back in.",
  },
  {
    value: "supporting",
    label: "Supporting",
    help: "Volume around the key sessions. If it's missed, fit it in when there's room.",
  },
  {
    value: "optional",
    label: "Optional",
    help: "Nice to have. If it's missed, the plan doesn't need it back.",
  },
];

interface SessionPriorityControlProps {
  readonly entry: TimelineEntry;
}

/**
 * Mark a planned session key, supporting or optional. The tier decides what
 * the recovery sheet recommends when the session is missed, and tells the AI
 * coach what to protect when a week has to get lighter.
 */
export function SessionPriorityControl({ entry }: SessionPriorityControlProps) {
  // A rest day has no tier, a logged or skipped session is past deciding, and a
  // race-week day's tier comes from the race (race day key, shakeout optional).
  if (
    !entry.planDayId ||
    !entry.priority ||
    entry.raceDerived ||
    entry.status === "completed" ||
    entry.status === "skipped"
  ) {
    return null;
  }
  return <PriorityChips entryId={entry.id} planDayId={entry.planDayId} initial={entry.priority} />;
}

interface PriorityChipsProps {
  readonly entryId: string;
  readonly planDayId: string;
  readonly initial: PlanDayPriority;
}

/**
 * The chosen tier is held locally as well as saved: the sheet's `entry` is a
 * snapshot taken when it opened, so it would otherwise keep showing the old
 * tier until the sheet was reopened.
 */
function PriorityChips({ entryId, planDayId, initial }: PriorityChipsProps) {
  const [value, setValue] = useState<PlanDayPriority>(initial);
  const { mutate: setPriority, isPending } = useSetSessionPriority();
  const current = TIERS.find((tier) => tier.value === value);

  return (
    <fieldset className="space-y-2" data-testid={`session-priority-${entryId}`}>
      <legend className="text-sm font-medium">How much does this session matter?</legend>
      <div className="flex flex-wrap gap-2">
        {TIERS.map((tier) => {
          const selected = tier.value === value;
          return (
            <button
              key={tier.value}
              type="button"
              aria-pressed={selected}
              disabled={isPending}
              onClick={() => {
                if (selected) return;
                const previous = value;
                setValue(tier.value);
                setPriority(
                  { planDayId, priority: tier.value },
                  { onError: () => setValue(previous) },
                );
              }}
              data-testid={`session-priority-${tier.value}`}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                selected ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              {tier.label}
            </button>
          );
        })}
      </div>
      {current ? <p className="text-xs text-muted-foreground">{current.help}</p> : null}
    </fieldset>
  );
}
