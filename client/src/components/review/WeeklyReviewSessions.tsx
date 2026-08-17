import type { PlanDaySkipReason, WeeklyReview } from "@shared/schema";
import { CircleSlash, Dumbbell } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDayLabel } from "@/lib/weekDates";

const SKIP_REASON_LABELS: Record<PlanDaySkipReason, string> = {
  ill: "Ill",
  injured: "Injured",
  schedule: "Schedule",
  low_energy: "Low energy",
};

const STATUS_LABELS: Record<WeeklyReview["plannedDays"][number]["status"], string> = {
  missed: "Missed",
  skipped: "Skipped",
  planned: "Still to do",
};

/**
 * What the athlete actually did, one row per logged session.
 *
 * The add/drop counts are the point of the row, not the compliance percentage:
 * "92%" says a session was close to the prescription, while "+2 / −1 sets" says
 * what they changed — which is the part worth talking to a coach about.
 */
function SessionRow({ session }: { readonly session: WeeklyReview["sessions"][number] }) {
  const changes = [
    session.addedSetCount ? `+${session.addedSetCount}` : null,
    session.removedSetCount ? `−${session.removedSetCount}` : null,
  ].filter(Boolean);

  return (
    <li
      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border py-3 last:border-b-0"
      data-testid={`weekly-review-session-${session.workoutLogId}`}
    >
      <div className="min-w-0">
        <span className="text-xs text-muted-foreground">{formatDayLabel(session.date)}</span>
        <p className="font-medium">{session.focus}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {session.durationMin !== null && <span className="tabular-nums">{session.durationMin} min</span>}
        {session.rpe !== null && <span className="tabular-nums">RPE {session.rpe}</span>}
        {session.compliancePct !== null && (
          <Badge variant="outline" className="tabular-nums">
            {session.compliancePct}% to plan
          </Badge>
        )}
        {changes.length > 0 && (
          <Badge variant="outline" data-testid={`weekly-review-session-changes-${session.workoutLogId}`}>
            {changes.join(" / ")} sets
          </Badge>
        )}
        {session.planDayId === null && <Badge variant="secondary">Off plan</Badge>}
      </div>
    </li>
  );
}

function PlannedDayRow({ day }: { readonly day: WeeklyReview["plannedDays"][number] }) {
  return (
    <li
      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border py-3 last:border-b-0"
      data-testid={`weekly-review-planned-${day.planDayId}`}
    >
      <div className="min-w-0">
        <span className="text-xs text-muted-foreground">{formatDayLabel(day.date)}</span>
        <p className="font-medium text-muted-foreground">{day.focus}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {day.excused ? (
          // The day sits inside a declared absence — same wording as the
          // timeline's badge, and it replaces the status label so an excused
          // week never reads "Missed" here. The highlights card above names
          // which absence.
          <Badge
            variant="outline"
            className="text-muted-foreground"
            data-testid={`weekly-review-excused-${day.planDayId}`}
          >
            Not counted
          </Badge>
        ) : (
          <Badge variant="outline">{STATUS_LABELS[day.status]}</Badge>
        )}
        {day.skipReason && (
          <Badge variant="secondary" data-testid={`weekly-review-skip-reason-${day.planDayId}`}>
            {SKIP_REASON_LABELS[day.skipReason]}
          </Badge>
        )}
      </div>
    </li>
  );
}

export function WeeklyReviewSessions({ review }: { readonly review: WeeklyReview }) {
  const { sessions, plannedDays, isCurrentWeek } = review;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card data-testid="weekly-review-sessions-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Dumbbell className="h-4 w-4" aria-hidden="true" />
            What you did
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground" data-testid="weekly-review-sessions-empty">
              {isCurrentWeek ? "Nothing logged yet this week." : "No sessions logged this week."}
            </p>
          ) : (
            <ul>
              {sessions.map((session) => (
                <SessionRow key={session.workoutLogId} session={session} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {plannedDays.length > 0 && (
        <Card data-testid="weekly-review-planned-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CircleSlash className="h-4 w-4" aria-hidden="true" />
              {isCurrentWeek ? "Still on the plan" : "What didn't happen"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul>
              {plannedDays.map((day) => (
                <PlannedDayRow key={day.planDayId} day={day} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
