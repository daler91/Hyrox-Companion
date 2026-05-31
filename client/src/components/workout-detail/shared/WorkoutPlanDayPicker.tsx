import type { PlanDay } from "@shared/schema";
import { skipToken, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, QUERY_KEYS } from "@/lib/api";

const NO_PLAN = "__none__";

export interface PlanDayLink {
  readonly planId: string | null;
  readonly planDayId: string | null;
}

interface WorkoutPlanDayPickerProps {
  /** The plan the workout is currently connected to (drives the day list). */
  readonly planId: string | null;
  /** The plan day the workout currently fulfils. */
  readonly planDayId: string | null;
  /**
   * Fires only on a terminal choice: a specific day was picked, or the link was
   * cleared ("No plan"). Picking a plan alone just narrows the day list and does
   * NOT fire — so a caller that mutates on change never commits a half-selection.
   */
  readonly onChange: (next: PlanDayLink) => void;
  readonly disabled?: boolean;
  readonly idPrefix?: string;
}

/**
 * Cascading Plan -> Day picker used to connect a logged workout to a plan day
 * (or change/remove that link). The link is always to a specific day; planId is
 * derived from the chosen day server-side. The day list is restricted to
 * scheduled days because a workout linked to an unscheduled day would drop off
 * the timeline.
 */
export function WorkoutPlanDayPicker({
  planId,
  planDayId,
  onChange,
  disabled = false,
  idPrefix = "workout-plan",
}: WorkoutPlanDayPickerProps) {
  // Internal draft so picking a plan can narrow the day list without committing.
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(planId);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(planDayId);

  // Re-sync when the committed value changes from the outside (a successful
  // save, an error rollback, or the picker being reused for another workout).
  // Adjusting state during render is React's recommended alternative to a
  // prop-sync effect — https://react.dev/learn/you-might-not-need-an-effect
  const [committed, setCommitted] = useState<{ planId: string | null; planDayId: string | null }>({
    planId,
    planDayId,
  });
  if (committed.planId !== planId || committed.planDayId !== planDayId) {
    setCommitted({ planId, planDayId });
    setSelectedPlanId(planId);
    setSelectedDayId(planDayId);
  }

  const plansQuery = useQuery({
    queryKey: QUERY_KEYS.plans,
    queryFn: () => api.plans.list(),
  });
  const planDetailQuery = usePlanDetailQuery(selectedPlanId);

  const plans = plansQuery.data ?? [];
  const scheduledDays = (planDetailQuery.data?.days ?? []).filter((day) => day.scheduledDate != null);

  const handlePlanChange = (value: string) => {
    if (value === NO_PLAN) {
      setSelectedPlanId(null);
      setSelectedDayId(null);
      onChange({ planId: null, planDayId: null });
      return;
    }
    // New plan: clear the day so the athlete makes a fresh choice within it.
    setSelectedPlanId(value);
    setSelectedDayId(null);
  };

  const handleDayChange = (value: string) => {
    setSelectedDayId(value);
    onChange({ planId: selectedPlanId, planDayId: value });
  };

  if (plansQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid={`${idPrefix}-loading`}>
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading plans...
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid={`${idPrefix}-empty`}>
        No plans yet — create a plan to connect this workout.
      </p>
    );
  }

  const daysLoading = planDetailQuery.isLoading;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-plan`}>Plan</Label>
        <Select value={selectedPlanId ?? NO_PLAN} onValueChange={handlePlanChange} disabled={disabled}>
          <SelectTrigger id={`${idPrefix}-plan`} aria-label="Select training plan" data-testid={`${idPrefix}-plan-select`}>
            <SelectValue placeholder="No plan" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PLAN}>No plan</SelectItem>
            {plans.map((plan) => (
              <SelectItem key={plan.id} value={plan.id}>
                {plan.name} ({plan.totalWeeks} weeks)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedPlanId ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-day`}>Day</Label>
          <Select
            value={selectedDayId ?? undefined}
            onValueChange={handleDayChange}
            disabled={disabled || daysLoading || scheduledDays.length === 0}
          >
            <SelectTrigger id={`${idPrefix}-day`} aria-label="Select plan day" data-testid={`${idPrefix}-day-select`}>
              <SelectValue placeholder={daysLoading ? "Loading days..." : "Choose a day"} />
            </SelectTrigger>
            <SelectContent>
              {scheduledDays.map((day) => (
                <SelectItem key={day.id} value={day.id}>
                  {formatDayLabel(day)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!daysLoading && scheduledDays.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              This plan has no scheduled days yet. Schedule it first to connect a workout.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Loads the selected plan's days. Idle (skipToken) until a plan is chosen, which
 * keeps the cascading picker's dependent-query wiring out of the component body.
 */
function usePlanDetailQuery(selectedPlanId: string | null) {
  return useQuery({
    queryKey: selectedPlanId ? QUERY_KEYS.plan(selectedPlanId) : ["plan-detail-disabled"],
    queryFn: selectedPlanId ? () => api.plans.get(selectedPlanId) : skipToken,
  });
}

function formatDayLabel(day: PlanDay): string {
  const base = `Week ${day.weekNumber} · ${day.dayName} · ${day.focus}`;
  // Flag days that already have a logged workout so re-linking is an informed
  // choice (the timeline shows the most recent workout in a day's slot).
  return day.status === "completed" ? `${base} (logged)` : base;
}
