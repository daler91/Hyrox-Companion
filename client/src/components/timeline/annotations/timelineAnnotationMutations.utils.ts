import type { TimelineAnnotationType } from "@shared/schema";

import type { toast as toastFn } from "@/hooks/use-toast";
import { QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

import { TYPE_LABELS } from "../annotation-style";

export function invalidateTimelineAnnotationQueries() {
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timelineAnnotations }).catch(() => {});
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.trainingOverview }).catch(() => {});
}

export function handleCreateAnnotationSuccess({
  toast,
  type,
  onCreated,
}: {
  readonly toast: typeof toastFn;
  readonly type: TimelineAnnotationType;
  readonly onCreated: () => void;
}) {
  invalidateTimelineAnnotationQueries();
  toast({
    title: "Annotation added",
    description: `${TYPE_LABELS[type]} saved to your timeline.`,
  });
  onCreated();
}

export function handleDeleteAnnotationSuccess(toast: typeof toastFn) {
  invalidateTimelineAnnotationQueries();
  toast({ title: "Annotation removed" });
}

export function handleMutationError(toast: typeof toastFn, title: string) {
  toast({
    title,
    description: "Please try again.",
    variant: "destructive",
  });
}
