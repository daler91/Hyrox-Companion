import type { TimelineAnnotation } from "@shared/schema";
import { useCallback, useMemo } from "react";

import { useDeleteTimelineAnnotation } from "@/components/timeline/annotations/useTimelineAnnotationMutations";
import { useMoveTimelineEntry } from "@/hooks/useMoveTimelineEntry";

export function useTimelinePageController(selectedPlanId: string | null, annotations: TimelineAnnotation[]) {
  const { moveEntry, isMoving } = useMoveTimelineEntry(selectedPlanId);

  const annotationsByDate = useMemo(() => {
    // ⚡ Bolt Performance Optimization:
    // Replaced array.reduce() with a single-pass for...of loop to eliminate the
    // overhead of reduce callbacks, improving aggregation performance for large timelines.
    const acc: Record<string, TimelineAnnotation[]> = {};
    for (const annotation of annotations) {
      if (!acc[annotation.startDate]) acc[annotation.startDate] = [];
      acc[annotation.startDate].push(annotation);
    }
    return acc;
  }, [annotations]);

  // The same mutation as the annotations dialog's delete, timeline refresh
  // included. CL10 (CODEBASE_ANALYSIS_2026-10-03)
  const deleteAnnotationMutation = useDeleteTimelineAnnotation();

  const handleDeleteAnnotation = useCallback((id: string) => {
    deleteAnnotationMutation.mutate(id);
  }, [deleteAnnotationMutation]);

  return {
    annotationsByDate,
    moveEntry,
    isMoving,
    handleDeleteAnnotation,
    isAnnotationDeleting: deleteAnnotationMutation.isPending,
  };
}
