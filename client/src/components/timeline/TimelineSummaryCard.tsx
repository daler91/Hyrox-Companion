import type { TimelineEntry, TrainingOverview, TrainingPlan } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Flag, Flame, type LucideIcon, Target } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsAuthUserLoaded } from "@/hooks/useAuth";
import { api, QUERY_KEYS } from "@/lib/api";
import { getTodayString } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";

interface TimelineSummaryCardProps {
  readonly selectedPlanId?: string | null;
}

function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

function daysUntil(dateStr: string, today = new Date()): number {
  const target = parseLocalDate(dateStr);
  const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - todayLocal.getTime()) / (24 * 60 * 60 * 1000));
}

function choosePlan(
  plans: readonly TrainingPlan[],
  selectedPlanId: string | null | undefined,
  todayStr: string,
): TrainingPlan | undefined {
  if (selectedPlanId) return plans.find((plan) => plan.id === selectedPlanId);
  return plans.find((plan) =>
    plan.startDate != null &&
    plan.endDate != null &&
    plan.startDate <= todayStr &&
    plan.endDate >= todayStr,
  ) ?? plans.find((plan) => plan.endDate != null);
}

function getTodayEntry(entries: readonly TimelineEntry[], todayStr: string): TimelineEntry | undefined {
  return entries.find((entry) => entry.date === todayStr && entry.status === "planned")
    ?? entries.find((entry) => entry.date === todayStr && entry.status === "completed")
    ?? entries.find((entry) => entry.date === todayStr);
}

function formatRaceCountdown(plan: TrainingPlan | undefined): string {
  if (!plan?.endDate) return "No race date set";
  const days = daysUntil(plan.endDate);
  if (days === 0) return "Race day today";
  if (days > 0) return `Race day in ${days} day${days === 1 ? "" : "s"}`;
  const elapsed = Math.abs(days);
  return `Race day was ${elapsed} day${elapsed === 1 ? "" : "s"} ago`;
}

function TimelineSummarySkeleton() {
  return (
    <Card data-testid="timeline-summary-skeleton">
      <CardHeader className="space-y-2">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-4 w-52" />
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {["today", "week", "streak", "race"].map((item) => (
          <div key={item} className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-7 w-32" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SummaryItem({
  icon: Icon,
  label,
  value,
  detail,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <p className="truncate text-base font-semibold text-foreground">{value}</p>
      {detail ? <p className="line-clamp-2 text-sm text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

export function TimelineSummaryCard({ selectedPlanId = null }: TimelineSummaryCardProps) {
  const todayStr = getTodayString();
  const isAuthUserLoaded = useIsAuthUserLoaded();
  const { data: overview, isLoading: overviewLoading } = useQuery<TrainingOverview>({
    queryKey: QUERY_KEYS.trainingOverview,
    queryFn: () => api.analytics.getTrainingOverview(),
    enabled: isAuthUserLoaded,
  });
  const { data: plans = [], isLoading: plansLoading } = useQuery<TrainingPlan[]>({
    queryKey: QUERY_KEYS.plans,
    queryFn: () => api.plans.list(),
    enabled: isAuthUserLoaded,
  });
  const { data: timelineData = [], isLoading: timelineLoading } = useQuery<TimelineEntry[]>({
    queryKey: [...QUERY_KEYS.timeline, selectedPlanId],
    queryFn: () => api.timeline.get(selectedPlanId),
    enabled: isAuthUserLoaded,
  });

  if (!isAuthUserLoaded || overviewLoading || plansLoading || timelineLoading) {
    return <TimelineSummarySkeleton />;
  }

  const hasSummaryData =
    plans.length > 0 ||
    timelineData.length > 0 ||
    (overview?.currentStats?.totalWorkouts ?? 0) > 0 ||
    (overview?.weeklyCompletedWorkouts ?? 0) > 0 ||
    (overview?.currentStreak ?? 0) > 0;

  if (!hasSummaryData) return null;

  const todayEntry = getTodayEntry(timelineData, todayStr);
  const selectedPlan = choosePlan(plans, selectedPlanId, todayStr);
  const weeklyGoal = Math.max(overview?.weeklyGoal ?? 0, 1);
  const weeklyCompleted = overview?.weeklyCompletedWorkouts ?? 0;
  const streak = overview?.currentStreak ?? 0;

  const todayValue = todayEntry?.focus?.trim() || "No planned session today";
  let todayDetail = selectedPlan?.name;
  if (todayEntry?.status === "completed") {
    todayDetail = "Completed today";
  } else if (todayEntry) {
    todayDetail = todayEntry.mainWorkout;
  }

  return (
    <Card data-testid="timeline-summary-card">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">This Week</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)]">
        <SummaryItem
          icon={CalendarDays}
          label="Today"
          value={todayValue}
          detail={todayDetail ?? undefined}
        />

        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Target className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Weekly goal</span>
          </div>
          <p className="text-base font-semibold text-foreground">
            {weeklyCompleted} of {weeklyGoal} this week
          </p>
          <progress
            aria-label="Weekly workout progress"
            aria-valuetext={`${weeklyCompleted} of ${weeklyGoal} workouts completed this week`}
            className={cn(
              "h-2 w-full appearance-none overflow-hidden rounded-full bg-muted",
              "[&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-muted",
              "[&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary",
              "[&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-primary",
            )}
            max={weeklyGoal}
            value={Math.min(weeklyCompleted, weeklyGoal)}
          />
        </div>

        <SummaryItem
          icon={Flame}
          label="Streak"
          value={`${streak} day${streak === 1 ? "" : "s"}`}
          detail={streak > 0 ? "Current streak" : "No active streak"}
        />

        <SummaryItem
          icon={Flag}
          label="Race"
          value={formatRaceCountdown(selectedPlan)}
          detail={selectedPlan?.name}
        />
      </CardContent>
    </Card>
  );
}
