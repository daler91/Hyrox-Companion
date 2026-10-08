import type { TimelineAnnotation, TimelineAnnotationType } from "@shared/schema";
import { format } from "date-fns";
import { useState } from "react";

const DEFAULT_TYPE: TimelineAnnotationType = "injury";

/**
 * The annotation form's fields. `editing` is the annotation a timeline card's
 * Edit opened: the form loads its values and saves back to it (`editingId`).
 * Edit used to open this form blank-for-create, still holding whatever was
 * last typed, so extending an injury added a second, overlapping one.
 * U36 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function useAnnotationForm(initialDate?: string, editing: TimelineAnnotation | null = null) {
  const today = () => format(new Date(), "yyyy-MM-dd");
  const [type, setType] = useState<TimelineAnnotationType>(
    () => (editing?.type as TimelineAnnotationType | undefined) ?? DEFAULT_TYPE,
  );
  const [startDate, setStartDate] = useState(() => editing?.startDate ?? initialDate ?? today());
  const [endDate, setEndDate] = useState(() => editing?.endDate ?? initialDate ?? today());
  const [note, setNote] = useState(() => editing?.note ?? "");
  const [editingId, setEditingId] = useState<string | null>(editing?.id ?? null);

  /** Loads an annotation to edit, or (null) returns to a fresh create form. */
  const load = (annotation: TimelineAnnotation | null) => {
    setEditingId(annotation?.id ?? null);
    setType((annotation?.type as TimelineAnnotationType | undefined) ?? DEFAULT_TYPE);
    setNote(annotation?.note ?? "");
    if (annotation) {
      setStartDate(annotation.startDate);
      setEndDate(annotation.endDate);
    }
  };

  const [prevEditing, setPrevEditing] = useState(editing);
  if (editing !== prevEditing) {
    setPrevEditing(editing);
    load(editing);
  }

  const [prevInitialDate, setPrevInitialDate] = useState(initialDate);
  if (initialDate !== prevInitialDate) {
    setPrevInitialDate(initialDate);
    if (initialDate) {
      setStartDate(initialDate);
      setEndDate(initialDate);
    }
  }

  return {
    type,
    setType,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    note,
    setNote,
    editingId,
    stopEditing: () => {
      load(null);
    },
  };
}
