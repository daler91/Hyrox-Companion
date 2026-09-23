import type { TimelineEntry } from "@shared/schema";
import { isRunningExerciseName } from "@shared/schema/exercises";
import { formatPace, formatSpeed, metersToUserDistance } from "@shared/unitConversion";

import { ExplanationTooltip } from "@/components/ui/explanation-tooltip";
import { getAdherenceLabel, getAdherenceToneClassName } from "@/lib/adherenceFormat";
import { summariseMafTile } from "@/lib/mafFormat";
import { formatSecondsToMmSs } from "@/lib/statsUtils";
import { cn } from "@/lib/utils";

export interface SummaryStat {
  /** Stable suffix for the stat's data-testid (`summary-stat-${key}`). */
  readonly key: string;
  readonly label: string;
  readonly value: string;
  /** Set smaller beside the value ("km", "bpm"), so the number leads. */
  readonly unit?: string;
  /**
   * A word or two under the value saying how it rated ("Off plan", "MAF
   * peaks"). Toned by `accentClassName`, so colour is never the only signal.
   */
  readonly status?: string;
  /** Tone classes for the status chip (see adherenceFormat's tones). */
  readonly accentClassName?: string;
  /** Optional explanation, surfaced as a tooltip on the status or the label. */
  readonly explanation?: string;
}

/** A secondary device metric, listed on one line under the stats. */
export interface SummaryDetail {
  /** Stable suffix for the detail's data-testid (`summary-detail-${key}`). */
  readonly key: string;
  readonly value: string;
  readonly label: string;
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
   * Completed only. Off on surfaces that already show an RPE picker, so the
   * rating isn't printed twice on one sheet. Defaults to true.
   */
  readonly includeRpe?: boolean;
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
 * two clocks — a GPS fix settling, not a rest. Relabelling every run "Moving
 * time" for two seconds would put a caveat on the one tile nobody should have
 * to think about.
 */
const MIN_REPORTABLE_STOPPED_SEC = 60;

/**
 * Derives the at-a-glance tiles for the top of a workout-detail sheet.
 * Completed workouts lead with what was measured (duration, distance,
 * heart rate, calories), then effort and adherence; planned/preview variants show
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
  includeRpe = true,
  mafCeiling,
}: BuildWorkoutSummaryStatsArgs): SummaryStat[] {
  if (variant === "completed") {
    return buildCompletedStats(
      entry,
      includeRpe ? (rpe ?? entry.rpe ?? null) : null,
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
    label: "Avg HR",
    value: `${Math.round(avgHeartrate)}`,
    unit: "bpm",
  } as const;

  if (mafCeiling == null || !isRunningSession(entry)) return base;

  const maf = summariseMafTile({
    avgHeartRate: avgHeartrate,
    maxHeartRate: entry.maxHeartrate ?? null,
    ceiling: mafCeiling,
  });
  return {
    ...base,
    // The compliance is written into the visible status, so the accent colour
    // is never the only thing carrying it.
    status: maf.status,
    accentClassName: maf.accentClassName,
    explanation: maf.title,
  };
}

function isRunningSession(entry: TimelineEntry): boolean {
  return entry.exerciseSets?.some((set) => isRunningExerciseName(set.exerciseName)) ?? false;
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
    label: "Duration",
    value: `${entry.duration}`,
    unit: "min",
  };
  const stoppedSeconds = entry.stoppedSeconds ?? 0;
  if (stoppedSeconds < MIN_REPORTABLE_STOPPED_SEC) return base;
  return {
    ...base,
    // Qualified in the visible label, so the tooltip is never the only thing
    // saying this figure excludes the stop.
    label: "Moving time",
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
  if (entry.distanceMeters) {
    stats.push({
      key: "distance",
      label: "Distance",
      ...formatSummaryDistance(entry.distanceMeters, distanceUnit),
    });
  }
  if (entry.avgHeartrate) {
    stats.push(buildAvgHrStat(entry, mafCeiling));
  }
  if (entry.calories) {
    stats.push({ key: "calories", label: "Calories", value: `${entry.calories}`, unit: "kcal" });
  }
  if (rpe) {
    stats.push({ key: "rpe", label: "RPE", value: `${rpe}/10` });
  }
  if (showAdherence && entry.compliancePct != null) {
    stats.push({
      key: "adherence",
      label: "Adherence",
      value: `${entry.compliancePct}%`,
      status: getAdherenceLabel(entry.compliancePct),
      accentClassName: getAdherenceToneClassName(entry.compliancePct),
    });
  }

  return stats.slice(0, MAX_SUMMARY_STATS);
}

function buildTargetStats(entry: TimelineEntry, variant: "planned" | "preview"): SummaryStat[] {
  const stats: SummaryStat[] = [];

  if (entry.expectedDurationMin) {
    stats.push({
      key: "target-duration",
      label: "Target duration",
      value: `~${entry.expectedDurationMin}`,
      unit: "min",
    });
  }
  if (entry.expectedRpe) {
    stats.push({
      key: "target-rpe",
      label: "Target RPE",
      value: `~${entry.expectedRpe}/10`,
    });
  }
  if (variant === "preview" && entry.plannedSetCount) {
    stats.push({
      key: "planned-sets",
      label: "Sets",
      value: `${entry.plannedSetCount}`,
      unit: "sets",
    });
  }

  return stats.slice(0, MAX_SUMMARY_STATS);
}

function formatSummaryDistance(
  meters: number,
  distanceUnit: "km" | "miles",
): Pick<SummaryStat, "value" | "unit"> {
  const value = metersToUserDistance(meters, distanceUnit);
  return {
    value: value.toFixed(value >= 100 ? 0 : 1),
    unit: distanceUnit === "miles" ? "mi" : "km",
  };
}

/**
 * The recording's secondary numbers (pace or speed, cadence, power, relative
 * effort), listed on one quiet line under the headline stats. Calories are a
 * headline stat, so they are not repeated here. Keyed off the linked activity,
 * not `source`: a manual log that a Strava recording enriched carries the same
 * device stats as a standalone import.
 */
export function buildDeviceDetails(
  entry: TimelineEntry,
  distanceUnit: "km" | "miles",
): SummaryDetail[] {
  if (!entry.stravaActivityId && entry.source !== "strava") return [];

  const details: SummaryDetail[] = [];
  if (entry.avgSpeed && entry.avgSpeed > 0) {
    // Runners read pace; everyone else reads speed.
    details.push(
      isRunningSession(entry)
        ? { key: "pace", value: formatPace(entry.avgSpeed, distanceUnit), label: "pace" }
        : { key: "speed", value: formatSpeed(entry.avgSpeed, distanceUnit), label: "avg speed" },
    );
  }
  if (entry.avgCadence) {
    details.push({
      key: "cadence",
      value: `${Math.round(entry.avgCadence)} spm`,
      label: "cadence",
    });
  }
  if (entry.avgWatts) {
    details.push({ key: "power", value: `${entry.avgWatts} W`, label: "power" });
  }
  if (entry.sufferScore) {
    details.push({ key: "effort", value: `${entry.sufferScore}`, label: "relative effort" });
  }
  return details;
}

interface WorkoutSummaryHeaderProps {
  readonly stats: SummaryStat[];
  /** Secondary device metrics; see `buildDeviceDetails`. */
  readonly details?: SummaryDetail[];
  /** Provenance shown ahead of the details, e.g. "Strava". */
  readonly detailsSource?: string;
  readonly detailsTestId?: string;
  readonly testId?: string;
}

/**
 * At-a-glance stats card pinned to the top of each workout-detail sheet: the
 * headline numbers in a calm grid (label, then the value with its unit set
 * smaller), plus an optional single line of the recording's secondary metrics.
 * Purely presentational — derive `stats` with `buildWorkoutSummaryStats` so
 * every surface summarises the same way.
 */
export function WorkoutSummaryHeader({
  stats,
  details = [],
  detailsSource,
  detailsTestId,
  testId,
}: WorkoutSummaryHeaderProps) {
  if (stats.length === 0 && details.length === 0) return null;

  return (
    <section
      className="rounded-xl border border-card-border bg-card text-card-foreground shadow-sm"
      aria-label="Workout summary"
      data-testid={testId}
    >
      {stats.length > 0 ? (
        <dl className={cn("grid gap-x-3 gap-y-4 px-4 py-3.5", gridColumnsFor(stats.length))}>
          {stats.map((stat) => (
            <SummaryStatCell key={stat.key} stat={stat} />
          ))}
        </dl>
      ) : null}
      {details.length > 0 ? (
        <p
          className={cn(
            "flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-xs text-muted-foreground",
            stats.length > 0 && "border-t border-border/60",
          )}
          data-testid={detailsTestId}
        >
          {detailsSource ? (
            <span className="font-medium uppercase tracking-wide">{detailsSource}</span>
          ) : null}
          {details.map(({ key, value, label }) => (
            <span key={key} data-testid={`summary-detail-${key}`}>
              <span className="font-medium tabular-nums text-foreground">{value}</span> {label}
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}

function SummaryStatCell({ stat }: { readonly stat: SummaryStat }) {
  const { key, label, value, unit, status, accentClassName, explanation } = stat;
  const chip = status ? (
    <span
      className={cn(
        "inline-block max-w-full truncate rounded-full border px-1.5 py-px text-[10px] font-medium leading-4",
        accentClassName,
      )}
    >
      {status}
    </span>
  ) : null;

  return (
    <div className="min-w-0" data-testid={`summary-stat-${key}`}>
      <dt className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span className="truncate">{label}</span>
        {explanation && !chip ? (
          <ExplanationTooltip
            subject={label}
            explanation={explanation}
            testId={`summary-stat-${key}-explanation`}
          />
        ) : null}
      </dt>
      <dd className="mt-0.5 text-lg font-semibold leading-tight tabular-nums">
        {value}
        {unit ? (
          <>
            {" "}
            <span className="text-xs font-medium text-muted-foreground">{unit}</span>
          </>
        ) : null}
      </dd>
      {chip ? (
        <dd className="mt-1 flex">
          {explanation ? (
            <ExplanationTooltip
              subject={`${label}, ${status}`}
              explanation={explanation}
              className="m-0 p-0"
              testId={`summary-stat-${key}-explanation`}
            >
              {chip}
            </ExplanationTooltip>
          ) : (
            chip
          )}
        </dd>
      ) : null}
    </div>
  );
}

/**
 * Three across reads well on a phone; four and two split evenly instead, and
 * five fit one row once the sheet is wide. Six stay three across on every
 * width so no label has to truncate.
 */
function gridColumnsFor(count: number): string {
  if (count === 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-2";
  if (count === 4) return "grid-cols-2 sm:grid-cols-4";
  if (count === 5) return "grid-cols-3 sm:grid-cols-5";
  return "grid-cols-3";
}
