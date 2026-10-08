import type { TimelineAnnotation } from "@shared/schema";
import { useCallback, useState } from "react";

export function useTimelineDialogState() {
  const [showAIConsent, setShowAIConsent] = useState(false);
  const [annotationsDialogOpen, setAnnotationsDialogOpen] = useState(false);
  const [annotationInitialDate, setAnnotationInitialDate] = useState<string | undefined>(undefined);
  const [editingAnnotation, setEditingAnnotation] = useState<TimelineAnnotation | null>(null);

  const handleAddAnnotation = useCallback((date: string) => {
    setEditingAnnotation(null);
    setAnnotationInitialDate(date);
    setAnnotationsDialogOpen(true);
  }, []);

  // Opens the dialog on this annotation, to change it in place. It opened the
  // create form, so an edit added a second annotation over the first.
  // U36 (CODEBASE_ANALYSIS_2026-10-03)
  const handleEditAnnotation = useCallback((annotation: TimelineAnnotation) => {
    setAnnotationInitialDate(undefined);
    setEditingAnnotation(annotation);
    setAnnotationsDialogOpen(true);
  }, []);

  return {
    showAIConsent,
    setShowAIConsent,
    annotationsDialogOpen,
    setAnnotationsDialogOpen,
    annotationInitialDate,
    setAnnotationInitialDate,
    editingAnnotation,
    setEditingAnnotation,
    handleAddAnnotation,
    handleEditAnnotation,
  };
}
