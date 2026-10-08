import type { TimelineAnnotationType } from "@shared/schema";

import { ignoreResult } from "@/hooks/chat/chatSessionModel";
import type { toast as toastFn } from "@/hooks/use-toast";
import { QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

import { TYPE_LABELS } from "../annotation-style";

/**
 * Every query an annotation create or delete changes. The timeline is one of
 * them: the server derives a card's `excused`, `status` and `recoverable` from
 * the athlete's annotations, so without it an excused day kept its "Missed"
 * badge and recovery prompt, and a deleted one kept "Not counted".
 * CL10 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function invalidateTimelineAnnotationQueries() {
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timelineAnnotations }).catch(ignoreResult);
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.trainingOverview }).catch(ignoreResult);
  queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }).catch(ignoreResult);
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

export function handleUpdateAnnotationSuccess({
  toast,
  onUpdated,
}: {
  readonly toast: typeof toastFn;
  readonly onUpdated: () => void;
}) {
  invalidateTimelineAnnotationQueries();
  toast({ title: "Annotation updated" });
  onUpdated();
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
