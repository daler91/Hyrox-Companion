import type { PersonalRecordMetric, WeeklyReview } from "@shared/schema";
import { getStoredDistanceUnit } from "@shared/unitConversion";
import { formatMinutes, minutes } from "@shared/units";
import { HeartPulse, Plane, Stethoscope, Trophy, Umbrella } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";

const METRIC_LABELS: Record<PersonalRecordMetric, string> = {
  maxWeight: "Heaviest",
  maxDistance: "Furthest",
  bestTime: "Fastest",
  estimated1RM: "Est. 1RM",
};

const ANNOTATION_ICONS: Record<string, typeof Plane> = {
  injury: Stethoscope,
  illness: HeartPulse,
  travel: Plane,
  rest: Umbrella,
};

/**
 * Render a PR value in the unit it is actually stored in.
 *
 * Every branch here used to assume a unit the column does not guarantee:
 *
 *   - `bestTime` came from `exercise_sets.time`, which is MINUTES, and went to
 *     `formatSecondsToMmSs` -- a 12-minute best rendered as "0:12" (audit H2).
 *   - `maxDistance` and the weight metrics are stored in the athlete's OWN
 *     display unit, not a canonical one (the S5 sentinel in unitConversion.ts),
 *     so a miles-preference athlete's feet were labelled "m" and a lbs-preference
 *     athlete's pounds were labelled "kg".
 */
function formatRecordValue(
  record: WeeklyReview["personalRecords"][number],
  units: { weightLabel: string; distanceUnit: "km" | "miles" },
): string {
  if (record.metric === "bestTime") return formatMinutes(minutes(record.value));
  if (record.metric === "maxDistance") {
    return `${record.value} ${getStoredDistanceUnit(units.distanceUnit)}`;
  }
  return `${record.value} ${units.weightLabel}`;
}

/**
 * Records and context.
 *
 * Annotations sit beside the records rather than in a footnote because they
 * change how the numbers above should be read: a light week inside a logged
 * injury is the plan working, not the athlete failing, and the page should say
 * so before it says anything else about volume.
 */
export function WeeklyReviewHighlights({ review }: { readonly review: WeeklyReview }) {
  const { weightLabel, distanceUnit } = useUnitPreferences();
  const { personalRecords, annotations } = review;
  if (personalRecords.length === 0 && annotations.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {annotations.length > 0 && (
        <Card data-testid="weekly-review-annotations">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Context</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {annotations.map((annotation) => {
              const Icon = ANNOTATION_ICONS[annotation.type] ?? Umbrella;
              return (
                <div key={annotation.id} className="flex items-start gap-2 text-sm">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <span className="font-medium capitalize">{annotation.type}</span>
                    {annotation.note && (
                      <span className="text-muted-foreground"> — {annotation.note}</span>
                    )}
                  </div>
                </div>
              );
            })}
            <p className="pt-1 text-xs text-muted-foreground">
              Sessions during this range aren&apos;t a shortfall — the week was meant to look different.
            </p>
          </CardContent>
        </Card>
      )}

      {personalRecords.length > 0 && (
        <Card data-testid="weekly-review-prs">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-4 w-4" aria-hidden="true" />
              Records this week
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {personalRecords.map((record) => (
                <li
                  key={`${record.exerciseName}-${record.metric}`}
                  className="flex items-baseline justify-between gap-3 text-sm"
                  data-testid={`weekly-review-pr-${record.metric}`}
                >
                  <span className="min-w-0 truncate font-medium">
                    {record.customLabel ?? record.exerciseName}
                  </span>
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <Badge variant="outline">{METRIC_LABELS[record.metric]}</Badge>
                    <span className="tabular-nums">
                      {formatRecordValue(record, { weightLabel, distanceUnit })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
