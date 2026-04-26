import type { TimelineAnnotation, TimelineAnnotationType, TrainingOverview } from "@shared/schema";

export const ANNOTATION_FILL: Record<TimelineAnnotationType, string> = {
  injury: "rgba(239, 68, 68, 0.18)",
  illness: "rgba(245, 158, 11, 0.18)",
  travel: "rgba(14, 165, 233, 0.18)",
  rest: "rgba(16, 185, 129, 0.18)",
};

export interface AnnotationBand {
  readonly id: string;
  readonly type: TimelineAnnotationType;
  readonly x1: string;
  readonly x2: string;
}

export function annotationToWeekBounds(
  annotation: Pick<TimelineAnnotation, "startDate" | "endDate">,
  weekStarts: string[],
): { x1: string; x2: string } | null {
  if (weekStarts.length === 0) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  const annStart = new Date(`${annotation.startDate}T00:00:00Z`).getTime();
  const annEnd = new Date(`${annotation.endDate}T00:00:00Z`).getTime();
  const overlapping = weekStarts.filter((weekStart) => {
    const weekStartMs = new Date(`${weekStart}T00:00:00Z`).getTime();
    const weekEndMs = weekStartMs + 6 * dayMs;
    return weekStartMs <= annEnd && weekEndMs >= annStart;
  });
  if (overlapping.length === 0) return null;
  overlapping.sort((a, b) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
  return { x1: overlapping[0], x2: overlapping.at(-1) ?? overlapping[0] };
}

export function buildAnnotationBands(
  overview: TrainingOverview | undefined,
  annotations: TimelineAnnotation[] | undefined,
): AnnotationBand[] {
  if (!overview || !annotations || annotations.length === 0) return [];
  const weekStarts = overview.weeklySummaries.map((week) => week.weekStart);
  const bands: AnnotationBand[] = [];
  for (const annotation of annotations) {
    const bounds = annotationToWeekBounds(annotation, weekStarts);
    if (bounds) {
      bands.push({
        id: annotation.id,
        type: annotation.type as TimelineAnnotationType,
        ...bounds,
      });
    }
  }
  return bands;
}

export function buildTrendData(overview: TrainingOverview | undefined) {
  if (!overview) {
    return {
      rpeData: [] as Array<{ weekStart: string; avgRpe: number | null }>,
      durationData: [] as Array<{ weekStart: string; avgDuration: number }>,
    };
  }
  const rpeData: Array<{ weekStart: string; avgRpe: number | null }> = [];
  const durationData: Array<{ weekStart: string; avgDuration: number }> = [];
  for (const week of overview.weeklySummaries) {
    if (week.avgRpe !== null) {
      rpeData.push({ weekStart: week.weekStart, avgRpe: week.avgRpe });
    }
    if (week.totalDuration > 0) {
      durationData.push({
        weekStart: week.weekStart,
        avgDuration: week.workoutCount > 0 ? Math.round(week.totalDuration / week.workoutCount) : 0,
      });
    }
  }
  return { rpeData, durationData };
}
