import type { SessionGrade } from "@shared/schema";
import { Target } from "lucide-react";
import { Link } from "wouter";

import { GradeVerdictBadge } from "@/components/session-grades/GradeVerdictBadge";
import { Badge } from "@/components/ui/badge";
import { useWorkoutSessionGrade } from "@/hooks/useSessionGrades";
import { describeGradeBasis, formatGradePace, getPurposeLabel } from "@/lib/sessionGradeFormat";

import { DetailSection } from "./shared/DetailSection";

interface Metric {
  label: string;
  value: string;
}

function keyMetrics(grade: SessionGrade, distanceUnit: string): Metric[] {
  const metrics: Metric[] = [];
  const push = (label: string, value: string | number | null | undefined, suffix = "") => {
    if (value !== null && value !== undefined) metrics.push({ label, value: `${value}${suffix}` });
  };
  if (grade.threshold) {
    const t = grade.threshold;
    if (t.segmentation === "reps") push("Reps", t.repCount);
    if (t.segmentation !== "whole_run") push("Work", t.workMinutes, " min");
    push("Work pace", formatGradePace(t.workAvgPaceSecPerKm, distanceUnit));
    push("Work HR", t.workAvgHr, " bpm");
    push("In Z5", t.pctWorkZ5, "%");
  } else if (grade.easy) {
    const e = grade.easy;
    push("Avg HR", e.avgHr, " bpm");
    push("Above easy", e.pctAboveCeiling, "%");
    push("Pace", formatGradePace(e.avgPaceSecPerKm, distanceUnit));
    push("HR drift", e.hrDriftPct, "%");
  }
  return metrics;
}

export function SessionGradeView({
  grade,
  distanceUnit,
}: Readonly<{ grade: SessionGrade; distanceUnit: string }>) {
  const basis = describeGradeBasis(grade);
  const metrics = keyMetrics(grade, distanceUnit);
  return (
    <div className="space-y-3" data-testid="session-grade">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-normal">
          {getPurposeLabel(grade.purpose)}
        </Badge>
        <GradeVerdictBadge intent={grade.intent} verdict={grade.verdict} testId="session-grade-verdict" />
      </div>
      <p className="text-sm font-medium">{grade.headline}</p>
      {grade.evidence.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {grade.evidence.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {metrics.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label}>
              <dt className="text-xs text-muted-foreground">{metric.label}</dt>
              <dd className="font-medium tabular-nums">{metric.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {grade.ungradeableReason === "no_targets" ? (
        <Link href="/settings" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          Add your max heart rate in Settings
        </Link>
      ) : null}
      {basis ? <p className="text-xs text-muted-foreground">{basis}</p> : null}
    </div>
  );
}

/**
 * "Did it do its job?" on a completed workout: whether the run matched what
 * its plan day was for. Renders nothing for workouts we do not grade (not on
 * the plan, not a run, or a session kind with no grader yet).
 */
export function SessionGradeCard({
  workoutLogId,
  distanceUnit,
}: Readonly<{ workoutLogId: string | null; distanceUnit: string }>) {
  const { data } = useWorkoutSessionGrade(workoutLogId);
  const grade = data?.grade;
  if (!grade) return null;
  return (
    <DetailSection title="Did it do its job?" icon={Target} testId={`session-grade-card-${grade.workoutLogId}`}>
      <SessionGradeView grade={grade} distanceUnit={distanceUnit} />
    </DetailSection>
  );
}
