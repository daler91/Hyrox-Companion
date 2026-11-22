import type {
  InsertTimelineAnnotation,
  TimelineAnnotation,
  TimelineAnnotationType,
  UpdateTimelineAnnotation,
} from "@shared/schema";
import { useMutation, useQuery } from "@tanstack/react-query";

import { useToast } from "@/hooks/use-toast";
import { api, QUERY_KEYS } from "@/lib/api";

import {
  handleCreateAnnotationSuccess,
  handleDeleteAnnotationSuccess,
  handleMutationError,
  handleUpdateAnnotationSuccess,
} from "./timelineAnnotationMutations.utils";

export function useTimelineAnnotations(open: boolean) {
  return useQuery<TimelineAnnotation[]>({
    queryKey: QUERY_KEYS.timelineAnnotations,
    queryFn: () => api.timelineAnnotations.list(),
    enabled: open,
  });
}

export function useTimelineAnnotationMutations({
  type,
  onCreated,
  onUpdated,
}: {
  readonly type: TimelineAnnotationType;
  readonly onCreated: () => void;
  readonly onUpdated?: () => void;
}) {
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: (data: InsertTimelineAnnotation) => api.timelineAnnotations.create(data),
    onSuccess: () =>
      handleCreateAnnotationSuccess({
        toast,
        type,
        onCreated,
      }),
    onError: () => handleMutationError(toast, "Couldn't add annotation"),
  });

  // Edit changes the annotation in place; it used to open the create form and
  // add a second, overlapping one. U36 (CODEBASE_ANALYSIS_2026-10-03)
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTimelineAnnotation }) =>
      api.timelineAnnotations.update(id, data),
    onSuccess: () => {
      handleUpdateAnnotationSuccess({ toast, onUpdated });
    },
    onError: () => {
      handleMutationError(toast, "Couldn't update annotation");
    },
  });

  const deleteMutation = useDeleteTimelineAnnotation();

  return {
    createMutation,
    updateMutation,
    deleteMutation,
  };
}

/**
 * Delete one annotation, with the same refresh and toasts wherever it is
 * deleted from: the annotations dialog and the annotation's own timeline row
 * (useTimelinePageController) each wrote this mutation out.
 * (CH-annotationDelete, REFACTORING_REVIEW 2026-09-23)
 */
export function useDeleteTimelineAnnotation() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: (id: string) => api.timelineAnnotations.delete(id),
    onSuccess: () => handleDeleteAnnotationSuccess(toast),
    onError: () => handleMutationError(toast, "Couldn't delete annotation"),
  });
}
