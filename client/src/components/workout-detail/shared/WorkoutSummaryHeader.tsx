import type { TimelineEntry } from "@shared/schema";
import { isRunningExerciseName } from "@shared/schema/exercises";
import { metersToUserDistance } from "@shared/unitConversion";
import type { LucideIcon } from "lucide-react";
import { Flame, Gauge, HeartPulse, ListChecks, MapPin, Target, Timer } from "lucide-react";

import { ExplanationTooltip } from "@/components/ui/explanation-tooltip";
import { getAdherenceToneClassName } from "@/lib/adherenceFormat";
import { summariseMafTile } from "@/lib/mafFormat";
import { formatSecondsToMmSs } from "@/lib/statsUtils";
import { cn } from "@/lib/utils";

export interface SummaryStat {
  /** Stable suffix for the tile's data-testid (`summary-stat-${key}`). */
  readonly key: string;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly value: string;
  /** Optional accent (e.g. adherence colour coding) applied to the tile. */
  readonly accentClassName?: string;
  /** Optional explanation for an accented tile, surfaced as a tooltip. */
  readonly explanation?: string;
}

export type SummaryVariant = "completed" | "planned" | "preview";

interface BuildWorkoutSummaryStatsArgs {
  readonly entry: TimelineEntry;
  readonly variant: SummaryVariant;
  /**
   * Live RPE for completed workouts — ReviewSurface passes the
   * useWorkoutDetail-backed value so the tile updates the moment the
   * athlete picks a new rating, before the timeline cache refetches.
   */
  readonly rpe?: number | null;
  readonly distanceUnit: "km" | "miles";
  /** Gate for the adherence tile (mirrors the timeline card's badge gate). */
  readonly showAdherence: boolean;
  /**
   * The athlete's MAF ceiling, when they train to one. Tones and labels the
   * Avg HR tile on running sessions; absent (or on a non-running session) the
   * tile renders exactly as it always has.
   */
  readonly mafCeiling?: number | null;
}

const MAX_SUMMARY_STATS = 6;

/**
 * Below this, a stop is not worth mentioning.
 *
 * Outdoor recordings routinely carry a few seconds of difference between their
 * two clocks — a GPS fix settling, not a rest. Labelling every run "(moving)"
 * for two seconds would put a caveat on the one tile nobody should have to
 * think about.
 */
const MIN_REPORTABLE_STOPPED_SEC = 60;

/**
 * Derives the at-a-glance tiles for the top of a workout-detail sheet.
 * Completed workouts lead with what happened (duration, effort,
 * adherence, headline Strava numbers); planned/preview variants show
 * the session's targets instead, labelled as targets so they can't be
 * mistaken for results. Returns [] when there's nothing worth
 * summarising — the header renders nothing in that case.
 */
export function buildWorkoutSummaryStats({
  entry,
  variant,
  rpe,
  distanceUnit,
  showAdherence,
  mafCeiling,
}: BuildWorkoutSummaryStatsArgs): SummaryStat[] {
  if (variant === "completed") {
    return buildCompletedStats(
      entry,
      rpe ?? entry.rpe ?? null,
      distanceUnit,
      showAdherence,
      mafCeiling ?? null,
    );
  }
  return buildTargetStats(entry, variant);
}

/**
 * The Avg HR tile, toned against the MAF ceiling when there is one to tone it
 * against. Gated on the session containing running work: an average of 165 on
 * wall balls is not a MAF violation, it's wall balls.
 */
function buildAvgHrStat(entry: TimelineEntry, mafCeiling: number | null): SummaryStat {
  const avgHeartrate = entry.avgHeartrate ?? 0;
  const base = {
    key: "avg-hr",
    icon: HeartPulse,
    label: "Avg HR",
    value: `${Math.round(avgHeartrate)} bpm`,
  } as const;

  const isRunning = entry.exerciseSets?.some((set) => isRunningExerciseName(set.exerciseName));
  if (mafCeiling == null || !isRunning) return base;

  const maf = summariseMafTile({
    avgHeartRate: avgHeartrate,
    maxHeartRate: entry.maxHeartrate ?? null,
    ceiling: mafCeiling,
  });
  return {
    ...base,
    // The compliance is written into the visible label, so the accent colour is
    // never the only thing carrying it.
    label: `Avg HR${maf.labelSuffix}`,
    accentClassName: maf.accentClassName,
    explanation: maf.title,
  };
}

/**
 * The duration tile, named as moving time when the recording also knows how
 * long the athlete stood still.
 *
 * The value is unchanged — it is the same figure every other surface shows,
 * and `workout_logs.duration` is moving time by design (see the column note).
 * What the stop buys is context: a 16 km run with half an hour standing at an
 * aid station otherwise reads exactly like one run straight through. It rides
 * in the label and the tooltip rather than taking a tile of its own, which
 * would push another stat off the end of the six.
 */
function buildDurationStat(entry: TimelineEntry): SummaryStat {
  const base: SummaryStat = {
    key: "duration",
    icon: Timer,
    label: "Duration",
    value: `${entry.duration} min`,
  };
  const stoppedSeconds = entry.stoppedSeconds ?? 0;
  if (stoppedSeconds < MIN_REPORTABLE_STOPPED_SEC) return base;
  return {
    ...base,
    // Qualified in the visible label, so the tooltip is never the only thing
    // saying this figure excludes the stop.
    label: "Duration (moving)",
    explanation: `${formatSecondsToMmSs(stoppedSeconds)} of this session was spent stopped. Duration counts moving time only, so the stop is not in it.`,
  };
}

function buildCompletedStats(
  entry: TimelineEntry,
  rpe: number | null,
  distanceUnit: "km" | "miles",
  showAdherence: boolean,
  mafCeiling: number | null,
): SummaryStat[] {
  const stats: SummaryStat[] = [];

  if (entry.duration) {
    stats.push(buildDurationStat(entry));
  }
  if (rpe) {
    stats.push({ key: "rpe", icon: Gauge, label: "RPE", value: `${rpe}/10` });
  }
  if (showAdherence && entry.compliancePct != null) {
    stats.push({
      key: "adherence",
      icon: Target,
      label: "Adherence",
      value: `${entry.compliancePct}%`,
      accentClassName: getAdherenceToneClassName(entry.compliancePct),
    });
  }
  if (entry.distanceMeters) {
    stats.push({
      key: "distance",
      icon: MapPin,
      label: "Distance",
      value: formatSummaryDistance(entry.distanceMeters, distanceUnit),
    });
  }
  if (entry.avgHeartrate) {
    stats.push(buildAvgHrStat(entry, mafCeiling));
  }
  if (entry.calories) {
    stats.push({
      key: "calories",
      icon: Flame,
      label: "Calories",
      value: `${entry.calories} kcal`,
    });
  }

  return stats.slice(0, MAX_SUMMARY_STATS);
}

function buildTargetStats(entry: TimelineEntry, variant: "planned" | "preview"): SummaryStat[] {
  const stats: SummaryStat[] = [];

  if (entry.expectedDurationMin) {
    stats.push({
      key: "target-duration",
      icon: Timer,
      label: "Target duration",
      value: `~${entry.expectedDurationMin} min`,
    });
  }
  if (entry.expectedRpe) {
    stats.push({
      key: "target-rpe",
      icon: Gauge,
      label: "Target RPE",
      value: `~${entry.expectedRpe}/10`,
    });
  }
  if (variant === "preview" && entry.plannedSetCount) {
    stats.push({
      key: "planned-sets",
      icon: ListChecks,
      label: "Sets",
      value: `${entry.plannedSetCount} sets`,
    });
  }

  return stats.slice(0, MAX_SUMMARY_STATS);
}

function formatSummaryDistance(meters: number, distanceUnit: "km" | "miles"): string {
  const value = metersToUserDistance(meters, distanceUnit);
  const unitLabel = distanceUnit === "miles" ? "mi" : "km";
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${unitLabel}`;
}

interface WorkoutSummaryHeaderProps {
  readonly stats: SummaryStat[];
  readonly testId?: string;
}

/**
 * At-a-glance stats strip pinned to the top of each workout-detail
 * sheet: a 2-up tile grid on mobile, a wrapping row of pills on
 * desktop. Purely presentational — derive `stats` with
 * `buildWorkoutSummaryStats` so every surface summarises the same way.
 */
export function WorkoutSummaryHeader({ stats, testId }: WorkoutSummaryHeaderProps) {
  if (stats.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" data-testid={testId}>
      {stats.map(({ key, icon: Icon, label, value, accentClassName, explanation }) => (
        <div
          key={key}
          className={cn(
            "flex items-center gap-2.5 rounded-lg border bg-muted/40 px-3 py-2",
            accentClassName,
          )}
          data-testid={`summary-stat-${key}`}
        >
          <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
          <span className="min-w-0">
            <span className="block text-sm font-semibold leading-tight tabular-nums">{value}</span>
            <span className="block truncate text-[11px] uppercase tracking-wide opacity-70">
              {label}
            </span>
          </span>
          {explanation && (
            <ExplanationTooltip
              subject={label}
              explanation={explanation}
              className="ml-auto"
              testId={`summary-stat-${key}-explanation`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
