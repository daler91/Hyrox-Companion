import type { TimelineAnnotation } from "@shared/schema";
import { useCallback, useState } from "react";

export function useTimelineDialogState() {
  const [showAIConsent, setShowAIConsent] = useState(false);
  const [annotationsDialogOpen, setAnnotationsDialogOpen] = useState(false);
  const [annotationInitialDate, setAnnotationInitialDate] = useState<string | undefined>(undefined);

  const handleAddAnnotation = useCallback((date: string) => {
    setAnnotationInitialDate(date);
    setAnnotationsDialogOpen(true);
  }, []);

  const handleEditAnnotation = useCallback((_annotation: TimelineAnnotation) => {
    setAnnotationInitialDate(undefined);
    setAnnotationsDialogOpen(true);
  }, []);

  return {
    showAIConsent,
    setShowAIConsent,
    annotationsDialogOpen,
    setAnnotationsDialogOpen,
    annotationInitialDate,
    setAnnotationInitialDate,
    handleAddAnnotation,
    handleEditAnnotation,
  };
}
