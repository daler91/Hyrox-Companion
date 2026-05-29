import type { PlanDay } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
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
   * Fires on a terminal choice: a specific day was picked, or the link was
   * cleared ("No plan"). By default, picking a plan alone just narrows the day
   * list and does NOT fire — so a caller that mutates on change never commits a
   * half-selection. With `commitPlanWithoutDay`, picking a plan also fires
   * (planDayId === null) so a plan-only link is committed immediately.
   */
  readonly onChange: (next: PlanDayLink) => void;
  readonly disabled?: boolean;
  readonly idPrefix?: string;
  /**
   * When true, choosing a plan immediately commits a plan-only link
   * (planDayId === null) and the day below becomes an optional refinement. Used
   * for already-logged workouts, where attaching to a plan is enough to tag and
   * filter the workout and picking a specific day is optional (adds adherence +
   * day-completion). Defaults to false (a day must be chosen to commit).
   */
  readonly commitPlanWithoutDay?: boolean;
}

/**
 * Cascading Plan -> Day picker used to connect a logged workout to a plan (or
 * change/remove that link). By default the link is to a specific scheduled day
 * and planId is derived from it server-side. With `commitPlanWithoutDay`, the
 * workout can be linked to a plan alone (no day). The day list is restricted to
 * scheduled days because a workout linked to an unscheduled day would drop off
 * the timeline.
 */
export function WorkoutPlanDayPicker({
  planId,
  planDayId,
  onChange,
  disabled = false,
  idPrefix = "workout-plan",
  commitPlanWithoutDay = false,
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
  const planDetailQuery = useQuery({
    queryKey: selectedPlanId ? QUERY_KEYS.plan(selectedPlanId) : ["plan-detail-disabled"],
    queryFn: () => api.plans.get(selectedPlanId!),
    enabled: !!selectedPlanId,
  });

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
    // When plan-only links are allowed, attaching to the plan commits right
    // away; the day dropdown is then just an optional refinement.
    if (commitPlanWithoutDay) {
      onChange({ planId: value, planDayId: null });
    }
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
              {commitPlanWithoutDay
                ? "This plan has no scheduled days yet — the workout is linked to the plan."
                : "This plan has no scheduled days yet. Schedule it first to connect a workout."}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatDayLabel(day: PlanDay): string {
  const base = `Week ${day.weekNumber} · ${day.dayName} · ${day.focus}`;
  // Flag days that already have a logged workout so re-linking is an informed
  // choice (the timeline shows the most recent workout in a day's slot).
  return day.status === "completed" ? `${base} (logged)` : base;
}
