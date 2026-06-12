import type { TimelineEntry } from "@shared/schema";
import { metersToUserDistance } from "@shared/unitConversion";
import type { LucideIcon } from "lucide-react";
import { Flame, Gauge, HeartPulse, ListChecks, MapPin, Target, Timer } from "lucide-react";

import { getAdherenceToneClassName } from "@/lib/adherenceFormat";
import { cn } from "@/lib/utils";

export interface SummaryStat {
  /** Stable suffix for the tile's data-testid (`summary-stat-${key}`). */
  readonly key: string;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly value: string;
  /** Optional accent (e.g. adherence colour coding) applied to the tile. */
  readonly accentClassName?: string;
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
}

const MAX_SUMMARY_STATS = 6;

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
}: BuildWorkoutSummaryStatsArgs): SummaryStat[] {
  if (variant === "completed") {
    return buildCompletedStats(entry, rpe ?? entry.rpe ?? null, distanceUnit, showAdherence);
  }
  return buildTargetStats(entry, variant);
}

function buildCompletedStats(
  entry: TimelineEntry,
  rpe: number | null,
  distanceUnit: "km" | "miles",
  showAdherence: boolean,
): SummaryStat[] {
  const stats: SummaryStat[] = [];

  if (entry.duration) {
    stats.push({ key: "duration", icon: Timer, label: "Duration", value: `${entry.duration} min` });
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
    stats.push({
      key: "avg-hr",
      icon: HeartPulse,
      label: "Avg HR",
      value: `${Math.round(entry.avgHeartrate)} bpm`,
    });
  }
  if (entry.calories) {
    stats.push({ key: "calories", icon: Flame, label: "Calories", value: `${entry.calories} kcal` });
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
      {stats.map(({ key, icon: Icon, label, value, accentClassName }) => (
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
        </div>
      ))}
    </div>
  );
}
