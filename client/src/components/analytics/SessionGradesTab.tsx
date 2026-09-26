import type { SessionGrade, SessionGradeRollupCounts, TrainingPlan } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, Loader2, Target, TrendingUp } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

import { GradeVerdictBadge } from "@/components/session-grades/GradeVerdictBadge";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSessionGrades } from "@/hooks/useSessionGrades";
import { QUERY_KEYS } from "@/lib/api";
import { getPurposeLabel } from "@/lib/sessionGradeFormat";
import { cn } from "@/lib/utils";
import { formatDayLabel } from "@/lib/weekDates";

import { CHART_CARD_CLASS } from "./chartConstants";
import { BlockGradesTable } from "./session-grades/BlockGradesTable";
import { formatShare, intentOnTarget } from "./session-grades/gradeChartData";
import { WeeklyGradesChart } from "./session-grades/WeeklyGradesChart";

const ACTIVE_PLAN = "active";
const RECENT_SESSION_COUNT = 8;

function StatTile({
  icon: Icon,
  value,
  label,
  detail,
  testId,
}: Readonly<{ icon: LucideIcon; value: string; label: string; detail?: string; testId: string }>) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-4">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div>
        <p className="text-2xl font-bold tabular-nums" data-testid={testId}>
          {value}
        </p>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
      </div>
    </div>
  );
}

function HeadlineTiles({ totals }: Readonly<{ totals: SessionGradeRollupCounts }>) {
  const easy = intentOnTarget(totals, "easy");
  const threshold = intentOnTarget(totals, "threshold");
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatTile
        icon={CheckCircle2}
        value={formatShare(easy.onTarget, easy.graded)}
        label="Easy runs stayed easy"
        detail={easy.graded > 0 ? `${easy.onTarget} of ${easy.graded}` : "None graded yet"}
        testId="text-session-grades-easy-rate"
      />
      <StatTile
        icon={Target}
        value={formatShare(threshold.onTarget, threshold.graded)}
        label="Threshold runs held"
        detail={threshold.graded > 0 ? `${threshold.onTarget} of ${threshold.graded}` : "None graded yet"}
        testId="text-session-grades-threshold-rate"
      />
      <StatTile
        icon={TrendingUp}
        value={String(totals.driftedHarder)}
        label="Drifted harder"
        detail="Threshold runs run above threshold"
        testId="text-session-grades-drifted"
      />
      <StatTile
        icon={AlertTriangle}
        value={String(totals.easyTooHard)}
        label="Easy runs not easy"
        detail="Crept up or too hard"
        testId="text-session-grades-easy-too-hard"
      />
    </div>
  );
}

function SessionRow({ grade }: Readonly<{ grade: SessionGrade }>) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 border-b py-3 last:border-b-0">
      <div className="min-w-0">
        <span className="text-xs text-muted-foreground">
          {formatDayLabel(grade.date)}
          {grade.weekNumber === null ? "" : ` · Week ${grade.weekNumber}`}
        </span>
        <Link
          href={`/?workout=${grade.workoutLogId}`}
          className="block font-medium underline-offset-4 hover:underline"
          data-testid={`link-session-grade-${grade.workoutLogId}`}
        >
          {grade.title}
        </Link>
        <p className="text-sm text-muted-foreground">{grade.evidence[0] ?? grade.headline}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="font-normal">
          {getPurposeLabel(grade.purpose)}
        </Badge>
        <GradeVerdictBadge intent={grade.intent} verdict={grade.verdict} headline={grade.headline} />
      </div>
    </li>
  );
}

function PlanPicker({ value, onChange }: Readonly<{ value: string; onChange: (value: string) => void }>) {
  const { data: plans = [] } = useQuery<TrainingPlan[]>({ queryKey: QUERY_KEYS.plans });
  if (plans.length < 2) return null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full sm:w-64" aria-label="Plan to grade" data-testid="select-session-grades-plan">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ACTIVE_PLAN}>Current plan</SelectItem>
        {plans.map((plan) => (
          <SelectItem key={plan.id} value={plan.id}>
            {plan.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function EmptyState({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={cn(CHART_CARD_CLASS, "py-8 text-center text-sm text-muted-foreground")} data-testid="session-grades-empty">
      {children}
    </div>
  );
}

/**
 * "Did the session do its job?" across a plan: whether easy runs stayed easy
 * and threshold runs held threshold, week by week and block by block.
 */
export function SessionGradesTab() {
  const [planChoice, setPlanChoice] = useState(ACTIVE_PLAN);
  const { data, isLoading, isError } = useSessionGrades(planChoice === ACTIVE_PLAN ? undefined : planChoice);

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <div className="flex justify-center py-12" data-testid="session-grades-loading">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading session grades" />
      </div>
    );
  } else if (isError || !data) {
    body = <EmptyState>Couldn&apos;t load session grades. Try again in a moment.</EmptyState>;
  } else if (!data.plan) {
    body = <EmptyState>Start a training plan and each easy and threshold run will be graded against what it was for.</EmptyState>;
  } else if (data.sessions.length === 0) {
    body = (
      <EmptyState>
        No graded runs in {data.plan.name} yet. Easy, recovery, long and threshold runs are graded once they&apos;re
        logged — connect Strava for heart-rate and pace detail.
      </EmptyState>
    );
  } else {
    body = (
      <>
        {data.totals ? <HeadlineTiles totals={data.totals} /> : null}
        <WeeklyGradesChart weeks={data.weeks} />
        <BlockGradesTable blocks={data.blocks} />
        <div className={CHART_CARD_CLASS}>
          <p className="text-sm font-semibold">Recent graded runs</p>
          <ul>
            {data.sessions.slice(0, RECENT_SESSION_COUNT).map((grade) => (
              <SessionRow key={grade.workoutLogId} grade={grade} />
            ))}
          </ul>
        </div>
      </>
    );
  }

  return (
    <div className="space-y-6" data-testid="session-grades-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Did each easy run stay easy, and each threshold run stay at threshold?
          {data?.plan ? ` ${data.plan.name}, by plan week and training block.` : ""}
        </p>
        <PlanPicker value={planChoice} onChange={setPlanChoice} />
      </div>
      {body}
    </div>
  );
}
