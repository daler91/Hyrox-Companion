import type { TimelineAnnotation } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useToast } from "@/hooks/use-toast";
import { useMoveTimelineEntry } from "@/hooks/useMoveTimelineEntry";
import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

export function useTimelinePageController(selectedPlanId: string | null, annotations: TimelineAnnotation[]) {
  const { toast } = useToast();
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

  const deleteAnnotationMutation = useMutation({
    mutationFn: (id: string) => api.timelineAnnotations.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timelineAnnotations }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.trainingOverview }).catch(() => {});
      toast({ title: "Annotation removed" });
    },
    onError: () => toast({ title: "Couldn't delete annotation", description: "Please try again.", variant: "destructive" }),
  });

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
